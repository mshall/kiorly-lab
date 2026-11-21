import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthedRequest } from "../../auth/auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { MOBILE_ENTITLEMENT_KEY, MobileEntitlementService } from "./mobile-entitlement.service";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const path = (req: AuthedRequest) => req.originalUrl.split("?")[0].replace(/^\/api\/v1/, "").replace(/\/+$/, "");

/**
 * Routes that stay open on EVERY plan (ADR-025 safety-alert inbox + discovery + remote sign-out + auth):
 * /auth/*, GET /mobile/bootstrap, /mobile/alerts*, POST /mobile/upgrade-request (a Basic org must be able to ask), DELETE /mobile/devices/:id.
 */
export function isMobileExempt(method: string, p: string): boolean {
  if (p.startsWith("/auth/") || p === "/auth") return true;
  if (method === "POST" && p === "/mobile/upgrade-request") return true;
  if (p === "/mobile/bootstrap" || p === "/mobile/alerts" || p.startsWith("/mobile/alerts/")) return true;
  return method === "DELETE" && /^\/mobile\/devices\/[^/]+$/.test(p);
}

/**
 * Global guard (after AuthGuard). 1) Device binding: X-Kiorly-Device + X-Kiorly-Device-Token must match an ACTIVE device of the caller,
 * otherwise 401 DEVICE_REVOKED (remote sign-out takes effect on the next request). 2) Entitlement `mobile_staff_app`: every /mobile/* route and
 * every request that identifies as the app (X-Kiorly-Client: kiorly-work/...) needs the entitlement, except the exempt routes above.
 */
@Injectable()
export class MobileGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MobileEntitlementService) private readonly ent: MobileEntitlementService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) return true; // public routes
    const h = (n: string) => {
      const v = req.headers[n];
      return Array.isArray(v) ? v[0] : v;
    };
    const devId = h("x-kiorly-device");
    const devToken = h("x-kiorly-device-token");
    if (devId || devToken) {
      const dev = devId && devToken ? await this.prisma.mobileDevice.findFirst({ where: { orgId: user.orgId, staffId: user.staffId, OR: [{ id: devId }, { deviceId: devId }] } }) : null;
      const a = Buffer.from(dev?.tokenHash ?? ""), b = Buffer.from(sha256(devToken ?? ""));
      if (!dev || dev.status !== "ACTIVE" || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException({ code: "DEVICE_REVOKED" });
      if (!dev.lastSeenAt || Date.now() - dev.lastSeenAt.getTime() > 60_000) await this.prisma.mobileDevice.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
    }
    const p = path(req);
    const client = h("x-kiorly-client");
    const isApp = Boolean(client && client.startsWith("kiorly-work"));
    if ((isApp || p.startsWith("/mobile/")) && !isMobileExempt(req.method, p)) {
      const e = this.ent.evaluate(user);
      if (!e.enabled) throw new ForbiddenException({ code: "FEATURE_DISABLED", key: MOBILE_ENTITLEMENT_KEY, scope: "org", reason: e.reason });
    }
    return true;
  }
}
