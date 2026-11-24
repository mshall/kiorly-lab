import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";
import { post } from "./helpers/hmac";

describe("Kiorex tab: pause/resume of the whole listing, per-user card dismissal, shared sign-in throttle", () => {
  let t: TestApp, lab: Lab, kx: { key: string; secret: string }, clinic: { key: string; secret: string };
  before(async () => {
    t = await bootApp(); lab = await makeLab(t);
    kx = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
    clinic = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIORLY_CLINIC" } })).body;
  });
  after(async () => t.close());
  const owner = () => lab.tokens.OWNER;
  const booking = () => ({ sourceRef: `kx_${randomUUID().slice(0, 8)}`, patient: { fullName: "Hassan Booking", phone: "+201000000555", dateOfBirth: "1988-03-03", externalId: "sub_01JF3Z0001", sex: "M" }, testCodes: ["CBC"], consentChannels: ["KIOREX_VAULT"] });

  it("pausing hides the labs and refuses new Kiorex bookings (409 LISTING_PAUSED) but not Clinic orders; resume restores; audited", async () => {
    assert.equal((await post(t, kx, "/integration/v1/labs", undefined, { method: "GET" })).body.items.length > 0, true);
    const st = await call(t, "GET", "/kiorex-connect/front-door", { token: owner() });
    assert.equal(st.body.state, "LIVE"); assert.equal(st.body.listing.paused, false);
    const p = await call(t, "POST", "/kiorex-connect/front-door/listing/pause", { token: owner(), body: { reason: "Analyzer service" } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.deepEqual({ paused: p.body.listing.paused, reason: p.body.listing.reason }, { paused: true, reason: "Analyzer service" });
    assert.deepEqual((await post(t, kx, "/integration/v1/labs", undefined, { method: "GET" })).body.items, []);
    const refused = await post(t, kx, "/integration/v1/orders", booking());
    assert.equal(refused.status, 409); assert.equal(refused.body.code, "LISTING_PAUSED");
    const c = await post(t, clinic, "/integration/v1/orders", { sourceRef: `cl_${randomUUID().slice(0, 8)}`, patient: { fullName: "Clinic Patient", phone: "+201000000666", dateOfBirth: "1970-07-07", externalId: "clinic_pat_1" }, testCodes: ["GLU"] });
    assert.equal(c.status, 200, "the lab's own Kiorly Clinic handoff is not a Kiorex listing");
    assert.equal((await call(t, "POST", "/kiorex-connect/front-door/listing/pause", { token: owner(), body: {} })).body.listing.paused, true, "idempotent");
    const r = await call(t, "POST", "/kiorex-connect/front-door/listing/resume", { token: owner() });
    assert.equal(r.body.listing.paused, false);
    assert.equal((await post(t, kx, "/integration/v1/orders", booking())).status, 200);
    const actions = (await t.prisma.auditLog.findMany({ where: { orgId: lab.orgId, entityType: "KiorexListing" }, orderBy: { at: "asc" } })).map((a) => a.action);
    assert.deepEqual(actions, ["kiorex_listing.paused", "kiorex_listing.resumed"]);
  });

  it("only settings.manage can pause", async () => {
    assert.equal((await call(t, "POST", "/kiorex-connect/front-door/listing/pause", { token: lab.tokens.RECEPTION, body: {} })).status, 403);
  });

  it("dismissed cards are stored per user on the server", async () => {
    const a = lab.tokens.OWNER, b = lab.tokens.LAB_DIRECTOR;
    assert.deepEqual((await call(t, "GET", "/me/preferences/dismissed-cards", { token: a })).body, { keys: [] });
    const put = await call(t, "PUT", "/me/preferences/dismissed-cards", { token: a, body: { keys: ["kiorex-home", "kiorex-home"] } });
    assert.equal(put.status, 200); assert.deepEqual(put.body, { keys: ["kiorex-home"] });
    assert.deepEqual((await call(t, "GET", "/me/preferences/dismissed-cards", { token: a })).body, { keys: ["kiorex-home"] });
    assert.deepEqual((await call(t, "GET", "/me/preferences/dismissed-cards", { token: b })).body, { keys: [] });
    assert.equal((await call(t, "PUT", "/me/preferences/dismissed-cards", { token: a, body: { keys: ["bad key"] } })).status, 400);
    assert.equal((await call(t, "GET", "/me/preferences/dismissed-cards")).status, 401);
  });

  it("the Home handoff sign-in throttle is counted in Postgres (429 after 10 attempts)", async () => {
    const body = { orgSlug: `nope-${randomUUID().slice(0, 6)}`, email: "x@y.test" };
    let last = 0; for (let i = 0; i < 12; i++) last = (await call(t, "POST", "/auth/handoff/login", { body, headers: { origin: process.env.KIORLY_HOME_ORIGIN ?? "http://localhost:5194" } })).status;
    assert.equal(last, 429);
    assert.ok((await t.prisma.$queryRawUnsafe<{ count: number }[]>(`SELECT "count" FROM "RateLimitBucket" WHERE "key" LIKE $1`, `signin:${body.orgSlug}%`)).length >= 1);
  });
});
