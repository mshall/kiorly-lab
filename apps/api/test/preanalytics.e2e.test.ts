import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab, makeOrder, toProcessing } from "./helpers/app";

describe("M3 pre-analytics: rejection -> recollection, aliquot volumes, storage + retention + disposal, manifests + courier tracking", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => { t = await bootApp(); lab = await makeLab(t); });
  after(async () => t.close());
  const T = () => lab.tokens;

  it("rejection with the extended reasons raises a recollection request, notifies, and closes when the replacement is collected", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    const sp = f.specimens[0]!;
    await call(t, "POST", `/specimens/${sp.id}/collect`, { token: T().RECEPTION, body: { scannedBarcode: sp.barcode } });
    await call(t, "POST", `/specimens/${sp.id}/receive`, { token: T().TECHNOLOGIST, body: { scannedBarcode: sp.barcode } });
    assert.equal((await call(t, "POST", `/specimens/${sp.id}/reject`, { token: T().RECEPTION, body: { reason: "LIPAEMIC" } })).status, 403);
    const rej = await call(t, "POST", `/specimens/${sp.id}/reject`, { token: T().TECHNOLOGIST, body: { reason: "LIPAEMIC", note: "milky serum" } });
    assert.equal(rej.status, 201, JSON.stringify(rej.body));
    const list = await call(t, "GET", "/recollections", { token: T().RECEPTION });
    const rc = list.body.find((r: any) => r.rejectedSpecimenId === sp.id);
    assert.equal(rc.status, "NOTIFIED");
    assert.equal(rc.reason, "LIPAEMIC");
    assert.equal(rc.replacement.id, rej.body.recollection.id);
    const n = await call(t, "POST", `/recollections/${rc.id}/notify`, { token: T().TECHNOLOGIST });
    assert.equal(n.status, 201);
    const sent = await t.prisma.notificationAttempt.count({ where: { orgId: lab.orgId, purpose: "RECOLLECTION" } });
    assert.equal(sent, 2);
    const re = rej.body.recollection;
    await call(t, "POST", `/specimens/${re.id}/collect`, { token: T().RECEPTION, body: { scannedBarcode: re.barcode } });
    const after = await call(t, "GET", "/recollections?status=COLLECTED", { token: T().RECEPTION });
    assert.ok(after.body.some((r: any) => r.id === rc.id && r.resolvedAt));
    assert.equal((await call(t, "POST", `/recollections/${rc.id}/cancel`, { token: T().TECHNOLOGIST })).status, 409);
  });

  it("aliquoting by volume draws the parent down and refuses to overdraw", async () => {
    const f = await makeOrder(t, lab, ["CBC"], { patient: { fullName: "Aliquot Pt", dateOfBirth: "1980-02-02", phone: "+201333000111" } });
    await toProcessing(t, lab, f);
    const parent = f.specimens[0]!;
    const before = (await call(t, "GET", `/specimens/${parent.id}`, { token: T().TECHNOLOGIST })).body;
    assert.equal(Number(before.volumeMl), 3);
    const a = await call(t, "POST", `/specimens/${parent.id}/aliquots`, { token: T().TECHNOLOGIST, body: { count: 2, volumeMl: 1 } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.deepEqual(a.body.map((x: any) => Number(x.volumeMl)), [1, 1]);
    assert.equal(Number((await call(t, "GET", `/specimens/${parent.id}`, { token: T().TECHNOLOGIST })).body.volumeMl), 1);
    const over = await call(t, "POST", `/specimens/${parent.id}/aliquots`, { token: T().TECHNOLOGIST, body: { count: 2, volumeMl: 1 } });
    assert.equal(over.status, 422);
    assert.equal(over.body.code, "INSUFFICIENT_VOLUME");
  });

  it("storage: units, auto/explicit slots, one specimen per slot, moves, locate, retention and disposal worklist", async () => {
    const unit = await call(t, "POST", "/storage/units", { token: T().TECHNOLOGIST, body: { name: "Fridge-1", kind: "FRIDGE", rows: 2, cols: 2, tempMinC: 2, tempMaxC: 8 } });
    assert.equal(unit.status, 201);
    assert.equal((await call(t, "POST", "/storage/units", { token: T().TECHNOLOGIST, body: { name: "Fridge-1" } })).status, 409);
    assert.equal((await call(t, "POST", "/storage/units", { token: T().PHLEBOTOMIST, body: { name: "X" } })).status, 403);
    await call(t, "PUT", "/retention-rules", { token: T().TECHNOLOGIST, body: { specimenType: "Serum", retentionDays: 3 } });
    const mk = async (n: number) => {
      const f = await makeOrder(t, lab, ["GLU"], { patient: { fullName: `Store ${n}`, dateOfBirth: "1970-01-0" + n, phone: `+20144400000${n}` } });
      await toProcessing(t, lab, f);
      return f.specimens[0]!;
    };
    const [s1, s2, s3] = [await mk(1), await mk(2), await mk(3)];
    const a1 = await call(t, "POST", `/specimens/${s1.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id, scannedBarcode: s1.barcode } });
    assert.equal(a1.status, 201, JSON.stringify(a1.body));
    assert.equal(a1.body.location, "Fridge-1/A1");
    assert.equal((await call(t, "GET", `/specimens/${s1.id}`, { token: T().TECHNOLOGIST })).body.status, "STORED");
    assert.equal((await call(t, "POST", `/specimens/${s2.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id, slot: "A1" } })).body.code, "SLOT_OCCUPIED");
    assert.equal((await call(t, "POST", `/specimens/${s2.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id, slot: "C9" } })).body.code, "SLOT_INVALID");
    assert.equal((await call(t, "POST", `/specimens/${s2.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id, scannedBarcode: "WRONG" } })).body.code, "LABEL_MISMATCH");
    assert.equal((await call(t, "GET", `/specimens/${s2.id}`, { token: T().TECHNOLOGIST })).body.status, "PROCESSING", "failed store leaves the specimen untouched");
    assert.equal((await call(t, "POST", `/specimens/${s2.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id } })).body.location, "Fridge-1/A2");
    const mv = await call(t, "POST", `/specimens/${s1.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id, slot: "B2" } });
    assert.equal(mv.body.location, "Fridge-1/B2");
    assert.equal((await call(t, "POST", `/specimens/${s3.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id } })).body.location, "Fridge-1/A1", "freed slot is reused");
    assert.equal((await call(t, "POST", `/specimens/${(await mk(4)).id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id } })).body.location, "Fridge-1/B1");
    const full = await mk(5);
    assert.equal((await call(t, "POST", `/specimens/${full.id}/storage`, { token: T().TECHNOLOGIST, body: { unitId: unit.body.id } })).body.code, "STORAGE_UNIT_FULL");
    const loc = await call(t, "GET", `/storage/locate?barcode=${encodeURIComponent(s1.barcode)}`, { token: T().RECEPTION });
    assert.equal(loc.body.location.slot, "B2");
    const grid = await call(t, "GET", `/storage/units/${unit.body.id}`, { token: T().TECHNOLOGIST });
    assert.equal(grid.body.slots.length, 4);
    const units = await call(t, "GET", "/storage/units", { token: T().TECHNOLOGIST });
    assert.equal(units.body.find((x: any) => x.name === "Fridge-1").occupied, 4);
    const chain = await call(t, "GET", `/specimens/${s1.id}/custody`, { token: T().TECHNOLOGIST });
    assert.deepEqual(chain.body.map((e: any) => e.type).slice(-2), ["STORED", "STORED"]);
    assert.ok(chain.body.at(-1).location.endsWith("B2"));

    // retention + disposal
    assert.equal((await call(t, "GET", "/storage/disposal-due", { token: T().TECHNOLOGIST })).body.length, 0);
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const due = await call(t, "GET", `/storage/disposal-due?asOf=${encodeURIComponent(future)}`, { token: T().TECHNOLOGIST });
    assert.equal(due.body.length, 4, "3-day Serum rule has elapsed 5 days from now");
    const early = await call(t, "POST", "/storage/dispose", { token: T().TECHNOLOGIST, body: { specimenIds: [s1.id] } });
    assert.equal(early.body[0].code, "RETENTION_NOT_ELAPSED");
    await t.prisma.specimen.update({ where: { id: s1.id }, data: { retentionUntil: new Date(Date.now() - 1000) } });
    const disp = await call(t, "POST", "/storage/dispose", { token: T().TECHNOLOGIST, body: { specimenIds: [s1.id] } });
    assert.equal(disp.body[0].ok, true);
    assert.equal((await call(t, "GET", `/storage/locate?specimenId=${s1.id}`, { token: T().TECHNOLOGIST })).body.location, null);
    assert.equal((await call(t, "GET", `/specimens/${s1.id}`, { token: T().TECHNOLOGIST })).body.status, "DISPOSED");
    // retrieve for re-test frees the slot
    const r = await call(t, "POST", `/specimens/${s2.id}/retrieve`, { token: T().TECHNOLOGIST });
    assert.equal(r.body.status, "PROCESSING");
    assert.equal((await call(t, "GET", `/storage/locate?specimenId=${s2.id}`, { token: T().TECHNOLOGIST })).body.location, null);
  });

  it("manifests: inter-branch + send-out, dispatch, courier events, scan receipt with missing item, public tracking without PHI", async () => {
    const branch = { body: await t.prisma.lab.create({ data: { orgId: lab.orgId, name: "Giza Branch", code: "GZ" } }) };
    const mk = async (n: number) => {
      const f = await makeOrder(t, lab, ["GLU"], { patient: { fullName: `Ship ${n}`, dateOfBirth: "1960-01-0" + n, phone: `+20155500000${n}` } });
      await toProcessing(t, lab, f);
      return f.specimens[0]!;
    };
    const [a, b] = [await mk(1), await mk(2)];
    const bad = await call(t, "POST", "/manifests", { token: T().TECHNOLOGIST, body: { kind: "INTER_BRANCH", specimenIds: [a.id] } });
    assert.equal(bad.body.code, "DESTINATION_LAB_REQUIRED");
    const courier = await call(t, "POST", "/couriers", { token: T().TECHNOLOGIST, body: { name: "FastCourier", phone: "+201000000777", company: "FC Ltd" } });
    const m = await call(t, "POST", "/manifests", { token: T().TECHNOLOGIST, body: { kind: "INTER_BRANCH", toLabId: branch.body.id, specimenIds: [a.id, b.id], courierId: courier.body.id, temperatureC: 6 } });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    assert.match(m.body.number, /^MAN-\d{4}-\d{6}$/);
    assert.equal(m.body.courierName, "FastCourier");
    assert.equal((await call(t, "POST", "/manifests", { token: T().TECHNOLOGIST, body: { kind: "INTER_BRANCH", toLabId: branch.body.id, specimenIds: [a.id] } })).body.code, "SPECIMEN_ALREADY_ON_MANIFEST");
    assert.equal((await call(t, "POST", `/manifests/${m.body.id}/receive`, { token: T().TECHNOLOGIST, body: { barcodes: [] } })).status, 409, "cannot receive a draft");
    const d = await call(t, "POST", `/manifests/${m.body.id}/dispatch`, { token: T().TECHNOLOGIST, body: { temperatureC: 5.5 } });
    assert.equal(d.body.status, "DISPATCHED");
    const chain = await call(t, "GET", `/specimens/${a.id}/custody`, { token: T().TECHNOLOGIST });
    assert.equal(chain.body.at(-1).type, "TRANSPORT_STARTED");
    const ev = await call(t, "POST", `/manifests/${m.body.id}/events`, { token: T().TECHNOLOGIST, body: { status: "IN_TRANSIT", location: "Ring Road" } });
    assert.equal(ev.body.status, "IN_TRANSIT");
    const pub = await call(t, "GET", `/public/track/${m.body.trackingRef}`);
    assert.equal(pub.status, 200);
    assert.equal(pub.body.status, "IN_TRANSIT");
    assert.equal(pub.body.specimens, 2);
    assert.ok(!/Ship|accession|barcode|fullName/i.test(JSON.stringify(pub.body)), "public tracking carries no patient or specimen identifiers");
    assert.equal((await call(t, "GET", "/public/track/TRK-NOPE")).status, 404);
    assert.equal((await call(t, "POST", `/manifests/${m.body.id}/receive`, { token: T().TECHNOLOGIST, body: { barcodes: ["NOT-ON-IT"] } })).body.code, "BARCODE_NOT_ON_MANIFEST");
    const rc = await call(t, "POST", `/manifests/${m.body.id}/receive`, { token: T().TECHNOLOGIST, body: { barcodes: [a.barcode], note: "one tube missing" } });
    assert.equal(rc.status, 201, JSON.stringify(rc.body));
    assert.equal(rc.body.status, "RECEIVED");
    assert.deepEqual(rc.body.items.map((i: any) => i.status).sort(), ["MISSING", "RECEIVED"]);
    assert.equal((await call(t, "GET", `/specimens/${a.id}/custody`, { token: T().TECHNOLOGIST })).body.at(-1).type, "RECEIVED");
    // send-out
    const c = await mk(3);
    const so = await call(t, "POST", "/manifests", { token: T().TECHNOLOGIST, body: { kind: "SEND_OUT", destinationName: "Al-Borg Reference Lab", specimenIds: [c.id], courierName: "Walk-in courier" } });
    assert.equal(so.status, 201);
    assert.equal((await call(t, "POST", `/manifests/${so.body.id}/cancel`, { token: T().TECHNOLOGIST })).body.status, "CANCELLED");
    assert.equal((await call(t, "GET", "/manifests?kind=SEND_OUT", { token: T().RECEPTION })).body.length, 1);
    assert.equal((await call(t, "POST", `/manifests/${m.body.id}/cancel`, { token: T().TECHNOLOGIST })).status, 409);
  });
});
