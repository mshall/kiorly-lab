import { Inject, Injectable } from "@nestjs/common";
import type { Edition } from "../../generated/prisma/client";
import { FeatureFlagsService } from "../../feature-flags/feature-flags.service";

export const MOBILE_ENTITLEMENT_KEY = "mobile_staff_app" as const;
export type MobilePlan = "BASIC" | "PRO" | "ENTERPRISE";

/** Lab editions onto the cross-product plan names: LITE = BASIC, PRO = PRO, CHAIN = ENTERPRISE. */
export const PLAN_OF_EDITION: Record<Edition, MobilePlan> = { LITE: "BASIC", PRO: "PRO", CHAIN: "ENTERPRISE" };

export interface MobileEntitlement {
  key: typeof MOBILE_ENTITLEMENT_KEY;
  enabled: boolean;
  requiredPlan: "PRO";
  reason: null | "PLAN_BELOW_PRO" | "FLAG_OFF";
  scope?: string;
}

/**
 * Commercial entitlement (ADR-023 flag `mobile_staff_app` + plan default), NOT a safety control: the safety-alert inbox never calls this.
 * Effective = plan is PRO/ENTERPRISE AND the Kiorex control plane has not switched the flag OFF (global/market/org).
 */
@Injectable()
export class MobileEntitlementService {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  plan(edition: Edition): MobilePlan {
    return PLAN_OF_EDITION[edition];
  }

  evaluate(t: { orgId: string; edition: Edition; marketCode: string }): MobileEntitlement {
    const base = { key: MOBILE_ENTITLEMENT_KEY as typeof MOBILE_ENTITLEMENT_KEY, requiredPlan: "PRO" as const };
    if (this.plan(t.edition) === "BASIC") return { ...base, enabled: false, reason: "PLAN_BELOW_PRO", scope: "org" };
    const d = this.flags.evaluateEntitlement(MOBILE_ENTITLEMENT_KEY, { orgId: t.orgId, market: t.marketCode });
    return d.enabled ? { ...base, enabled: true, reason: null } : { ...base, enabled: false, reason: "FLAG_OFF", scope: d.scope };
  }
}
