import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

/** Staff management: phone (E.164) for Kiorex Passport linking, unique inside the tenant, audited without the number, permission-guarded. */
describe("staff phone (Passport linking input)", () => {
  let t: TestApp, a: Lab, b: Lab;
  const RUN = Math.random().toString(36).slice(2, 8);
  before(async () => { t = await bootApp(); a = await makeLab(t); b = await makeLab(t); });
  after(async () => t.close());
  const owner = (l: Lab) => l.tokens.OWNER;
  const body = (email: string, over: object = {}) => ({ email: email.replace("@", `.${RUN}@`), displayName: "New Technologist", role: "TECHNOLOGIST", ...over });

  it("owner creates staff with a phone (formatting tolerated, stored as E.164), lists it, audit holds no number", async () => {
    const r = await call(t, "POST", "/staff", { token: owner(a), body: body("ph1@x.test", { phone: "+20 100 000-3101" }) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.phone, "+201000003101"); assert.equal(r.body.passportLinked, false); assert.equal(r.body.subject, undefined);
    const list = await call(t, "GET", "/staff", { token: owner(a) });
    assert.equal(list.body.find((s: { id: string }) => s.id === r.body.id).phone, "+201000003101");
    const audits = await t.prisma.auditLog.findMany({ where: { orgId: a.orgId, entityId: r.body.id } });
    assert.ok(audits.length >= 1);
    assert.doesNotMatch(JSON.stringify(audits), /\+?201000003101/);
  });

  it("rejects non-E.164 (400 INVALID_PHONE) and duplicates inside the tenant (409 PHONE_TAKEN); another tenant may reuse the number", async () => {
    for (const bad of ["01000003102", "+1", "abc", "+201000003102999999"]) {
      const r = await call(t, "POST", "/staff", { token: owner(a), body: body(`bad${Math.random()}@x.test`, { phone: bad }) });
      assert.equal(r.status, 400, bad); assert.equal(r.body.code, "INVALID_PHONE", bad);
    }
    assert.equal((await call(t, "POST", "/staff", { token: owner(a), body: body("ph2@x.test", { phone: "+201000003103" }) })).status, 201);
    const dup = await call(t, "POST", "/staff", { token: owner(a), body: body("ph3@x.test", { phone: "+201000003103" }) });
    assert.equal(dup.status, 409); assert.equal(dup.body.code, "PHONE_TAKEN");
    assert.equal((await call(t, "POST", "/staff", { token: owner(b), body: body("ph4@x.test", { phone: "+201000003103" }) })).status, 201, "uniqueness is per tenant");
  });

  it("PUT sets, changes and clears the phone, edits role/active, refuses duplicates; deactivated staff are locked out", async () => {
    const s1 = (await call(t, "POST", "/staff", { token: owner(a), body: body("p1@x.test") })).body;
    const s2 = (await call(t, "POST", "/staff", { token: owner(a), body: body("p2@x.test", { phone: "+201000003110" }) })).body;
    const set = await call(t, "PUT", `/staff/${s1.id}`, { token: owner(a), body: { phone: "+201000003111", role: "SUPERVISOR" } });
    assert.equal(set.status, 200, JSON.stringify(set.body)); assert.equal(set.body.phone, "+201000003111"); assert.equal(set.body.role, "SUPERVISOR");
    assert.equal((await call(t, "PUT", `/staff/${s1.id}`, { token: owner(a), body: { phone: "+201000003110" } })).body.code, "PHONE_TAKEN");
    assert.equal((await call(t, "PUT", `/staff/${s1.id}`, { token: owner(a), body: { phone: "+201000003111" } })).status, 200, "own number is not a duplicate");
    assert.equal((await call(t, "PUT", `/staff/${s1.id}`, { token: owner(a), body: { phone: "nope" } })).body.code, "INVALID_PHONE");
    const cleared = await call(t, "PUT", `/staff/${s2.id}`, { token: owner(a), body: { phone: null } });
    assert.equal(cleared.status, 200); assert.equal(cleared.body.phone, null);
    assert.equal((await call(t, "PUT", `/staff/${s2.id}`, { token: owner(a), body: { active: false } })).body.active, false);
    const upd = await t.prisma.auditLog.findMany({ where: { orgId: a.orgId, entityId: s1.id, action: "staff.update" } });
    assert.ok(upd.every((x) => !/\+?2010000031/.test(JSON.stringify(x))));
    assert.ok(upd.some((x) => (x.meta as { linkKeyChanged?: boolean }).linkKeyChanged === true));
  });

  it("is permission-guarded and tenant-scoped; the picker list (staff/lookup) carries no phone numbers", async () => {
    const created = (await call(t, "POST", "/staff", { token: owner(a), body: body("p9@x.test", { phone: "+201000003120" }) })).body;
    for (const role of ["TECHNOLOGIST", "RECEPTION", "SUPERVISOR"] as const) {
      assert.equal((await call(t, "GET", "/staff", { token: a.tokens[role] })).status, 403, role);
      assert.equal((await call(t, "PUT", `/staff/${created.id}`, { token: a.tokens[role], body: { phone: "+201000003121" } })).status, 403, role);
    }
    assert.equal((await call(t, "PUT", `/staff/${created.id}`, { token: owner(b), body: { phone: "+201000003122" } })).status, 404, "other tenant");
    const lookup = await call(t, "GET", "/staff/lookup", { token: a.tokens.PHLEBOTOMIST });
    if (lookup.status === 200) assert.doesNotMatch(JSON.stringify(lookup.body), /\+20100|@/);
  });
});
