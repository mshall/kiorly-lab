import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, qcPass, toProcessing } from "./helpers/app";
import { post } from "./helpers/hmac";

/** GRW-P4-B2 partner half: the optional Kiorex acquisition block is stored, credits the organisation's own link once, and is ignored when absent, malformed or foreign. */
describe("Product acquisition block (lab)", () => {
  let t: TestApp, lab: Lab, other: Lab, kx: { key: string; secret: string }, kxOther: { key: string; secret: string };
  const hash = "b".repeat(64);
  before(async () => {
    t = await bootApp(); lab = await makeLab(t); other = await makeLab(t);
    kx = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
    kxOther = (await call(t, "POST", "/integration-clients", { token: other.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
  });
  after(async () => t.close());
  const mkLink = async (l: Lab) => { const r = await call(t, "POST", "/growth/links", { token: l.tokens.OWNER, body: { label: "Reception link", ownerScope: "ORG" } }); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body as { id: string; code: string }; };
  const block = (code: string | undefined, extra: object = {}) => ({ origin: "PROVIDER_LED", decisionId: `dec-${randomUUID()}`, policyVersion: "pv1", reason: "PRIOR_PROVIDER_TOUCH", evidenceHash: hash, product: "LAB", ...(code ? { linkCode: code } : {}), ...extra });
  const booking = (acquisition?: object) => ({ sourceRef: `kx_${randomUUID().slice(0, 8)}`, patient: { fullName: "Hassan Booking", phone: "+201000000555", dateOfBirth: "1988-03-03", externalId: "sub_01JF3Z0001", sex: "M" }, testCodes: ["CBC"], identifiersChecked: ["dateOfBirth", "phone"], consentChannels: ["KIOREX_VAULT"], ...(acquisition ? { acquisition } : {}) });
  const daily = async (linkId: string) => (await t.prisma.providerReferralLinkDaily.findMany({ where: { linkId } })).reduce((a, d) => ({ orders: a.orders + d.orders, completed: a.completed + d.completed }), { orders: 0, completed: 0 });

  it("stores the block, credits the own link once (replay safe) and counts the release once", async () => {
    const l = await mkLink(lab);
    const body = booking(block(l.code));
    const a = await post(t, kx, "/integration/v1/orders", body); assert.equal(a.status, 200, JSON.stringify(a.body)); assert.equal(a.body.created, true);
    assert.equal((await post(t, kx, "/integration/v1/orders", body)).body.created, false);
    const row = await t.prisma.labOrder.findUniqueOrThrow({ where: { id: a.body.orderId } });
    assert.deepEqual([row.acquisitionOrigin, row.acquisitionLinkId, row.acquisitionReason], ["PROVIDER_LED", l.id, "PRIOR_PROVIDER_TOUCH"]);
    assert.deepEqual(await daily(l.id), { orders: 1, completed: 0 });
    const o = await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.TECHNOLOGIST });
    const f = { orderId: a.body.orderId, order: o.body, specimens: o.body.specimens.map((s: { id: string; barcode: string }) => ({ id: s.id, barcode: s.barcode })) };
    await toProcessing(t, lab, f); await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT"]);
    await enterAndTechValidate(t, lab, f.orderId, NORMAL);
    await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const signed = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY }); assert.equal(signed.status, 201, JSON.stringify(signed.body));
    const rel = await call(t, "POST", `/reports/${signed.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["KIOREX_VAULT"] } }); assert.equal(rel.status, 201, JSON.stringify(rel.body));
    await call(t, "POST", `/reports/${signed.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["KIOREX_VAULT"] } });
    assert.deepEqual(await daily(l.id), { orders: 1, completed: 1 });
  });

  it("MARKETPLACE, absent, malformed and other-product blocks change no counter and never fail the booking", async () => {
    const l = await mkLink(lab);
    for (const acq of [block(l.code, { origin: "MARKETPLACE" }), undefined, { origin: "PROVIDER_LED" }, block(l.code, { evidenceHash: "xyz" }), block(l.code, { product: "PHARMACY" }), block("ILLEGAL1")]) {
      const r = await post(t, kx, "/integration/v1/orders", booking(acq)); assert.equal(r.status, 200, JSON.stringify(acq));
    }
    assert.deepEqual(await daily(l.id), { orders: 0, completed: 0 });
  });

  it("another organisation's code is never credited; a Clinic client cannot carry the block; the origin column is constrained", async () => {
    const mine = await mkLink(lab), theirs = await mkLink(other);
    const a = await post(t, kx, "/integration/v1/orders", booking(block(theirs.code))); assert.equal(a.status, 200);
    const row = await t.prisma.labOrder.findUniqueOrThrow({ where: { id: a.body.orderId } });
    assert.equal(row.acquisitionLinkId, null);
    assert.deepEqual(await daily(theirs.id), { orders: 0, completed: 0 }); assert.deepEqual(await daily(mine.id), { orders: 0, completed: 0 });
    const clinic = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIORLY_CLINIC" } })).body;
    const c = await post(t, clinic, "/integration/v1/orders", { sourceRef: `cl_${randomUUID().slice(0, 8)}`, patient: { fullName: "Clinic Patient", phone: "+201000000666", dateOfBirth: "1970-07-07", externalId: "clinic_pat_1" }, testCodes: ["GLU"], acquisition: block(mine.code) });
    assert.equal(c.status, 200); assert.equal((await t.prisma.labOrder.findUniqueOrThrow({ where: { id: c.body.orderId } })).acquisitionOrigin, null);
    assert.deepEqual(await daily(mine.id), { orders: 0, completed: 0 });
    await assert.rejects(t.prisma.$executeRaw`UPDATE "LabOrder" SET "acquisitionOrigin" = 'BOGUS' WHERE id = ${row.id}`);
    void kxOther;
  });
});
