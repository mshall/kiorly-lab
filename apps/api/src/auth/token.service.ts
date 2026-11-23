import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { appConfig } from "../config/app-config";
import { hasMfa, passportConfig, peekAlg, verifyPassportAccessToken } from "./passport";

export interface VerifiedToken {
  sub: string;
  /** dev tokens carry the staff id directly. */
  staffId?: string;
  amr: string[];
  /** Raw Passport access token (staff mobile app): `sub` maps to StaffUser.subject (verified-phone link on first login). */
  passport?: boolean;
  /** Passport token carried an MFA assurance (acr/amr). */
  mfa?: boolean;
  claims?: JWTPayload;
}

export const DEV_ISSUER = "kiorly-lab-dev";
/** Issued by `POST /auth/oidc/exchange` after a verified Passport code exchange (web). Accepted in every mode. */
export const SESSION_ISSUER = "kiorly-lab-passport-session";

/**
 * Token verification port. AUTH_MODE=dev: HS256 tokens minted by /auth/dev-login (never in production).
 * AUTH_MODE=oidc: RS256 access tokens from Kiorex Account, validated against the issuer JWKS with aud/iss (ADR-012/013).
 * Tokens carry identity only; roles/tenant always come from our own database.
 */
@Injectable()
export class TokenService {

  async signDev(input: { staffId: string; amr?: string[]; ttlSeconds?: number }): Promise<string> {
    if (appConfig.isProd() && appConfig.authMode() === "dev") throw new Error("dev tokens are disabled in production");
    return new SignJWT({ staffId: input.staffId, amr: input.amr ?? ["pwd"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`dev:${input.staffId}`)
      .setIssuer(DEV_ISSUER)
      .setAudience(appConfig.oidcAudience())
      .setIssuedAt()
      .setExpirationTime(`${input.ttlSeconds ?? 12 * 3600}s`)
      .sign(new TextEncoder().encode(appConfig.jwtDevSecret()));
  }

  /** Web session after Passport sign-in (the browser never holds the Passport tokens). */
  async issueSession(staffId: string, mfa: boolean, ttlSeconds = 8 * 3600): Promise<string> {
    return new SignJWT({ staffId, amr: mfa ? ["passport", "mfa"] : ["passport"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`passport-session:${staffId}`)
      .setIssuer(SESSION_ISSUER)
      .setAudience(appConfig.oidcAudience())
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(new TextEncoder().encode(appConfig.jwtDevSecret()));
  }

  /**
   * HS256 product tokens: dev-login (AUTH_MODE=dev only) and the Passport web session (any mode).
   * RS256 Passport access tokens (staff mobile app): AUTH_MODE=oidc, or AUTH_ACCEPT_PASSPORT=true outside production.
   */
  async verify(token: string): Promise<VerifiedToken> {
    try {
      if (peekAlg(token) === "HS256") {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(appConfig.jwtDevSecret()), {
          issuer: [DEV_ISSUER, SESSION_ISSUER], audience: appConfig.oidcAudience(), algorithms: ["HS256"],
        });
        if (payload.iss === DEV_ISSUER && (appConfig.isProd() || appConfig.authMode() !== "dev")) throw new Error("dev auth is disabled");
        if (!payload.sub) throw new Error("no sub");
        return { sub: payload.sub, staffId: typeof payload.staffId === "string" ? payload.staffId : undefined, amr: Array.isArray(payload.amr) ? (payload.amr as string[]) : [] };
      }
      const cfg = passportConfig();
      if (!cfg) throw new Error("Passport tokens are not accepted");
      const claims = await verifyPassportAccessToken(token, cfg);
      const mfa = hasMfa(claims);
      return { sub: String(claims.sub), amr: mfa ? ["mfa"] : [], passport: true, mfa, claims };
    } catch {
      throw new UnauthorizedException({ code: "INVALID_TOKEN" });
    }
  }
}
