import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRequest, deriveIntakeSigningKey, enrolmentIdOf, intakeHeaders, isEnrolmentCode, newIntakeNonce, deriveStatusToken, intakeUrl, kiorexHost, progressPct, publicApiBase, signConnectBody, validatePayoutLabel } from "./kiorex-connect.core";
import { computeLabSteps, type LabConnectFacts } from "./kiorex-connect.logic";

const ready = (o: Partial<LabConnectFacts> = {}): LabConnectFacts => ({ status: "CONSENTED", labs: 1, activeTests: 20, pricedTests: 20, labsMissingHours: 0, labsMissingLicenceNo: 0, licenceDocument: true, homeCollectionConfigured: false, payoutLabel: true, termsAccepted: true, liveOnKiorex: false, ...o });
const st = (f: LabConnectFacts, k: string) => computeLabSteps(f).find((s) => s.key === k)!.status;

describe("lab Connect to Kiorex (ADR-040)", () => {
  it("a complete standalone lab can request registration; home collection is optional", () => {
    const steps = computeLabSteps(ready());
    assert.equal(canRequest(steps, "CONSENTED"), true); assert.equal(steps.find((s) => s.key === "home_collection")?.optional, true); assert.equal(st(ready(), "request"), "action_needed");
  });
  it("price list completeness counts unpriced tests", () => {
    assert.equal(st(ready({ pricedTests: 18 }), "price_list"), "action_needed");
    assert.equal(computeLabSteps(ready({ pricedTests: 18 })).find((s) => s.key === "price_list")?.detail?.unpriced, 2);
    assert.equal(st(ready({ activeTests: 0, pricedTests: 0 }), "catalogue"), "action_needed");
  });
  it("licence needs the licence number on every lab and the uploaded document", () => {
    assert.equal(st(ready({ labsMissingLicenceNo: 1 }), "licence"), "action_needed"); assert.equal(st(ready({ licenceDocument: false }), "licence"), "action_needed");
  });
  it("any gap blocks the request; once sent it waits on Kiorex; approved and live is 100 percent", () => {
    for (const o of [{ labs: 0 }, { payoutLabel: false }, { termsAccepted: false }, { labsMissingHours: 1 }] as const) assert.equal(st(ready(o), "request"), "blocked");
    assert.equal(st(ready({ status: "REQUESTED" }), "request"), "waiting_kiorex");
    assert.equal(progressPct(computeLabSteps(ready({ status: "APPROVED", liveOnKiorex: true }))), 100);
  });
  it("payout is a label only", () => {
    assert.equal(validatePayoutLabel("Settlement account").ok, true); assert.equal(validatePayoutLabel("4111 1111 1111 1111").ok, false);
  });
  it("derived status token, signing and lab default port", () => {
    assert.equal(deriveStatusToken("k", "o"), deriveStatusToken("k", "o")); assert.match(signConnectBody("s", 1, "{}"), /^sha256=/);
    assert.equal(intakeUrl(kiorexHost({})), "http://localhost:4000/api/v1/partners/v1/connection-requests"); assert.equal(publicApiBase({}), "http://localhost:3200");
  });
  it("intake auth (contracts 1.9.0): enrolment code signs the first request, the issued key later ones; same derivation as kiorex-contracts", () => {
    const code = "kxe_AAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    assert.equal(deriveIntakeSigningKey(code), "a0ce8b1dc66e4970ef3b844867fabe228c276e5bfffaccfe2ace5e67232adac3"); // contracts test vector
    const h = intakeHeaders(code, 1700000000, '{"a":1}', code);
    assert.equal(h["X-Kiorly-Signature"], "sha256=0f75288125b5933d50f18d797e51ff3160081300fb82c2b8753a22711baf3e14"); // contracts test vector
    assert.equal(h["X-Kiorex-Enrolment"], "kxe_AAAAAAAA");
    assert.equal(intakeHeaders("kxi_secret", 1, "{}")["X-Kiorex-Enrolment"], undefined);
    assert.equal(isEnrolmentCode(code), true); assert.equal(isEnrolmentCode("kxe_short"), false); assert.equal(isEnrolmentCode(undefined), false);
    assert.match(newIntakeNonce(), /^[A-Za-z0-9_-]{16,64}$/);
    assert.equal(enrolmentIdOf(code), "kxe_AAAAAAAA");
  });
});
