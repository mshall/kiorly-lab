import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRequest, deriveStatusToken, intakeUrl, kiorexHost, progressPct, publicApiBase, signConnectBody, validatePayoutLabel } from "./kiorex-connect.core";
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
});
