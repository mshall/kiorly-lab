import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

/** Founder decision A (27 Nov 2026): a lab belongs to its country for life. There is no market switch; the database refuses a change. */
describe("a lab's country is fixed at creation", () => {
  let t: TestApp, lab: Lab;
  before(async () => { t = await bootApp(); lab = await makeLab(t, { vat: 14 }); });
  after(async () => t.close());

  const onboard = (marketCode?: unknown) => call(t, "POST", "/onboarding/tenants", { body: { name: "Fixed Lab", slug: `fixed-${Math.random().toString(36).slice(2, 10)}`, labName: "Fixed", labCode: "FXD", ownerName: "Owner", ownerEmail: `o${Math.random().toString(36).slice(2)}@fixed.test`, ...(marketCode === undefined ? {} : { marketCode }) } });

  it("onboarding stores the country in upper case; the default is EG; malformed or hostile codes are refused", async () => {
    const ok = await onboard("sa");
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const me = await call(t, "GET", "/auth/me", { token: ok.body.token });
    assert.equal(me.body.tenant.marketCode, "SA");
    const def = await onboard();
    assert.equal((await call(t, "GET", "/auth/me", { token: def.body.token })).body.tenant.marketCode, "EG");
    for (const bad of ["EGY", "E", "", "1G", "E G", "'; DROP TABLE \"Tenant\"; --", "<script>", 20, null, ["EG"], { a: 1 }]) {
      const r = await onboard(bad);
      assert.equal(r.status, 400, `${JSON.stringify(bad)} -> ${r.status}`);
    }
  });

  it("no API changes the country: the settings update refuses or ignores a market field, and the row stays the same", async () => {
    for (const body of [{ marketCode: "AE" }, { market: "AE" }, { country: "AE" }]) {
      const r = await call(t, "PUT", "/settings", { token: lab.tokens.OWNER, body });
      assert.ok([200, 400].includes(r.status), `${JSON.stringify(body)} -> ${r.status}`);
    }
    const me = await call(t, "GET", "/auth/me", { token: lab.tokens.OWNER });
    assert.equal(me.body.tenant.marketCode, "EG");
  });

  it("the database refuses a change of the country (last line of defence), and accepts an update that leaves it alone", async () => {
    const orgId = (await t.prisma.tenant.findFirstOrThrow({ where: { slug: lab.slug } })).id;
    await assert.rejects(t.prisma.tenant.update({ where: { id: orgId }, data: { marketCode: "AE" } }), /MARKET_IMMUTABLE/);
    await assert.rejects(t.prisma.tenant.updateMany({ where: { id: orgId }, data: { marketCode: "" } }), /MARKET_IMMUTABLE/);
    await t.prisma.tenant.update({ where: { id: orgId }, data: { name: "Renamed lab", marketCode: "EG" } });
    assert.equal((await t.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } })).name, "Renamed lab");
  });
});
