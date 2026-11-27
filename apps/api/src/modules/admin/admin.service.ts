import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { Edition, Prisma, StaffRole } from "../../generated/prisma/client";
import { normalizeDistrictId } from "@kiorly/field-visit";
import type { AuthUser } from "../../auth/auth.types";
import { PERMISSIONS, ROLE_PERMISSIONS } from "../../auth/rbac";
import { TokenService } from "../../auth/token.service";
import { normalizePhone } from "../../auth/passport";
import { hashPassword } from "../../auth/password";
import { passwordPolicyError } from "../../auth/password-auth.service";
import { PassportSessions } from "../../auth/passport-sessions.service";
import { AuditService } from "../../audit/audit.service";
import { effectiveOrgDefault, type SignInDefaultMethod } from "../../auth/sign-in-default";
import { tenantLinkedToKiorex } from "../../auth/sign-in-config";
import { appConfig } from "../../config/app-config";
import { page } from "../../common/pagination";
import { open as _open, seal } from "../../common/secret-box";
import { assertFlagOn } from "../../feature-flags/flag-gate";
import { FEATURE_FLAG_KEYS_FOR_UI } from "../../feature-flags/feature-flag-keys";
import { FeatureFlagsService } from "../../feature-flags/feature-flags.service";
import { EDITION_CAPABILITIES } from "../../kernel-adapter/local-kernel";
import { PrismaService } from "../../prisma/prisma.service";
import { StarterCatalogueService } from "./starter-catalogue.service";

void _open;

@Injectable()
export class AdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(StarterCatalogueService) private readonly starter: StarterCatalogueService,
    @Inject(PassportSessions) private readonly sessions: PassportSessions,
  ) {}

  // ------------------------------------------------------------------ auth
  private devOnly() {
    if (appConfig.isProd() || appConfig.authMode() !== "dev") throw new ForbiddenException({ code: "DEV_AUTH_DISABLED" });
  }

  async devOrgs() {
    this.devOnly();
    const ts = await this.prisma.tenant.findMany({ include: { staff: { where: { active: true }, select: { email: true, displayName: true, role: true } } }, orderBy: { createdAt: "asc" }, take: 20 });
    return ts.map((t) => ({ slug: t.slug, name: t.name, edition: t.edition, staff: t.staff }));
  }

  async devLogin(b: { orgSlug: string; email: string }) {
    this.devOnly();
    const t = await this.prisma.tenant.findUnique({ where: { slug: b.orgSlug } });
    const s = t ? await this.prisma.staffUser.findFirst({ where: { orgId: t.id, email: b.email.toLowerCase(), active: true } }) : null;
    if (!s) throw new ForbiddenException({ code: "LOGIN_FAILED" });
    const token = await this.tokens.signDev({ staffId: s.id, amr: ["pwd", "mfa"] });
    await this.audit.record({ orgId: s.orgId, actorId: s.id, action: "auth.dev_login", entityType: "StaffUser", entityId: s.id });
    return { token, user: { id: s.id, displayName: s.displayName, role: s.role } };
  }

  async me(u: AuthUser) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
    const labs = await this.prisma.lab.findMany({ where: { orgId: u.orgId, ...(u.labIds.length ? { id: { in: u.labIds } } : {}) }, select: { id: true, name: true, code: true } });
    return {
      user: { id: u.staffId, displayName: u.displayName, role: u.role, signatory: Boolean(u.signatoryLicenceNo) },
      tenant: { id: tenant.id, name: tenant.name, edition: tenant.edition, marketCode: tenant.marketCode, currency: tenant.currency, vatRatePercent: Number(tenant.vatRatePercent), integrationMode: tenant.integrationMode, defaultLocale: tenant.defaultLocale },
      labs,
      permissions: ROLE_PERMISSIONS[u.role],
      flags: Object.fromEntries(FEATURE_FLAG_KEYS_FOR_UI.map((k) => [k, this.flags.evaluate(k, { orgId: u.orgId, market: u.marketCode })])),
      capabilities: EDITION_CAPABILITIES[tenant.edition],
    };
  }

  // ------------------------------------------------------------ onboarding
  /** Self-serve tenant creation (dev/pilot). Gated by flag lab.module ("No new sign-ups" when OFF). Production sign-up goes through Kiorex Account (NH-LB-016). */
  async onboard(b: { name: string; slug: string; labName: string; labCode: string; ownerName: string; ownerEmail: string; ownerPassword?: string; ownerPhone?: string; edition?: Edition; marketCode?: string; loadStarterCatalogue?: boolean; signatoryLicenceNo?: string }) {
    this.devOnly();
    const market = (b.marketCode ?? "EG").toUpperCase(); // fixed for life once created (founder decision A, 27 Nov 2026): no API changes it afterwards
    assertFlagOn(this.flags, "lab.module", { market });
    if (await this.prisma.tenant.findUnique({ where: { slug: b.slug } })) throw new ConflictException({ code: "SLUG_TAKEN" });
    const ownerPhone = b.ownerPhone ? normalizePhone(b.ownerPhone) : null;
    if (b.ownerPhone && !ownerPhone) throw new BadRequestException({ code: "INVALID_PHONE" });
    const pwErr = b.ownerPassword ? passwordPolicyError(b.ownerPassword, b.ownerEmail) : null;
    if (pwErr) throw new BadRequestException({ code: "WEAK_PASSWORD", message: pwErr });
    const ownerHash = b.ownerPassword ? await hashPassword(b.ownerPassword) : null;
    const out = await this.prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: { name: b.name, slug: b.slug, edition: b.edition ?? "LITE", marketCode: market, integrationMode: "STANDALONE" } });
      const lab = await tx.lab.create({ data: { orgId: t.id, name: b.labName, code: b.labCode.toUpperCase() } });
      const owner = await tx.staffUser.create({ data: { orgId: t.id, email: b.ownerEmail.toLowerCase(), displayName: b.ownerName, role: "OWNER", signatoryLicenceNo: b.signatoryLicenceNo, phone: ownerPhone, ...(ownerHash ? { passwordHash: ownerHash, passwordChangedAt: new Date() } : {}) } });
      await tx.priceList.create({ data: { orgId: t.id, name: "Standard", isDefault: true, currency: t.currency } });
      await this.audit.record({ orgId: t.id, actorId: owner.id, action: "tenant.onboard", entityType: "Tenant", entityId: t.id }, tx);
      return { tenant: t, lab, owner };
    });
    if (b.loadStarterCatalogue) await this.starter.load(out.tenant.id);
    const token = await this.tokens.signDev({ staffId: out.owner.id, amr: ["pwd", "mfa"] });
    return { tenantId: out.tenant.id, labId: out.lab.id, ownerId: out.owner.id, token };
  }

  async loadStarterCatalogue(u: AuthUser) {
    const r = await this.starter.load(u.orgId);
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "catalogue.starter_loaded", entityType: "Tenant", entityId: u.orgId });
    return r;
  }

  // ----------------------------------------------------------------- staff
  async listStaff(orgId: string) {
    const rows = await this.prisma.staffUser.findMany({ where: { orgId }, select: { id: true, email: true, displayName: true, role: true, labIds: true, signatoryLicenceNo: true, active: true, phone: true, subject: true, passwordHash: true }, orderBy: { displayName: "asc" } });
    return rows.map(({ subject, passwordHash, ...s }) => ({ ...s, passportLinked: !!subject, hasPassword: !!passwordHash }));
  }

  /** Names and roles for pickers (collection managers): no phone numbers, e-mail or Passport state. */
  lookupStaff(orgId: string) {
    return this.prisma.staffUser.findMany({ where: { orgId, active: true }, select: { id: true, displayName: true, role: true, labIds: true }, orderBy: { displayName: "asc" } });
  }

  /** Staff phone: strict E.164 (formatting characters tolerated), unique inside the tenant; null/"" clears it. Never logged. */
  private async cleanPhone(orgId: string, raw: string | null | undefined, exceptId?: string): Promise<string | null> {
    if (raw === null || raw === undefined || raw.trim() === "") return null;
    const phone = normalizePhone(raw);
    if (!phone) throw new BadRequestException({ code: "INVALID_PHONE", message: "Phone must be in international format, e.g. +201000002004" });
    const clash = await this.prisma.staffUser.findFirst({ where: { orgId, phone, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (clash) throw new ConflictException({ code: "PHONE_TAKEN", message: "Another staff member already uses this phone number" });
    return phone;
  }

  async createStaff(u: AuthUser, b: { email: string; displayName: string; role: StaffRole; labIds?: string[]; signatoryLicenceNo?: string; subject?: string; phone?: string; password?: string }) {
    if (b.role === "OWNER" && u.role !== "OWNER") throw new ForbiddenException({ code: "ONLY_OWNER_CAN_GRANT_OWNER" });
    if (["AUTHORIZED_SIGNATORY", "LAB_DIRECTOR"].includes(b.role) && !b.signatoryLicenceNo) throw new BadRequestException({ code: "LICENCE_REQUIRED_FOR_SIGNATORY" });
    if (await this.prisma.staffUser.findFirst({ where: { orgId: u.orgId, email: b.email.toLowerCase() } })) throw new ConflictException({ code: "EMAIL_TAKEN" });
    await this.assertLabs(u.orgId, b.labIds);
    const phone = await this.cleanPhone(u.orgId, b.phone);
    const pwErr = b.password ? passwordPolicyError(b.password, b.email) : null;
    if (pwErr) throw new BadRequestException({ code: "WEAK_PASSWORD", message: pwErr });
    const s = await this.prisma.staffUser.create({ data: { orgId: u.orgId, email: b.email.toLowerCase(), displayName: b.displayName, role: b.role, labIds: b.labIds ?? [], signatoryLicenceNo: b.signatoryLicenceNo, subject: b.subject, phone, ...(b.password ? { passwordHash: await hashPassword(b.password), passwordChangedAt: new Date() } : {}) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "staff.create", entityType: "StaffUser", entityId: s.id, meta: { role: b.role, linkKeySet: !!phone } });
    const { subject, passwordHash, ...out } = s;
    return { ...out, passportLinked: !!subject, hasPassword: !!passwordHash };
  }

  async updateStaff(u: AuthUser, id: string, b: { displayName?: string; role?: StaffRole; labIds?: string[]; signatoryLicenceNo?: string | null; active?: boolean; phone?: string | null; password?: string }) {
    const s = await this.prisma.staffUser.findFirst({ where: { id, orgId: u.orgId } });
    if (!s) throw new NotFoundException({ code: "STAFF_NOT_FOUND" });
    if ((b.role === "OWNER" || s.role === "OWNER") && u.role !== "OWNER") throw new ForbiddenException({ code: "ONLY_OWNER_CAN_CHANGE_OWNER" });
    if (id === u.staffId && (b.active === false || (b.role && b.role !== s.role))) throw new ConflictException({ code: "CANNOT_CHANGE_SELF" });
    const role = b.role ?? s.role;
    const lic = b.signatoryLicenceNo === undefined ? s.signatoryLicenceNo : b.signatoryLicenceNo;
    if (["AUTHORIZED_SIGNATORY", "LAB_DIRECTOR"].includes(role) && !lic) throw new BadRequestException({ code: "LICENCE_REQUIRED_FOR_SIGNATORY" });
    await this.assertLabs(u.orgId, b.labIds);
    const phone = b.phone === undefined ? undefined : await this.cleanPhone(u.orgId, b.phone, id);
    const pwErr = b.password ? passwordPolicyError(b.password, s.email) : null;
    if (pwErr) throw new BadRequestException({ code: "WEAK_PASSWORD", message: pwErr });
    let row;
    try {
      row = await this.prisma.staffUser.update({ where: { id }, data: { displayName: b.displayName, role: b.role, labIds: b.labIds, signatoryLicenceNo: b.signatoryLicenceNo, active: b.active, phone, ...(b.password ? { passwordHash: await hashPassword(b.password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null } : {}) } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new ConflictException({ code: "PHONE_TAKEN", message: "Another staff member already uses this phone number" });
      throw e;
    }
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "staff.update", entityType: "StaffUser", entityId: id, meta: { fields: Object.keys(b).filter((k) => k !== "phone" && k !== "password"), passwordChanged: !!b.password, linkKeyChanged: b.phone !== undefined } });
    // deactivating a staff member ends their Kiorex Passport web sessions straight away
    if (b.active === false && s.active) await this.sessions.revokeForStaff(id, "staff_deactivated");
    const { subject, passwordHash, ...out } = row;
    return { ...out, passportLinked: !!subject, hasPassword: !!passwordHash };
  }

  private async assertLabs(orgId: string, labIds?: string[]) {
    if (!labIds?.length) return;
    if ((await this.prisma.lab.count({ where: { orgId, id: { in: labIds } } })) !== labIds.length) throw new BadRequestException({ code: "UNKNOWN_LAB" });
  }

  rbacMatrix() {
    return { permissions: PERMISSIONS, roles: ROLE_PERMISSIONS };
  }

  // ------------------------------------------------------------------ labs
  listLabs(orgId: string) {
    return this.prisma.lab.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  }
  async updateLab(u: AuthUser, id: string, b: { name?: string; address?: string | null; licenceNo?: string | null; appointmentCapacity?: number; appointmentSlotMinutes?: number; openingHour?: number; closingHour?: number }) {
    if (!(await this.prisma.lab.findFirst({ where: { id, orgId: u.orgId } }))) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    const cur = await this.prisma.lab.findUniqueOrThrow({ where: { id } });
    if ((b.openingHour ?? cur.openingHour) >= (b.closingHour ?? cur.closingHour)) throw new BadRequestException({ code: "OPENING_HOURS_INVALID" });
    const row = await this.prisma.lab.update({ where: { id }, data: b });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "lab.update", entityType: "Lab", entityId: id, meta: { fields: Object.keys(b) } });
    return row;
  }
  async createLab(u: AuthUser, b: { name: string; code: string; address?: string; licenceNo?: string }) {
    const count = await this.prisma.lab.count({ where: { orgId: u.orgId } });
    if (count >= 1 && !EDITION_CAPABILITIES[u.edition].includes("multi_branch")) throw new HttpException({ code: "PLAN_REQUIRED", capability: "multi_branch", edition: u.edition }, 402);
    if (await this.prisma.lab.findFirst({ where: { orgId: u.orgId, code: b.code.toUpperCase() } })) throw new ConflictException({ code: "LAB_CODE_TAKEN" });
    const lab = await this.prisma.lab.create({ data: { orgId: u.orgId, name: b.name, code: b.code.toUpperCase(), address: b.address, licenceNo: b.licenceNo } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "lab.create", entityType: "Lab", entityId: lab.id });
    return lab;
  }

  // -------------------------------------------------------------- settings
  async getSettings(orgId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } });
    return { integrationMode: t.integrationMode, defaultLocale: t.defaultLocale, name: t.name, edition: t.edition, marketCode: t.marketCode, currency: t.currency, vatRatePercent: Number(t.vatRatePercent), referringDoctorStatements: t.referringDoctorStatements, qcValidityHours: t.qcValidityHours, safetyContactName: t.safetyContactName, safetyContactPhone: t.safetyContactPhone, homeBufferBeforeMin: t.homeBufferBeforeMin, homeBufferAfterMin: t.homeBufferAfterMin, homeDailyCap: t.homeDailyCap, ...(await this.signInSettings(t)) };
  }
  /** Org default sign-in method: the stored choice (null = automatic), what is effective now, and whether the org is linked to Kiorex. */
  private async signInSettings(t: { id: string; externalOrgId: string | null; defaultSignInMethod: SignInDefaultMethod | null }) {
    const linkedToKiorex = await tenantLinkedToKiorex(this.prisma, t);
    return { defaultSignInMethod: t.defaultSignInMethod, effectiveSignInMethod: effectiveOrgDefault({ stored: t.defaultSignInMethod, linkedToKiorex }), linkedToKiorex };
  }
  async updateSettings(u: AuthUser, b: { integrationMode?: "STANDALONE" | "INTEGRATED"; defaultLocale?: "ar" | "en"; name?: string; vatRatePercent?: number; referringDoctorStatements?: boolean; qcValidityHours?: number; safetyContactName?: string | null; safetyContactPhone?: string | null; homeBufferBeforeMin?: number; homeBufferAfterMin?: number; homeDailyCap?: number | null; defaultSignInMethod?: SignInDefaultMethod | null }) {
    const before = b.defaultSignInMethod !== undefined ? await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId }, select: { defaultSignInMethod: true } }) : null;
    const t = await this.prisma.tenant.update({ where: { id: u.orgId }, data: b });
    if (before && before.defaultSignInMethod !== t.defaultSignInMethod) await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "settings.default_signin_method", entityType: "Tenant", entityId: u.orgId, meta: { from: before.defaultSignInMethod, to: t.defaultSignInMethod } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "settings.update", entityType: "Tenant", entityId: u.orgId, meta: { fields: Object.keys(b) } });
    return this.getSettings(t.id);
  }

  /** HVCFG02 / HVBK01: the districts a lab collects in (+ optional max travel time from a start district and a travel matrix). */
  async setCoverage(u: AuthUser, labId: string, b: { districtIds: string[]; maxTravelMinutes?: number | null; startDistrictId?: string | null; travelMatrix?: Record<string, Record<string, number>> | null }) {
    const lab = await this.prisma.lab.findFirst({ where: { id: labId, orgId: u.orgId } });
    if (!lab) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    const ids = [...new Set(b.districtIds.map(normalizeDistrictId))];
    if (ids.some((i) => !i)) throw new BadRequestException({ code: "DISTRICT_INVALID" });
    const updated = await this.prisma.lab.update({
      where: { id: labId },
      data: { coverageDistricts: ids, maxTravelMinutes: b.maxTravelMinutes ?? null, startDistrictId: b.startDistrictId ? normalizeDistrictId(b.startDistrictId) : null, travelMatrix: (b.travelMatrix ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "lab.coverage", entityType: "Lab", entityId: labId, meta: { districts: ids.length } });
    return updated;
  }

  // ----------------------------------------------------------------- audit
  auditLogs(orgId: string, q: { entityType?: string; entityId?: string; actorId?: string; action?: string; from?: string; to?: string; limit?: string; offset?: string }) {
    return this.prisma.auditLog.findMany({ where: { orgId, ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.from || q.to ? { at: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}), ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.actorId ? { actorId: q.actorId } : {}), ...(q.action ? { action: { contains: q.action } } : {}) }, orderBy: { at: "desc" }, ...page(q, 500) });
  }

  /** Dev inbox for mocked messaging (MESSAGING_MODE=mock). */
  inbox(orgId: string, q: { purpose?: string; limit?: string }) {
    return this.prisma.notificationAttempt.findMany({ where: { orgId, ...(q.purpose ? { purpose: q.purpose as never } : {}) }, orderBy: { createdAt: "desc" }, ...page(q, 200) });
  }

  // ---------------------------------------------------- integration clients
  async listClients(orgId: string) {
    return this.prisma.integrationClient.findMany({ where: { orgId }, select: { id: true, key: true, source: true, kiorexBaseUrl: true, active: true, createdAt: true } });
  }
  /** Issues an HMAC client (key + secret). The secret is returned ONCE and stored encrypted. */
  async createClient(u: AuthUser, source: "KIOREX_BOOKING" | "KIORLY_CLINIC" | "KIORLY_NURSE", kiorexBaseUrl?: string) {
    const key = `kl_${randomBytes(9).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    const webhookSecret = randomBytes(32).toString("base64url");
    const c = await this.prisma.integrationClient.create({ data: { orgId: u.orgId, key, secretEnc: seal(secret), source, kiorexBaseUrl, webhookSecretEnc: seal(webhookSecret) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "integration_client.create", entityType: "IntegrationClient", entityId: c.id, meta: { source } });
    return { id: c.id, key, secret, webhookSecret, source };
  }
}
