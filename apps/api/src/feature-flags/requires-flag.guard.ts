import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FeatureFlagsService } from "./feature-flags.service";

export const REQUIRES_FLAG = "kx:requires-flag";
/** Never use on a safety path (ADR-025). OFF => 403 FEATURE_DISABLED {key, scope}. */
export const RequiresFlag = (key: string) => SetMetadata(REQUIRES_FLAG, key);

@Injectable()
export class RequiresFlagGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRES_FLAG, [ctx.getHandler(), ctx.getClass()]);
    if (!key) return true;
    const req = ctx.switchToHttp().getRequest<{ user?: { orgId: string; marketCode: string } }>();
    // orgId/market come from the authenticated staff row (never from client headers).
    const d = this.flags.evaluate(key, { orgId: req.user?.orgId, market: req.user?.marketCode });
    if (d.enabled) return true;
    throw new ForbiddenException({ code: "FEATURE_DISABLED", key: d.key, scope: d.scope });
  }
}
