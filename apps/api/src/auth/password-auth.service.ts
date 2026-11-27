import { createHash, randomBytes } from "node:crypto";
import { HttpException, Inject, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TokenService } from "./token.service";
import { appConfig } from "../config/app-config";
import { hashPassword, verifyPassword } from "./password";
import { PRIVILEGED_ROLES } from "./rbac";
import { MessagingAdapter } from "../adapters/messaging.adapter";
import type { StaffRole } from "../generated/prisma/client";

/** Unknown e-mails (and locked accounts) burn one scrypt like known ones: no user-enumeration timing. */
const DUMMY_SCRYPT = "scrypt$7cd38f7ab867b50df28b0c0fd63dd060$97ff8ac4f83d30b1bfdf68edd866d072bd2c128f745cd06fab3f5e84c1fc3d19";
export const MIN_PASSWORD = 10;
const RESET_TTL_MS = 30 * 60_000;
const sha256 = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");
const bad = () => new UnauthorizedException({ statusCode: 401, code: "BAD_CREDENTIALS", message: "Invalid e-mail or password, or the account is temporarily locked after repeated failures" });

export function passwordPolicyError(pw: string, email?: string | null): string | null {
  if (pw.length < MIN_PASSWORD) return `The password must have at least ${MIN_PASSWORD} characters`;
  if (pw.length > 256) return "The password is too long";
  if (email && pw.toLowerCase() === email.toLowerCase()) return "The password must not be your e-mail address";
  if (/^(.)\1+$/.test(pw)) return "Choose a password that is not one repeated character";
  return null;
}

/**
 * AUTH_MODE=both in production: privileged roles (owner, lab director, authorised signatory...) sign in with Kiorex Passport, where the MFA policy applies.
 * A password session never carries the MFA claim and every privileged route would answer MFA_REQUIRED, so the answer says so (only after the password was verified).
 */
export const passwordRoleRefused = (role: StaffRole): boolean => appConfig.mfaEnforced() && PRIVILEGED_ROLES.includes(role);

/** E-mail + password sign-in for Lab staff (founder decision 28 Nov 2026). Identity only: tenant, role and lab scope always come from the staff row. */
@Injectable()
export class PasswordAuthService {
  private readonly log = new Logger(PasswordAuthService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
  ) {}

  private async candidates(email: string, orgSlug?: string) {
    return this.prisma.staffUser.findMany({
      where: { email: email.toLowerCase(), active: true, ...(orgSlug ? { tenant: { slug: orgSlug } } : {}) },
      include: { tenant: { select: { slug: true } } }, take: 3,
    });
  }

  /** Verifies the password and applies the lockout; returns the staff row. Throws the uniform 401. */
  async verifyCredentials(email: string, password: string, orgSlug?: string) {
    if (!appConfig.localLogin()) throw new HttpException({ statusCode: 404, code: "LOCAL_LOGIN_DISABLED", message: "Sign in with Kiorex Passport" }, 404);
    const rows = await this.candidates(email, orgSlug);
    // the same e-mail may exist in two organisations: only the organisation slug can tell them apart (never guess)
    const row = rows.length === 1 ? rows[0]! : null;
    const locked = !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now();
    const ok = await verifyPassword(password, locked || !row ? DUMMY_SCRYPT : row.passwordHash ?? DUMMY_SCRYPT);
    if (rows.length > 1) throw new UnauthorizedException({ statusCode: 401, code: "ORGANISATION_REQUIRED", message: "This e-mail is used in more than one organisation. Enter the organisation slug." });
    if (!row || !row.passwordHash || locked) throw bad();
    if (!ok) {
      const n = row.failedLogins + 1;
      const lock = n >= appConfig.loginLockThreshold();
      await this.prisma.staffUser.update({ where: { id: row.id }, data: { failedLogins: lock ? 0 : n, lockedUntil: lock ? new Date(Date.now() + appConfig.loginLockMinutes() * 60_000) : null } });
      if (lock) await this.audit.record({ orgId: row.orgId, actorId: row.id, action: "auth.password_locked", entityType: "StaffUser", entityId: row.id, meta: { minutes: appConfig.loginLockMinutes() } });
      throw bad();
    }
    return row;
  }

  async login(email: string, password: string, orgSlug?: string) {
    const staff = await this.verifyCredentials(email, password, orgSlug);
    if (passwordRoleRefused(staff.role)) throw new HttpException({ statusCode: 403, code: "PASSPORT_REQUIRED_FOR_ROLE", message: "This role signs in with Kiorex Passport (two-step verification). Use Sign in with Kiorex Passport." }, 403);
    await this.prisma.staffUser.update({ where: { id: staff.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.record({ orgId: staff.orgId, actorId: staff.id, action: "auth.login", entityType: "StaffUser", entityId: staff.id, meta: { via: "password" } });
    return { token: await this.tokens.issuePasswordSession(staff.id), user: { id: staff.id, displayName: staff.displayName, role: staff.role } };
  }

  async changePassword(staffId: string, current: string, next: string) {
    const s = await this.prisma.staffUser.findFirst({ where: { id: staffId, active: true } });
    if (!s || !s.passwordHash || !(await verifyPassword(current, s.passwordHash))) throw bad();
    const err = passwordPolicyError(next, s.email);
    if (err) throw new HttpException({ statusCode: 400, code: "WEAK_PASSWORD", message: err }, 400);
    await this.prisma.staffUser.update({ where: { id: s.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await this.audit.record({ orgId: s.orgId, actorId: s.id, action: "auth.password_changed", entityType: "StaffUser", entityId: s.id });
    return { ok: true };
  }

  /** Uniform answer for known and unknown addresses. A reset link goes to the staff e-mail through the messaging adapter (mock unless EMAIL_MODE=real). */
  async forgot(email: string, orgSlug: string | undefined, resetBaseUrl: string) {
    if (!appConfig.localLogin()) return { ok: true };
    const rows = await this.candidates(email, orgSlug);
    const s = rows.length === 1 ? rows[0]! : null;
    if (s?.email) {
      const token = randomBytes(32).toString("base64url");
      await this.prisma.passwordResetToken.create({ data: { staffId: s.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
      await this.audit.record({ orgId: s.orgId, actorId: s.id, action: "auth.password_reset_requested", entityType: "StaffUser", entityId: s.id });
      try {
        await this.messaging.send({ orgId: s.orgId, channel: "EMAIL", purpose: "ACCOUNT_SECURITY", recipientRef: s.email, templateId: "TODO_NEEDS_HUMAN_PASSWORD_RESET", params: { link: `${resetBaseUrl}/reset-password?token=${token}` } });
      } catch (e) { this.log.warn(`password reset message failed: ${e instanceof Error ? e.message : String(e)}`); }
    } else await verifyPassword(email, DUMMY_SCRYPT); // keep the timing close
    return { ok: true };
  }

  async reset(token: string, next: string) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    const fail = () => new HttpException({ statusCode: 400, code: "RESET_INVALID", message: "The reset link is invalid or expired. Request a new one." }, 400);
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw fail();
    const s = await this.prisma.staffUser.findFirst({ where: { id: row.staffId, active: true } });
    if (!s) throw fail();
    const err = passwordPolicyError(next, s.email);
    if (err) throw new HttpException({ statusCode: 400, code: "WEAK_PASSWORD", message: err }, 400);
    const used = await this.prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw fail(); // single use, race safe
    await this.prisma.staffUser.update({ where: { id: s.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } });
    await this.audit.record({ orgId: s.orgId, actorId: s.id, action: "auth.password_reset", entityType: "StaffUser", entityId: s.id });
    return { ok: true };
  }
}
