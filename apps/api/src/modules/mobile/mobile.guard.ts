import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AuthedRequest } from "../../auth/auth.types";
import { hasPermission, type Permission } from "../../auth/rbac";
import { PrismaService } from "../../prisma/prisma.service";
import { MOBILE_ENTITLEMENT_KEY, MobileEntitlementService } from "./mobile-entitlement.service";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

import { isMobileExempt, isMobilePlanGated } from "./mobile-gate";
export { isMobileExempt };

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
    if (isMobilePlanGated(req)) {
      const e = this.ent.evaluate(user);
      if (!e.enabled) throw new ForbiddenException({ code: "FEATURE_DISABLED", key: MOBILE_ENTITLEMENT_KEY, scope: "org", reason: e.reason });
      // RBAC deferred by AuthGuard so the plan gate answers first
      const need = req.deferredPerms as Permission[] | undefined;
      if (need?.length && !need.every((x) => hasPermission(user.role, x))) throw new ForbiddenException({ code: "FORBIDDEN", required: need });
    }
    return true;
  }
}
