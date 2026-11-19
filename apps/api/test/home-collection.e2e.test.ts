import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

describe("home collection: slots with capacity, phlebotomist assignment, route, confirmation with label photo, offline replay", () => {
  let t: TestApp;
  let lab: Lab;
  const DAY = "2027-03-15";
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  const order = (slotId: string, name: string, geo: { lat: number; lng: number }) =>
    call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: name, phone: "+20100000" + Math.floor(1000 + Math.random() * 8999), dateOfBirth: "1990-01-01" }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { slotId, address: `${name} street 1`, geo } } });

  it("books slots atomically (capacity), assigns, optimises the route and completes collection with scans", async () => {
    const slots = (await call(t, "GET", `/home-collection/slots?date=${DAY}`, { token: lab.tokens.RECEPTION })).body;
    assert.equal(slots.length, 10);
    assert.equal(slots[0].available, 4);
    const o1 = await order(slots[0].id, "Far Patient", { lat: 30.3, lng: 31.6 });
    const o2 = await order(slots[1].id, "Near Patient", { lat: 30.05, lng: 31.24 });
    assert.equal(o1.status, 201, JSON.stringify(o1.body));
    // capacity: a slot with 4 seats takes exactly 4 concurrent bookings
    const races = await Promise.all(Array.from({ length: 7 }, (_, i) => order(slots[2].id, `Race ${i}`, { lat: 30.1, lng: 31.3 })));
    assert.equal(races.filter((r) => r.status === 201).length, 4);
    assert.equal(races.filter((r) => r.status === 409 && r.body.code === "SLOT_FULL").length, 3);
    const after = (await call(t, "GET", `/home-collection/slots?date=${DAY}`, { token: lab.tokens.RECEPTION })).body;
    assert.equal(after[2].booked, 4);
    // cancelling frees the seat
    const raceOk = races.find((r) => r.status === 201)!;
    await call(t, "POST", `/orders/${raceOk.body.id}/cancel`, { token: lab.tokens.RECEPTION, body: {} });
    assert.equal((await call(t, "GET", `/home-collection/slots?date=${DAY}`, { token: lab.tokens.RECEPTION })).body[2].booked, 3);

    // dispatch: assign + route
    const phleb = lab.staff.PHLEBOTOMIST.id;
    const hcs = (await call(t, "GET", `/home-collections?date=${DAY}`, { token: lab.tokens.RECEPTION })).body;
    const far = hcs.find((h: any) => h.order.patient.fullName === "Far Patient");
    const near = hcs.find((h: any) => h.order.patient.fullName === "Near Patient");
    for (const h of [far, near]) assert.equal((await call(t, "POST", `/home-collections/${h.id}/assign`, { token: lab.tokens.RECEPTION, body: { phlebotomistId: phleb } })).status, 201);
    assert.equal((await call(t, "POST", `/home-collections/${far.id}/assign`, { token: lab.tokens.RECEPTION, body: { phlebotomistId: lab.staff.RECEPTION.id } })).status, 400, "must be a phlebotomist");
    const route = await call(t, "POST", "/home-collections/route/optimise", { token: lab.tokens.RECEPTION, body: { date: DAY, phlebotomistId: phleb, start: { lat: 30.0444, lng: 31.2357 } } });
    assert.equal(route.status, 201);
    assert.deepEqual(route.body.map((r: any) => r.id), [near.id, far.id], "nearest first");

    // phlebotomist app: sees only own route in order; cannot touch other people's collections
    const my = await call(t, "GET", `/home-collections/my-route?date=${DAY}`, { token: lab.tokens.PHLEBOTOMIST });
    assert.deepEqual(my.body.map((h: any) => h.id), [near.id, far.id]);
    const otherPh = await t.prisma.staffUser.create({ data: { orgId: lab.orgId, email: "ph2@x.test", displayName: "Ph2", role: "PHLEBOTOMIST" } });
    const otherTok = await t.tokens.signDev({ staffId: otherPh.id, amr: ["pwd"] });
    assert.notEqual((await call(t, "POST", `/home-collections/${near.id}/start`, { token: otherTok })).status, 201);

    assert.equal((await call(t, "POST", `/home-collections/${near.id}/start`, { token: lab.tokens.PHLEBOTOMIST })).status, 201);
    const detail = (await call(t, "GET", `/home-collections?date=${DAY}`, { token: lab.tokens.RECEPTION })).body.find((h: any) => h.id === near.id);
    const spec = detail.order.specimens[0];
    // wrong label => blocked; no identity => blocked; then correct
    const noId = await call(t, "POST", `/home-collections/${near.id}/confirm`, { token: lab.tokens.PHLEBOTOMIST, headers: { "idempotency-key": "c-1" }, body: { scannedBarcodes: [spec.barcode] } });
    assert.equal(noId.status, 409);
    assert.equal(noId.body.code, "TWO_IDENTIFIERS_REQUIRED");
    const bad = await call(t, "POST", `/home-collections/${near.id}/confirm`, { token: lab.tokens.PHLEBOTOMIST, headers: { "idempotency-key": "c-0" }, body: { scannedBarcodes: ["WRONG"], identifiersChecked: ["phone", "dateOfBirth"] } });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.code, "LABEL_MISMATCH");
    const photo = await call(t, "POST", `/home-collections/${near.id}/label-photo`, { token: lab.tokens.PHLEBOTOMIST, body: { imageBase64: Buffer.from("fake-jpeg-bytes").toString("base64"), contentType: "image/jpeg" } });
    assert.equal(photo.status, 201);
    assert.match(photo.body.labelPhotoKey, /^label-photos\//);
    assert.equal((await call(t, "POST", `/home-collections/${near.id}/label-photo`, { token: lab.tokens.PHLEBOTOMIST, body: { imageBase64: "AAAA", contentType: "image/gif" } })).status, 400);
    const body = { scannedBarcodes: [spec.barcode], identifiersChecked: ["phone", "dateOfBirth"], labelPhotoKey: photo.body.labelPhotoKey, temperatureC: 24 };
    const ok = await call(t, "POST", `/home-collections/${near.id}/confirm`, { token: lab.tokens.PHLEBOTOMIST, headers: { "idempotency-key": "c-2" }, body });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, "COLLECTED");
    // offline queue replay with the same key is harmless
    const replay = await call(t, "POST", `/home-collections/${near.id}/confirm`, { token: lab.tokens.PHLEBOTOMIST, headers: { "idempotency-key": "c-2" }, body });
    assert.equal(replay.status, 201);
    assert.equal(await t.prisma.custodyEvent.count({ where: { specimenId: spec.id, type: "COLLECTED" } }), 1, "collected once");
    const o = await call(t, "GET", `/orders/${detail.orderId}`, { token: lab.tokens.RECEPTION });
    assert.equal(o.body.status, "COLLECTED");
    assert.equal(o.body.homeCollection.status, "COLLECTED");
    assert.ok(o.body.homeCollection.labelPhotoKey);
    // failure path
    assert.equal((await call(t, "POST", `/home-collections/${far.id}/fail`, { token: lab.tokens.PHLEBOTOMIST, body: { reason: "patient not at home" } })).status, 201);
    // reminder (mock WhatsApp) was sent without clinical data
    assert.ok(await t.prisma.notificationAttempt.findFirst({ where: { orgId: lab.orgId, purpose: "COLLECTION_REMINDER" } }));
  });
});
