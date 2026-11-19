import { ForbiddenException } from "@nestjs/common";
import type { FeatureFlagsService } from "./feature-flags.service";

/** Programmatic equivalent of @RequiresFlag for flows where the flag only applies to part of an operation (e.g. HOME orders). OFF => 403 FEATURE_DISABLED {key,scope}. */
export function assertFlagOn(flags: FeatureFlagsService, key: string, ctx: { orgId?: string; market?: string }): void {
  const d = flags.evaluate(key, ctx);
  if (!d.enabled) throw new ForbiddenException({ code: "FEATURE_DISABLED", key: d.key, scope: d.scope });
}
