import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthedRequest } from "../auth/auth.types";
import { KERNEL_ENTITLEMENTS, type Capability, type EntitlementsPort } from "./ports";

export const REQUIRES_ENTITLEMENT = "kx:requires-entitlement";
/** Plan entitlement (HTTP 402). Distinct from feature flags (403). Never on safety paths. */
export const RequiresEntitlement = (c: Capability) => SetMetadata(REQUIRES_ENTITLEMENT, c);

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(KERNEL_ENTITLEMENTS) private readonly ent: EntitlementsPort,
  ) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const cap = this.reflector.getAllAndOverride<Capability | undefined>(REQUIRES_ENTITLEMENT, [ctx.getHandler(), ctx.getClass()]);
    if (!cap) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) return true;
    if (await this.ent.has(user.orgId, cap)) return true;
    throw new HttpException({ code: "PLAN_REQUIRED", capability: cap, edition: user.edition }, 402);
  }
}
