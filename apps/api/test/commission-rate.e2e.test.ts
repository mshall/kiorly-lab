import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";
import { post } from "./helpers/hmac";

/** COM-2 commission rate (lab): Kiorex reports it over the HMAC integration API; owner, lab director, branch manager and finance read it, read only. Every rate is a TEST placeholder. */
describe("Kiorex commission rate view (lab)", () => {
  let t: TestApp, f: Lab, other: Lab, kx: { key: string; secret: string };
  before(async () => {
    t = await bootApp(); f = await makeLab(t); other = await makeLab(t);
    kx = (await call(t, "POST", "/integration-clients", { token: f.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
  });
  after(async () => { await t.close(); });
  const spec = (o: object = {}) => ({ feeType: "PERCENT", percentBps: 800, flatMinor: null, minMinor: null, maxMinor: null, mode: null, ...o });
  const view = (orgRef: string, version: string, history: object[]) => ({ orgRef, product: "LAB", version, history });
  const def = (version: number, from: string, s: object = spec()) => ({ version, scope: "DEFAULT", kind: "RATE", effectiveFrom: from, reason: null, spec: s });
  const push = (body: object) => post(t, kx, "/integration/v1/commission-rates", body);
  const read = (token: string) => call(t, "GET", "/growth/commission-rate", { token });

  it("with nothing reported the owner sees 'rate not set' (no invented rate)", async () => {
    const r = await read(f.tokens.OWNER);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.known, r.body.state, r.body.effective.spec], [false, "NOT_SET", null]);
  });

  it("Kiorex reports a view: idempotent, newest version wins, a malformed view is refused, a view is stored only for the signing organisation, an unsigned call is refused", async () => {
    assert.equal((await push(view(f.orgId, "100", [def(1, "2026-01-01T00:00:00Z")]))).body.applied, true);
    assert.equal((await push(view(f.orgId, "100", [def(1, "2026-01-01T00:00:00Z", spec({ percentBps: 9999 }))]))).body.applied, false);
    assert.equal((await push(view(f.orgId, "90", []))).body.applied, false);
    assert.equal((await read(f.tokens.OWNER)).body.effective.spec.percentBps, 800);
    assert.equal((await push(view("pr_lab_registration", "200", [def(1, "2026-01-01T00:00:00Z", spec({ percentBps: 700 }))]))).body.applied, true); // Kiorex's own reference (registration id) is accepted, stored for the SIGNING organisation only
    assert.equal((await read(other.tokens.OWNER)).body.known, false);
    assert.equal((await read(f.tokens.OWNER)).body.effective.spec.percentBps, 700);
    assert.equal((await push(view(f.orgId, "250", [def(1, "2026-01-01T00:00:00Z")]))).body.applied, true); // restore for the next test
    assert.equal((await push({ ...view(f.orgId, "200", []), product: "HOTEL" })).status, 400);
    assert.equal((await call(t, "POST", "/integration/v1/commission-rates", { body: view(f.orgId, "300", []) })).status, 401);
  });

  it("shows default, own rate with its reason, upcoming change and history", async () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await push(view(f.orgId, "400", [
      def(1, "2026-01-01T00:00:00Z"),
      { version: 1, scope: "ORG", kind: "RATE", effectiveFrom: "2026-03-01T00:00:00Z", reason: "volume agreement", spec: spec({ feeType: "FLAT", percentBps: null, flatMinor: 2500 }) },
      def(2, future, spec({ percentBps: 1200 })),
    ]));
    const r = (await read(f.tokens.OWNER)).body;
    assert.equal(r.effective.source, "OVERRIDE"); assert.equal(r.effective.reason, "volume agreement"); assert.equal(r.inheriting, false);
    assert.equal(r.default.spec.percentBps, 800); assert.equal(r.upcoming.version, 2); assert.equal(r.history.length, 3);
    assert.equal((await call(t, "GET", "/growth/performance", { token: f.tokens.OWNER })).body.statement.configured, true);
  });

  it("roles: owner, lab director, branch manager and finance read it; bench, reception and signing roles do not; another organisation sees nothing of it", async () => {
    for (const r of ["OWNER", "LAB_DIRECTOR", "BRANCH_MANAGER", "FINANCE"] as const) assert.equal((await read(f.tokens[r]!)).status, 200, r);
    for (const r of ["RECEPTION", "SUPERVISOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST"] as const) assert.equal((await read(f.tokens[r]!)).status, 403, r);
    assert.equal((await read(other.tokens.OWNER)).body.known, false);
  });
});
