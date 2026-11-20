import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isMobileExempt } from "./mobile.guard";
import { MOBILE_TEMPLATES } from "../../adapters/mobile-push.adapter";
import { PLAN_OF_EDITION } from "./mobile-entitlement.service";
import { ENTITLEMENT_KEYS, isKnownFlagKey } from "../../feature-flags/feature-flag-keys";

describe("Kiorly Work: entitlement plumbing", () => {
  it("only the safety inbox, bootstrap, auth and remote sign-out are exempt (ADR-025)", () => {
    for (const [m, p] of [["GET", "/mobile/bootstrap"], ["GET", "/mobile/alerts"], ["POST", "/mobile/alerts/crit_1/ack"], ["DELETE", "/mobile/devices/abc"], ["POST", "/auth/dev-login"]] as const) assert.equal(isMobileExempt(m, p), true, `${m} ${p}`);
    for (const [m, p] of [["GET", "/mobile/inbox"], ["POST", "/mobile/devices"], ["GET", "/mobile/devices"], ["GET", "/orders"], ["GET", "/mobile/summary"], ["PUT", "/mobile/devices/x/push-token"]] as const) assert.equal(isMobileExempt(m, p), false, `${m} ${p}`);
  });
  it("editions map to plans and the flag is registered", () => {
    assert.deepEqual(PLAN_OF_EDITION, { LITE: "BASIC", PRO: "PRO", CHAIN: "ENTERPRISE" });
    assert.ok(ENTITLEMENT_KEYS.includes("mobile_staff_app"));
    assert.equal(isKnownFlagKey("mobile_staff_app"), false, "kept out of the contract-pinned catalogue until kiorex-contracts adds it");
  });
  it("every push template is bilingual", () => {
    for (const [id, t] of Object.entries(MOBILE_TEMPLATES)) for (const f of ["title", "titleAr", "body", "bodyAr"] as const) assert.ok(t[f].length > 3, `${id}.${f}`);
  });
  it("the safety-alert module never references flags or the mobile entitlement (ADR-025)", () => {
    const dir = join(__dirname, "../mobile-alerts");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.ok(!/FeatureFlagsService|RequiresFlag|MobileEntitlement|mobile_staff_app/.test(src), f);
    }
  });
});
