import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mfaMandatoryForRole, resetMfaPolicyCache, roleCovered, setCoverageFetcher, type Coverage } from "./mfa-policy";

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; setCoverageFetcher(undefined); });
const cov = (mandatory: string[], partial: string[] = [], enabled = true): Coverage => ({ enabled, types: { lab: { mandatory, partial }, pharmacy: { mandatory: ["*"], partial: [] } } });

describe("MFA policy coverage (lab type)", () => {
  it("off, empty, role lists, wildcard, partial and unknown (fail closed)", () => {
    assert.equal(roleCovered(cov([], [], false), "OWNER", true), false);
    assert.equal(roleCovered(cov([]), "OWNER", true), false);
    assert.equal(roleCovered(cov(["owner", "lab_director"]), "LAB_DIRECTOR", false), true);
    assert.equal(roleCovered(cov(["owner"]), "AUTHORIZED_SIGNATORY", false), false);
    assert.equal(roleCovered(cov(["*"]), "AUTHORIZED_SIGNATORY", false), true);
    assert.equal(roleCovered(cov([], ["owner"]), "OWNER", false), false);
    assert.equal(roleCovered(cov([], ["owner"]), "OWNER", true), true);
    assert.equal(roleCovered(null, "OWNER", false), true);
    assert.equal(roleCovered(cov([]), "OWNER", false, "pharmacy"), true);
  });
  it("without an issuer or when unreadable the answer is mandatory; reads once per 15 s; MFA_POLICY_SOURCE=always pins it", async () => {
    delete process.env.OIDC_ISSUER; delete process.env.KIOREX_OIDC_ISSUER; delete process.env.MFA_POLICY_URL; resetMfaPolicyCache();
    assert.equal(await mfaMandatoryForRole("OWNER"), true);
    process.env.KIOREX_OIDC_ISSUER = "http://passport.invalid"; let calls = 0;
    setCoverageFetcher(async (url) => { calls++; assert.equal(url, "http://passport.invalid/.well-known/kiorex-mfa-policy"); return cov([]); });
    assert.equal(await mfaMandatoryForRole("OWNER"), false); assert.equal(await mfaMandatoryForRole("LAB_DIRECTOR"), false); assert.equal(calls, 1);
    process.env.MFA_POLICY_SOURCE = "always"; assert.equal(await mfaMandatoryForRole("OWNER"), true);
  });
});
