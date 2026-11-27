import { Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpException, Inject, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "./decorators";
import { ZBody, z } from "../common/zod";
import { PassportService } from "./passport.service";
import { PassportSessions } from "./passport-sessions.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TokenService } from "./token.service";
import { appConfig } from "../config/app-config";
import { HandoffCodes, HandoffError, isHomeOrigin, webBaseUrl } from "./handoff";
import { PrismaHandoffStore } from "./handoff.store";
import { deploymentDefaultMethod, orgSignInFacts, resolvePublicSignInConfig } from "./sign-in-config";
import { makeWindowLimiter } from "./sign-in-default";
import { PasswordAuthService, passwordRoleRefused } from "./password-auth.service";
import { CurrentUser } from "./decorators";
import type { AuthUser } from "./auth.types";
import { ApiBearerAuth } from "@nestjs/swagger";
import { PgRateLimiter, type RawSql } from "../common/pg-rate-limit";

const configLimiter = makeWindowLimiter(300, 60_000);

const Exchange = z.object({ code: z.string().min(1).max(2048), codeVerifier: z.string().min(43).max(128), redirectUri: z.string().url().max(512), nonce: z.string().min(1).max(256) }).strict();

const HandoffLogin = z.object({ orgSlug: z.string().min(1).max(100).optional(), email: z.string().email().max(254), password: z.string().max(256).optional() }).strict();
const Login = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256), orgSlug: z.string().min(1).max(100).optional() }).strict();
const ChangePw = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(1).max(256) }).strict();
const Forgot = z.object({ email: z.string().email().max(254), orgSlug: z.string().min(1).max(100).optional() }).strict();
const Reset = z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(1).max(256) }).strict();
const HandoffExchange = z.object({ code: z.string().max(128) }).strict();
/** Sign-in throttle: 10 attempts per key per minute, counted in Postgres so it holds across API instances. */
let pgLimiter: PgRateLimiter | undefined;
async function throttle(prisma: PrismaService, key: string, perMinute = Number(process.env.SIGNIN_RATE_PER_MINUTE) || 10) {
  pgLimiter ??= new PgRateLimiter(prisma as unknown as RawSql);
  const r = await pgLimiter.hit(`signin:${key}`, perMinute, 60_000);
  if (!r.ok) throw new HttpException({ statusCode: 429, code: "RATE_LIMITED", message: "Too many sign-in attempts, try again in a minute", retryAfterSec: r.retryAfterSec }, 429);
}

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(PassportService) private readonly passport: PassportService,
    @Inject(PassportSessions) private readonly sessions: PassportSessions,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PrismaHandoffStore) private readonly handoffStore: PrismaHandoffStore,
    @Inject(PasswordAuthService) private readonly pw: PasswordAuthService,
  ) {}
  private handoffCodes() { return new HandoffCodes(this.handoffStore, "lab"); }

  /** Login page configuration: is the dev login offered, and is Kiorex Passport (OIDC + PKCE) available. Nothing secret. */
  @Public() @Get("config")
  async config(@Query("org") org: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const base = await this.passport.publicConfig();
    res.setHeader("Cache-Control", "no-store");
    // Pre-auth and public: rate limited per client; an unknown or missing org gets the deployment default in the same shape (no org enumeration).
    if (!configLimiter(req.ip ?? "anon")) throw new HttpException({ statusCode: 429, code: "RATE_LIMITED", message: "Too many requests, try again in a minute" }, 429);
    const facts = org ? await orgSignInFacts(this.prisma, org) : null;
    return { ...base, ...resolvePublicSignInConfig({ passportAvailable: base.passport !== null, org: facts, deployment: deploymentDefaultMethod() }) };
  }

  /** Web Passport sign-in: the SPA did authorize + PKCE; the API redeems the code server-side and issues the staff session. */
  @Public() @Post("oidc/exchange") @HttpCode(200) @ZBody(Exchange) exchange(@Body() b: z.infer<typeof Exchange>) { return this.passport.exchange(b); }

  /**
   * OIDC Back-Channel Logout receiver (registered as `backchannel_logout_uri` of the Passport client kiorly-lab-web).
   * Public by design: the signed `logout_token` is the credential. 200 = processed (idempotent per sid); 400 = invalid or replayed.
   */
  @Public() @Post("oidc/backchannel-logout") @HttpCode(200)
  async backchannelLogout(@Body("logout_token") logoutToken: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    await this.sessions.backchannelLogout(logoutToken);
    return {};
  }

  /** E-mail + password sign-in (AUTH_MODE=dev or both). Throttled per e-mail and per client address; wrong passwords lock the account after a threshold (uniform 401). */
  @Public() @Post("login") @HttpCode(200) @ZBody(Login)
  async login(@Body() b: z.infer<typeof Login>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    await throttle(this.prisma, `ip:${req.ip ?? "anon"}`, Number(process.env.SIGNIN_RATE_PER_IP_PER_MINUTE) || 30);
    await throttle(this.prisma, `${b.orgSlug ?? "*"}|${b.email.toLowerCase()}`);
    return this.pw.login(b.email, b.password, b.orgSlug);
  }

  @ApiBearerAuth() @Post("password/change") @HttpCode(200) @ZBody(ChangePw)
  changePassword(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof ChangePw>) { return this.pw.changePassword(u.staffId, b.currentPassword, b.newPassword); }

  @Public() @Post("password/forgot") @HttpCode(200) @ZBody(Forgot)
  async forgot(@Body() b: z.infer<typeof Forgot>, @Req() req: Request) {
    await throttle(this.prisma, `ip:${req.ip ?? "anon"}`, Number(process.env.SIGNIN_RATE_PER_IP_PER_MINUTE) || 30);
    await throttle(this.prisma, `forgot|${b.email.toLowerCase()}`, 3);
    return this.pw.forgot(b.email, b.orgSlug, webBaseUrl(process.env, appConfig.publicBaseUrl()) ?? appConfig.publicBaseUrl());
  }

  @Public() @Post("password/reset") @HttpCode(200) @ZBody(Reset)
  async reset(@Body() b: z.infer<typeof Reset>, @Req() req: Request) {
    await throttle(this.prisma, `ip:${req.ip ?? "anon"}`, Number(process.env.SIGNIN_RATE_PER_IP_PER_MINUTE) || 30);
    return this.pw.reset(b.token, b.newPassword);
  }

  /**
   * Kiorly Home sign-in, step 1 (ADR-038 handoff). The Lab has no passwords: AUTH_MODE=dev signs in with organisation slug + e-mail (the same check as
   * `auth/dev-login`; `password` is accepted and ignored so Home can use one form). The answer is a single-use 30-second code, never a token.
   * Only the Kiorly Home origin may call it. AUTH_MODE=oidc (production): 404, Passport only.
   */
  @Public() @Post("handoff/login") @HttpCode(200) @ZBody(HandoffLogin)
  async handoffLogin(@Body() b: z.infer<typeof HandoffLogin>, @Headers("origin") origin: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    if (!isHomeOrigin(origin)) throw new ForbiddenException({ code: "HANDOFF_ORIGIN_NOT_ALLOWED", message: "This sign-in start is not allowed from here" });
    if (!appConfig.localLogin()) throw new HttpException({ statusCode: 404, code: "LOCAL_LOGIN_DISABLED", message: "Sign in with Kiorex Passport" }, 404);
    await throttle(this.prisma, `ip:${req.ip ?? "anon"}`, Number(process.env.SIGNIN_RATE_PER_IP_PER_MINUTE) || 30);
    await throttle(this.prisma, `${b.orgSlug ?? "*"}|${b.email.toLowerCase()}`);
    let s;
    if (!b.password && !appConfig.isProd() && appConfig.authMode() === "dev") {
      // local development only (the previous dev sign-in: organisation slug + e-mail, no password). Never in `both` or in production.
      const t = b.orgSlug ? await this.prisma.tenant.findUnique({ where: { slug: b.orgSlug } }) : null;
      s = t ? await this.prisma.staffUser.findFirst({ where: { orgId: t.id, email: b.email.toLowerCase(), active: true } }) : null;
      if (!s) throw new UnauthorizedException({ statusCode: 401, code: "LOGIN_FAILED", message: "Invalid organisation or e-mail" });
    } else {
      s = await this.pw.verifyCredentials(b.email, b.password ?? "", b.orgSlug);
      if (passwordRoleRefused(s.role)) throw new HttpException({ statusCode: 403, code: "PASSPORT_REQUIRED_FOR_ROLE", message: "This role signs in with Kiorex Passport (two-step verification). Use Sign in with Kiorex Passport." }, 403);
    }
    const { code, expiresInSeconds } = await this.handoffCodes().issue({ subjectId: s.id, origin: origin! });
    await this.audit.record({ orgId: s.orgId, actorId: s.id, action: "auth.handoff_issued", entityType: "StaffUser", entityId: s.id, meta: { via: "kiorly-home" } });
    const web = webBaseUrl(process.env, appConfig.publicBaseUrl());
    return { status: "OK", code, expiresInSeconds, redirectUrl: web ? `${web}/login?handoff=${encodeURIComponent(code)}&from=kiorly-home` : null };
  }

  /** Kiorly Home sign-in, step 2: the Lab web redeems the code once and receives the normal dev-login result. Replays and expired codes: 401. */
  @Public() @Post("handoff/exchange") @HttpCode(200) @ZBody(HandoffExchange)
  async handoffExchange(@Body() b: z.infer<typeof HandoffExchange>, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    let subjectId: string;
    try { ({ subjectId } = await this.handoffCodes().redeem({ code: b.code })); }
    catch (e) { if (e instanceof HandoffError) throw new UnauthorizedException({ statusCode: 401, code: e.code, message: e.message }); throw e; }
    const s = await this.prisma.staffUser.findFirst({ where: { id: subjectId, active: true } });
    if (!s) throw new UnauthorizedException({ statusCode: 401, code: "HANDOFF_INVALID", message: "The sign-in link is invalid or expired. Sign in again." });
    const token = appConfig.authMode() === "dev" && !appConfig.isProd() ? await this.tokens.signDev({ staffId: s.id, amr: ["pwd", "mfa"] }) : await this.tokens.issuePasswordSession(s.id);
    if (appConfig.authMode() !== "dev" && passwordRoleRefused(s.role)) throw new UnauthorizedException({ statusCode: 401, code: "HANDOFF_INVALID", message: "The sign-in link is invalid or expired. Sign in again." });
    await this.audit.record({ orgId: s.orgId, actorId: s.id, action: "auth.dev_login", entityType: "StaffUser", entityId: s.id, meta: { via: "kiorly-home-handoff" } });
    return { token, user: { id: s.id, displayName: s.displayName, role: s.role } };
  }
}
