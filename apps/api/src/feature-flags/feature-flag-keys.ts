/** Flag catalogue for Kiorly Lab (KX-08 §09). All ship ON; OFF => 403 FEATURE_DISABLED {key,scope}. */
export type FlagClass = "Module" | "AI" | "Integration" | "Launch-locked";

export interface FlagDefinition {
  key: string;
  cls: FlagClass;
  dependsOn: string[];
  /** ADR-024: effective only with gate evidence. None of this product's own flags are launch-locked (the Kiorex-side ones are). */
  launchLocked: boolean;
  offBehaviour: string;
}

export const FLAG_DEFINITIONS: readonly FlagDefinition[] = [
  { key: "lab.module", cls: "Module", dependsOn: [], launchLocked: false, offBehaviour: "No new sign-ups; existing tenants read-only with export" },
  { key: "lab.analyzer_interfaces", cls: "Integration", dependsOn: ["lab.module"], launchLocked: false, offBehaviour: "Manual entry with dual control" },
  { key: "lab.home_collection", cls: "Module", dependsOn: ["lab.module"], launchLocked: false, offBehaviour: "Walk-in collection only" },
  { key: "lab.kiorex_bookings", cls: "Module", dependsOn: ["lab.module"], launchLocked: false, offBehaviour: "Not bookable from Kiorex" },
];

export const FLAG_KEYS = FLAG_DEFINITIONS.map((f) => f.key);
export type FlagKey = string;
export const isKnownFlagKey = (key: string): boolean => FLAG_KEYS.includes(key);

/** Flags the web console needs state for. */
export const FEATURE_FLAG_KEYS_FOR_UI: readonly string[] = FLAG_KEYS;

/**
 * Control-plane entitlement keys that are NOT (yet) in the shared flag catalogue of @kiorex/contracts (flags/catalogue.json), so they are kept out of
 * FLAG_DEFINITIONS (a test pins that list to the contract). They are evaluated from the same Kiorex snapshot (global/market/org OFF) by
 * FeatureFlagsService.evaluateEntitlement. TODO(contracts): add `mobile_staff_app` (class Module, no deps, not launch-locked) for each product.
 */
export const ENTITLEMENT_KEYS = ["mobile_staff_app"] as const;
