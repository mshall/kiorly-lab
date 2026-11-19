import { Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { appConfig } from "../config/app-config";

export interface VerifiedToken {
  sub: string;
  /** dev tokens carry the staff id directly. */
  staffId?: string;
  amr: string[];
}

export const DEV_ISSUER = "kiorly-lab-dev";

/**
 * Token verification port. AUTH_MODE=dev: HS256 tokens minted by /auth/dev-login (never in production).
 * AUTH_MODE=oidc: RS256 access tokens from Kiorex Account, validated against the issuer JWKS with aud/iss (ADR-012/013).
 * Tokens carry identity only; roles/tenant always come from our own database.
 */
@Injectable()
export class TokenService {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

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

  async verify(token: string): Promise<VerifiedToken> {
    try {
      let payload: JWTPayload;
      if (appConfig.authMode() === "oidc") {
        const issuer = appConfig.oidcIssuer();
        if (!issuer) throw new Error("KIOREX_OIDC_ISSUER not configured");
        this.jwks ??= createRemoteJWKSet(new URL(`${issuer}/jwks`));
        ({ payload } = await jwtVerify(token, this.jwks, { issuer, audience: appConfig.oidcAudience(), algorithms: ["RS256"] }));
      } else {
        if (appConfig.isProd()) throw new Error("dev auth is disabled in production");
        ({ payload } = await jwtVerify(token, new TextEncoder().encode(appConfig.jwtDevSecret()), {
          issuer: DEV_ISSUER,
          audience: appConfig.oidcAudience(),
          algorithms: ["HS256"],
        }));
      }
      if (!payload.sub) throw new Error("no sub");
      return { sub: payload.sub, staffId: typeof payload.staffId === "string" ? payload.staffId : undefined, amr: Array.isArray(payload.amr) ? (payload.amr as string[]) : [] };
    } catch {
      throw new UnauthorizedException({ code: "INVALID_TOKEN" });
    }
  }
}
