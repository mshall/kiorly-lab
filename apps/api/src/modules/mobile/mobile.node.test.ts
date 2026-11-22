import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isMobileExempt } from "./mobile.guard";
import { MOBILE_TEMPLATES } from "../../adapters/mobile-push.adapter";
import { PLAN_OF_EDITION } from "./mobile-entitlement.service";
import { ENTITLEMENT_KEYS, isKnownFlagKey } from "../../feature-flags/feature-flag-keys";

describe("Kiorly Team: entitlement plumbing", () => {
  it("only the safety inbox, bootstrap, auth and remote sign-out are exempt (ADR-025)", () => {
    for (const [m, p] of [["GET", "/mobile/bootstrap"], ["GET", "/mobile/alerts"], ["POST", "/mobile/alerts/crit_1/ack"], ["POST", "/mobile/upgrade-request"], ["DELETE", "/mobile/devices/abc"], ["POST", "/auth/dev-login"]] as const) assert.equal(isMobileExempt(m, p), true, `${m} ${p}`);
    for (const [m, p] of [["GET", "/mobile/inbox"], ["GET", "/mobile/upgrade-request"], ["POST", "/mobile/devices"], ["GET", "/mobile/devices"], ["GET", "/orders"], ["GET", "/mobile/summary"], ["PUT", "/mobile/devices/x/push-token"]] as const) assert.equal(isMobileExempt(m, p), false, `${m} ${p}`);
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

import { startOfLocalDay } from "./local-day";
describe("mobile 'today' uses the lab timezone (Africa/Cairo), not the UTC day", () => {
  const z = "Africa/Cairo";
  it("22:30 UTC (00:30 Cairo, UTC+2 winter) is already the next local day", () => {
    assert.equal(startOfLocalDay(new Date("2026-11-20T22:30:00Z"), z).toISOString(), "2026-11-20T22:00:00.000Z");
  });
  it("23:59 UTC and 00:30 UTC straddle correctly", () => {
    assert.equal(startOfLocalDay(new Date("2026-11-20T21:59:00Z"), z).toISOString(), "2026-11-19T22:00:00.000Z");
    assert.equal(startOfLocalDay(new Date("2026-11-21T00:30:00Z"), z).toISOString(), "2026-11-20T22:00:00.000Z");
  });
  it("summer time (UTC+3) shifts the boundary", () => {
    assert.equal(startOfLocalDay(new Date("2026-07-10T21:30:00Z"), z).toISOString(), "2026-07-10T21:00:00.000Z");
  });
  it("UTC zone keeps the UTC day", () => {
    assert.equal(startOfLocalDay(new Date("2026-11-20T22:30:00Z"), "UTC").toISOString(), "2026-11-20T00:00:00.000Z");
  });
});

import { MobileGuard } from "./mobile.guard";
import { isMobilePlanGated } from "./mobile-gate";
describe("plan gate (FEATURE_DISABLED) precedes RBAC (FORBIDDEN) on /mobile routes", () => {
  const req = (url: string, user: object, deferredPerms?: string[], headers: Record<string, string> = {}) => ({ originalUrl: `/api/v1${url}`, method: "GET", headers, user, deferredPerms });
  const ctx = (r: object) => ({ switchToHttp: () => ({ getRequest: () => r }) }) as never;
  const guard = (enabled: boolean) => new MobileGuard({} as never, { evaluate: () => ({ enabled, reason: enabled ? null : "PLAN_BELOW_PRO" }) } as never);
  const basicNurse = { orgId: "o", staffId: "s", role: "RECEPTION", edition: "LITE", marketCode: "EG" };
  it("gates /mobile/* and app-identified requests, not the exempt ones", () => {
    assert.equal(isMobilePlanGated(req("/mobile/summary", {}) as never), true);
    assert.equal(isMobilePlanGated(req("/orders", {}, undefined, { "x-kiorly-client": "kiorly-team/1.0" }) as never), true);
    assert.equal(isMobilePlanGated(req("/orders", {}, undefined, { "x-kiorly-client": "kiorly-work/1.0" }) as never), true); // legacy client id
    assert.equal(isMobilePlanGated(req("/orders", {}) as never), false);
    assert.equal(isMobilePlanGated(req("/mobile/alerts", {}) as never), false);
  });
  it("non-entitled org lacking the permission gets FEATURE_DISABLED", async () => {
    await assert.rejects(() => guard(false).canActivate(ctx(req("/mobile/summary", basicNurse, ["staff.manage"]))), (e: { getResponse(): { code: string } }) => e.getResponse().code === "FEATURE_DISABLED");
  });
  it("entitled org lacking the permission still gets FORBIDDEN; with it, passes", async () => {
    await assert.rejects(() => guard(true).canActivate(ctx(req("/mobile/summary", basicNurse, ["staff.manage"]))), (e: { getResponse(): { code: string } }) => e.getResponse().code === "FORBIDDEN");
    assert.equal(await guard(true).canActivate(ctx(req("/mobile/summary", basicNurse, undefined))), true);
  });
});
