import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FeatureFlagsService } from "../../feature-flags/feature-flags.service";

export const GROWTH_FLAG = "growth.provider_links" as const;
const KEY = "kx:growth-links-flag";
/** OFF => 403 FEATURE_DISABLED {key, scope}; OFF never hides or deletes data (new links, QR codes and cards only). */
export const RequiresGrowthLinks = () => SetMetadata(KEY, true);

/** Same contract as RequiresFlagGuard, evaluated as an entitlement key because the shared catalogue has no kiorly-lab row for it yet (see feature-flag-keys.ts). */
@Injectable()
export class GrowthFlagGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}
  canActivate(ctx: ExecutionContext): boolean {
    if (!this.reflector.getAllAndOverride<boolean | undefined>(KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<{ user?: { orgId: string; marketCode: string } }>();
    const d = this.flags.evaluateEntitlement(GROWTH_FLAG, { orgId: req.user?.orgId, market: req.user?.marketCode });
    if (d.enabled) return true;
    throw new ForbiddenException({ code: "FEATURE_DISABLED", key: d.key, scope: d.scope });
  }
}
