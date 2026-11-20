import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { FieldSafetyService } from "../src/modules/field-safety/field-safety.service";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

const MIN = 60_000;
const snapshot = (flags: object[]) => ({ product: "kiorly-lab", version: 1, generatedAt: new Date().toISOString(), flags: flags as never });

interface Ctx { t: TestApp; lab: Lab; day: string }

/** A home order on slot `i` of the day; returns the HomeCollection row id. */
async function homeOrder({ t, lab, day }: Ctx, i: number, name: string, extra: { districtId?: string } = {}) {
  const slots = (await call(t, "GET", `/home-collection/slots?date=${day}`, { token: lab.tokens.RECEPTION })).body;
  const r = await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: name, phone: "+20100" + Math.floor(100000 + Math.random() * 899999), dateOfBirth: "1991-01-01" }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { slotId: slots[i].id, address: `${name} street 12, building 3`, geo: { lat: 30.0612345, lng: 31.2234567 }, ...extra } } });
  return { r, slot: slots[i] };
}
async function homeId(c: Ctx, orderId: string) {
  return (await c.t.prisma.homeCollection.findUniqueOrThrow({ where: { orderId } })).id;
}
/** order -> assign to the lab's phlebotomist -> on my way -> arrived. */
async function inField(c: Ctx, i: number, name: string, until: "assigned" | "en_route" | "arrived" = "arrived") {
  const { r, slot } = await homeOrder(c, i, name, { districtId: "nasr-city" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = await homeId(c, r.body.id);
  assert.equal((await call(c.t, "POST", `/home-collections/${id}/assign`, { token: c.lab.tokens.RECEPTION, body: { phlebotomistId: c.lab.staff.PHLEBOTOMIST.id } })).status, 201);
  if (until !== "assigned") assert.equal((await call(c.t, "POST", `/home-collections/${id}/start`, { token: c.lab.tokens.PHLEBOTOMIST, body: { geostamp: { lat: 30.04, lng: 31.23 } } })).status, 201);
  if (until === "arrived") assert.equal((await call(c.t, "POST", `/home-collections/${id}/arrive`, { token: c.lab.tokens.PHLEBOTOMIST, body: { geostamp: { lat: 30.0612345, lng: 31.2234567 } } })).status, 201);
  return { id, orderId: r.body.id as string, slot, plannedEnd: new Date(slot.endsAt).getTime() };
}
const dayN = (c: Ctx, n: number): Ctx => ({ ...c, day: `2027-09-${String(n).padStart(2, "0")}` });
const hcRow = (t: TestApp, id: string) => t.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
const alertsOf = (t: TestApp, id: string) => t.prisma.safetyAlert.findMany({ where: { homeCollectionId: id }, orderBy: { raisedAt: "asc" } });
const inbox = (t: TestApp, lab: Lab, relatedId: string) => t.prisma.notificationAttempt.findMany({ where: { orgId: lab.orgId, purpose: "SAFETY_ALERT", relatedId }, orderBy: { createdAt: "asc" } });

describe("KLORD04 on @kiorly/field-visit: coverage zones, travel buffers, lifecycle with geostamps, address privacy", () => {
  let c: Ctx;
  before(async () => {
    const t = await bootApp();
    c = { t, lab: await makeLab(t), day: "2027-06-14" };
  });
  after(async () => c.t.close());

  it("books a home collection only inside the lab's coverage zone (OUT_OF_COVERAGE with a reason); no zone configured = unrestricted", async () => {
    const open = await homeOrder(c, 0, "No Zone Yet");
    assert.equal(open.r.status, 201, "no zone configured: not restricted");
    assert.equal((await call(c.t, "PUT", `/labs/${c.lab.labId}/coverage`, { token: c.lab.tokens.OWNER, body: { districtIds: ["Nasr City", "Heliopolis"], maxTravelMinutes: 40, startDistrictId: "nasr-city", travelMatrix: { "nasr-city": { heliopolis: 20, maadi: 55 } } } })).status, 200);
    assert.equal((await call(c.t, "PUT", `/labs/${c.lab.labId}/coverage`, { token: c.lab.tokens.RECEPTION, body: { districtIds: ["x"] } })).status, 403);
    const noDistrict = await homeOrder(c, 1, "No District");
    assert.equal(noDistrict.r.status, 422);
    assert.deepEqual([noDistrict.r.body.code, noDistrict.r.body.reason], ["OUT_OF_COVERAGE", "NO_DISTRICT"]);
    const outside = await homeOrder(c, 1, "Far Away", { districtId: "6th-october" });
    assert.deepEqual([outside.r.status, outside.r.body.reason], [422, "DISTRICT_NOT_COVERED"]);
    const ok = await homeOrder(c, 1, "Inside", { districtId: "heliopolis" });
    assert.equal(ok.r.status, 201, JSON.stringify(ok.r.body));
    // covered district too far for the travel-time limit
    await call(c.t, "PUT", `/labs/${c.lab.labId}/coverage`, { token: c.lab.tokens.OWNER, body: { districtIds: ["nasr-city", "maadi"], maxTravelMinutes: 40, startDistrictId: "nasr-city", travelMatrix: { "nasr-city": { maadi: 55 } } } });
    const far = await homeOrder(c, 2, "Maadi", { districtId: "maadi" });
    assert.deepEqual([far.r.status, far.r.body.reason], [422, "TRAVEL_TOO_LONG"]);
    // a refused booking leaves no seat taken
    assert.equal((await call(c.t, "GET", `/home-collection/slots?date=${c.day}`, { token: c.lab.tokens.RECEPTION })).body[2].booked, 0);
    await call(c.t, "PUT", `/labs/${c.lab.labId}/coverage`, { token: c.lab.tokens.OWNER, body: { districtIds: ["nasr-city"] } });
  });

  it("assignment respects 30/30 travel buffers, the daily cap and the travel matrix (canBook)", async () => {
    const a = await homeOrder(c, 4, "Buffer A", { districtId: "nasr-city" });
    const adj = await homeOrder(c, 5, "Buffer Adjacent", { districtId: "nasr-city" });
    const gap = await homeOrder(c, 8, "Buffer Far Slot", { districtId: "nasr-city" });
    const ph = c.lab.staff.PHLEBOTOMIST.id;
    const assign = async (r: { body: { id: string } }) => call(c.t, "POST", `/home-collections/${await homeId(c, r.body.id)}/assign`, { token: c.lab.tokens.RECEPTION, body: { phlebotomistId: ph } });
    assert.equal((await assign(a.r)).status, 201);
    const clash = await assign(adj.r);
    assert.equal(clash.status, 409);
    assert.deepEqual([clash.body.code, clash.body.reason], ["PHLEBOTOMIST_UNAVAILABLE", "OVERLAP"], "an adjacent hourly slot leaves no room for the 30-minute travel buffers");
    assert.equal((await assign(gap.r)).status, 201, "slots with room for travel are fine");
    // daily cap (HVCFG03)
    await call(c.t, "PUT", "/settings", { token: c.lab.tokens.OWNER, body: { homeDailyCap: 2 } });
    const third = await homeOrder(c, 9, "Cap C", { districtId: "nasr-city" });
    const capped = await assign(third.r);
    assert.deepEqual([capped.status, capped.body.reason], [409, "DAILY_CAP"]);
    // a travel matrix makes unknown/long legs infeasible
    await call(c.t, "PUT", "/settings", { token: c.lab.tokens.OWNER, body: { homeDailyCap: null, homeBufferBeforeMin: 0, homeBufferAfterMin: 0 } });
    await call(c.t, "PUT", `/labs/${c.lab.labId}/coverage`, { token: c.lab.tokens.OWNER, body: { districtIds: ["nasr-city", "maadi"], travelMatrix: { "nasr-city": { maadi: 90 } } } });
    const m = await homeOrder(c, 6, "Matrix Maadi", { districtId: "maadi" }); // slot 6 starts right after slot 5 ... gap to slot 4 (nasr-city) is 120 min? slot 4 ends 13:00, slot 6 starts 14:00 -> 60 min < 90
    const feas = await assign(m.r);
    assert.deepEqual([feas.status, feas.body.reason], [409, "TRAVEL_INFEASIBLE"]);
    await call(c.t, "PUT", "/settings", { token: c.lab.tokens.OWNER, body: { homeBufferBeforeMin: 30, homeBufferAfterMin: 30 } });
    await call(c.t, "PUT", `/labs/${c.lab.labId}/coverage`, { token: c.lab.tokens.OWNER, body: { districtIds: ["nasr-city"] } });
  });

  it("lifecycle: only the assigned collector acts; departure needs the safety contact; arrival needs a geostamp (stored coarse); finish needs arrival", async () => {
    const { r } = await homeOrder(c, 6, "Lifecycle P", { districtId: "nasr-city" });
    const id = await homeId(c, r.body.id);
    const other = await c.t.prisma.staffUser.create({ data: { orgId: c.lab.orgId, email: "other@x.test", displayName: "Other", role: "PHLEBOTOMIST" } });
    const otherTok = await c.t.tokens.signDev({ staffId: other.id, amr: ["pwd"] });
    assert.equal((await call(c.t, "POST", `/home-collections/${id}/start`, { token: c.lab.tokens.PHLEBOTOMIST })).body.code, "NOT_ASSIGNED");
    await call(c.t, "POST", `/home-collections/${id}/assign`, { token: c.lab.tokens.RECEPTION, body: { phlebotomistId: c.lab.staff.PHLEBOTOMIST.id } });
    assert.equal((await call(c.t, "POST", `/home-collections/${id}/start`, { token: otherTok })).body.code, "NOT_YOUR_COLLECTION");
    // no safety contact => the collector cannot leave (fails closed)
    await c.t.prisma.tenant.update({ where: { id: c.lab.orgId }, data: { safetyContactPhone: null } });
    const noContact = await call(c.t, "POST", `/home-collections/${id}/start`, { token: c.lab.tokens.PHLEBOTOMIST });
    assert.deepEqual([noContact.status, noContact.body.code], [409, "SAFETY_CONTACT_REQUIRED"]);
    await call(c.t, "PUT", "/settings", { token: c.lab.tokens.OWNER, body: { safetyContactName: "Dispatch Lead", safetyContactPhone: "+201000000999" } });
    assert.equal((await call(c.t, "POST", `/home-collections/${id}/arrive`, { token: c.lab.tokens.PHLEBOTOMIST, body: { geostamp: { lat: 1, lng: 1 } } })).status, 409, "cannot arrive before leaving");
    assert.equal((await call(c.t, "POST", `/home-collections/${id}/start`, { token: c.lab.tokens.PHLEBOTOMIST, body: { geostamp: { lat: 30.04449, lng: 31.23571, districtId: "nasr-city" } } })).status, 201);
    assert.equal((await call(c.t, "POST", `/home-collections/${id}/arrive`, { token: c.lab.tokens.PHLEBOTOMIST, body: {} })).status, 400, "geostamp is required for the check-in");
    assert.equal((await call(c.t, "POST", `/home-collections/${id}/arrive`, { token: c.lab.tokens.PHLEBOTOMIST, body: { geostamp: { lat: 30.0612345, lng: 31.2234567 } } })).status, 201);
    const row = await hcRow(c.t, id);
    assert.equal(row.status, "ARRIVED");
    assert.ok(row.onMyWayAt && row.arrivedAt);
    const hist = row.history as any[];
    assert.deepEqual(hist.map((h) => h.state), ["REQUESTED", "CONFIRMED", "ON_MY_WAY", "ARRIVED"]);
    assert.deepEqual([hist[3].geostamp.lat, hist[3].geostamp.lng], [30.06, 31.22], "geostamps are coarsened to ~1 km (2 decimals)");
    assert.equal(JSON.stringify(hist).includes("30.0612345"), false, "precise coordinates never enter the lifecycle");
    // the collector in the field cannot have the order cancelled under them
    const cancel = await call(c.t, "POST", `/orders/${r.body.id}/cancel`, { token: c.lab.tokens.RECEPTION, body: {} });
    assert.deepEqual([cancel.status, cancel.body.code], [409, "ORDER_NOT_CANCELLABLE"]);
  });

  it("HVPRV01/BR52: address, phone and coordinates only for the assigned phlebotomist and admins, only once confirmed, never 24 h after the visit", async () => {
    const f = await inField(c, 2, "Privacy Patient", "assigned");
    const view = async (token: string) => (await call(c.t, "GET", `/home-collections?date=${c.day}`, { token })).body.find((h: any) => h.id === f.id);
    const asReception = await view(c.lab.tokens.RECEPTION);
    assert.equal(asReception.addressMasked, true);
    assert.equal(asReception.contactPhone, null);
    assert.equal(asReception.geo, null);
    assert.equal(String(asReception.address).includes("Privacy Patient"), false);
    const asOwner = await view(c.lab.tokens.OWNER);
    assert.equal(asOwner.addressMasked, false);
    assert.match(asOwner.address, /Privacy Patient street/);
    const mine = (await call(c.t, "GET", `/home-collections/my-route?date=${c.day}`, { token: c.lab.tokens.PHLEBOTOMIST })).body.find((h: any) => h.id === f.id);
    assert.equal(mine.addressMasked, false);
    // the order view masks it for dispatch staff too, and the unassigned phlebotomist never sees it
    assert.equal((await call(c.t, "GET", `/orders/${f.orderId}`, { token: c.lab.tokens.RECEPTION })).body.homeCollection.addressMasked, true);
    assert.equal((await call(c.t, "GET", `/orders/${f.orderId}`, { token: c.lab.tokens.PHLEBOTOMIST })).body.homeCollection.addressMasked, false, "assigned phlebotomist");
    // 24 h after the visit ended: masked for everyone, admins included
    await c.t.prisma.homeCollection.update({ where: { id: f.id }, data: { status: "FAILED", failureReason: "patient not at home", endedAt: new Date(Date.now() - 25 * 3_600_000) } });
    const later = await view(c.lab.tokens.OWNER);
    assert.equal(later.addressMasked, true);
    assert.equal(String(later.address).includes("Privacy Patient"), false);
  });
});

describe("stop-ship: phlebotomist safety (HVSAF01/02, BR61) - timer, SOS, unsafe-abort, never switchable", () => {
  let c: Ctx;
  let safety: FieldSafetyService;
  before(async () => {
    const t = await bootApp();
    c = { t, lab: await makeLab(t), day: "2027-07-20" };
    safety = t.app.get(FieldSafetyService);
  });
  after(async () => c.t.close());

  it("no 'Finished' 30 min after the planned end -> the phlebotomist is prompted; 10 min without an answer -> the safety contact is alerted within 60 s; each fires once", async () => {
    const d = dayN(c, 1);
    const f = await inField(d, 0, "Timer One");
    await safety.tick(f.plannedEnd + 29 * MIN);
    assert.equal((await inbox(c.t, c.lab, f.id)).length, 0, "nothing before planned end + 30 min");
    await safety.tick(f.plannedEnd + 30 * MIN + 1000);
    const prompt = await inbox(c.t, c.lab, f.id);
    assert.deepEqual(prompt.map((n) => [n.channel, n.recipientRef, (n.params as any).kind]), [["PUSH", c.lab.staff.PHLEBOTOMIST.id, "PROMPT"]]);
    assert.equal((await alertsOf(c.t, f.id)).length, 0, "no alert yet: the collector has 10 minutes to answer");
    await safety.tick(f.plannedEnd + 39 * MIN);
    assert.equal((await alertsOf(c.t, f.id)).length, 0);
    await safety.tick(f.plannedEnd + 40 * MIN + 5_000);
    const [alert] = await alertsOf(c.t, f.id);
    assert.equal(alert.kind, "NO_ANSWER");
    assert.equal(alert.delivered, true);
    assert.equal(alert.withinSla, true);
    assert.ok(alert.latencyMs! <= 60_000, `delivered ${alert.latencyMs} ms after it became due`);
    const sms = (await inbox(c.t, c.lab, f.id)).filter((n) => n.channel === "SMS");
    assert.equal(sms.length, 1);
    assert.equal(sms[0].recipientRef, "+201000000999");
    // PHI minimisation: ids + emergency numbers + coarse position only
    const p = sms[0].params as Record<string, string>;
    assert.deepEqual(Object.keys(p).sort(), ["ambulance", "collection", "kind", "lastKnown", "police"]);
    assert.deepEqual([p.kind, p.collection, p.ambulance, p.police, p.lastKnown], ["NO_ANSWER", f.id, "123", "122", "30.06,31.22"]);
    assert.equal(JSON.stringify(sms[0]).includes("Timer One"), false);
    // idempotent: later ticks never duplicate the prompt or the alert
    await safety.tick(f.plannedEnd + 90 * MIN);
    await safety.tick(f.plannedEnd + 120 * MIN);
    assert.equal((await alertsOf(c.t, f.id)).length, 1);
    assert.equal((await inbox(c.t, c.lab, f.id)).filter((n) => n.channel === "PUSH").length, 1);
    assert.ok((await c.t.prisma.auditLog.findFirst({ where: { orgId: c.lab.orgId, action: "safety.alert", entityId: alert.id } })));
  });

  it("a late sweep is reported honestly: an alert delivered more than 60 s after it was due is flagged outside the SLA", async () => {
    const d = dayN(c, 2);
    const f = await inField(d, 0, "Timer Late");
    await safety.tick(f.plannedEnd + 30 * MIN + 1000);
    await safety.tick(f.plannedEnd + 40 * MIN + 5 * MIN);
    const [alert] = await alertsOf(c.t, f.id);
    assert.equal(alert.delivered, true);
    assert.equal(alert.withinSla, false);
    assert.ok(alert.latencyMs! > 60_000);
  });

  it("\"I'm OK\" answers the prompt and re-arms the timer for another period (the collector is still on site)", async () => {
    const d = dayN(c, 3);
    const f = await inField(d, 0, "Timer Answer");
    await safety.tick(f.plannedEnd + 30 * MIN + 1000);
    const answeredAt = f.plannedEnd + 31 * MIN;
    assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/safety/answer`, { token: c.lab.tokens.OWNER })).body.code, "NOT_YOUR_COLLECTION", "nobody answers for the collector");
    await safety.answer({ staffId: c.lab.staff.PHLEBOTOMIST.id, orgId: c.lab.orgId } as never, f.id, answeredAt);
    await safety.tick(f.plannedEnd + 45 * MIN);
    assert.equal((await alertsOf(c.t, f.id)).length, 0, "answered: no alert");
    await safety.tick(answeredAt + 30 * MIN + 1000);
    assert.equal((await alertsOf(c.t, f.id)).length, 0, "re-armed: a new prompt, still no alert");
    await safety.tick(answeredAt + 40 * MIN + 1000);
    assert.equal((await alertsOf(c.t, f.id)).length, 1, "silent again: alert");
    const ok = await call(c.t, "POST", `/home-collections/${f.id}/safety/answer`, { token: c.lab.tokens.PHLEBOTOMIST });
    assert.equal(ok.status, 201);
  });

  it("finishing the visit stops the timer; a collector who never left (or already finished) is never alerted", async () => {
    const d = dayN(c, 4);
    const done = await inField(d, 0, "Finished Fine");
    const spec = (await call(c.t, "GET", `/orders/${done.orderId}`, { token: c.lab.tokens.RECEPTION })).body.specimens[0];
    const fin = await call(c.t, "POST", `/home-collections/${done.id}/confirm`, { token: c.lab.tokens.PHLEBOTOMIST, headers: { "idempotency-key": `fin-${done.id}` }, body: { scannedBarcodes: [spec.barcode], identifiersChecked: ["phone", "dateOfBirth"] } });
    assert.equal(fin.status, 201, JSON.stringify(fin.body));
    const assignedOnly = await inField(d, 3, "Never Left", "assigned");
    await safety.tick(done.plannedEnd + 120 * MIN);
    assert.equal((await alertsOf(c.t, done.id)).length, 0);
    assert.equal((await alertsOf(c.t, assignedOnly.id)).length, 0);
    assert.equal((await inbox(c.t, c.lab, done.id)).length, 0);
    const row = await hcRow(c.t, done.id);
    assert.ok(row.endedAt, "terminal state records the end (starts the 24 h address mask)");
  });

  it("HVSAF02 SOS: one tap alerts the safety contact with the live location and returns 123 / 122; the precise location is delivered, never stored", async () => {
    const d = dayN(c, 5);
    const f = await inField(d, 0, "Sos Patient");
    assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/sos`, { token: c.lab.tokens.PHLEBOTOMIST, body: { lat: 200, lng: 5 } })).status, 400);
    const s = await call(c.t, "POST", `/home-collections/${f.id}/sos`, { token: c.lab.tokens.PHLEBOTOMIST, body: { lat: 30.123456, lng: 31.654321 } });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    assert.equal(s.body.delivered, true);
    assert.deepEqual(s.body.show, { ambulance: "123", police: "122" });
    const sms = (await inbox(c.t, c.lab, f.id)).filter((n) => n.channel === "SMS");
    assert.equal(sms.length, 1);
    assert.equal((sms[0].params as any).kind, "SOS");
    assert.equal((sms[0].params as any).live, "30.123456,31.654321");
    const [alert] = await alertsOf(c.t, f.id);
    assert.equal(alert.kind, "SOS");
    assert.equal(JSON.stringify(alert).includes("30.123456"), false, "live location is not persisted on the alert");
    // not callable by anyone else, nor when not in the field
    assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/sos`, { token: c.lab.tokens.OWNER, body: { lat: 30, lng: 31 } })).body.code, "NOT_YOUR_COLLECTION");
    const idle = await inField(d, 3, "Sos Idle", "assigned");
    assert.equal((await call(c.t, "POST", `/home-collections/${idle.id}/sos`, { token: c.lab.tokens.PHLEBOTOMIST, body: { lat: 30, lng: 31 } })).body.code, "NOT_IN_FIELD");
  });

  it("BR61 'Leave visit - unsafe': ends the visit, alerts the safety contact, is NEVER a no-show, reason is a category (no free text), nothing is held against anyone", async () => {
    const d = dayN(c, 6);
    const f = await inField(d, 0, "Unsafe Patient");
    assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/leave-unsafe`, { token: c.lab.tokens.PHLEBOTOMIST, body: { reason: "he threatened me at the door" } })).status, 400, "free text is refused");
    assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/leave-unsafe`, { token: c.lab.tokens.OWNER, body: { reason: "OTHER" } })).body.code, "NOT_YOUR_COLLECTION");
    const r = await call(c.t, "POST", `/home-collections/${f.id}/leave-unsafe`, { token: c.lab.tokens.PHLEBOTOMIST, body: { reason: "THREAT_OR_AGGRESSION", geostamp: { lat: 30.0612345, lng: 31.2234567 } } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.deepEqual([r.body.status, r.body.noShow, r.body.delivered], ["ABORTED_UNSAFE", false, true]);
    const row = await hcRow(c.t, f.id);
    assert.equal(row.status, "ABORTED_UNSAFE");
    assert.equal(row.abortReason, "THREAT_OR_AGGRESSION");
    assert.equal(row.failureReason, null, "not recorded as a failed/no-show visit");
    assert.ok(row.endedAt);
    // never converted to a no-show or failure afterwards
    const noShow = await call(c.t, "POST", `/home-collections/${f.id}/fail`, { token: c.lab.tokens.PHLEBOTOMIST, body: { reason: "patient not at home" } });
    assert.equal(noShow.status, 409);
    assert.equal(noShow.body.code, "NO_SHOW_NOT_ALLOWED");
    assert.equal((await hcRow(c.t, f.id)).status, "ABORTED_UNSAFE");
    const [alert] = await alertsOf(c.t, f.id);
    assert.deepEqual([alert.kind, alert.delivered], ["UNSAFE_ABORT", true]);
    // the order is not penalised or cancelled: it can still be collected another way
    const o = await call(c.t, "GET", `/orders/${f.orderId}`, { token: c.lab.tokens.RECEPTION });
    assert.equal(o.body.status, "AWAITING_COLLECTION");
    // the timer stops once the visit is over
    await safety.tick(f.plannedEnd + 120 * MIN);
    assert.equal((await alertsOf(c.t, f.id)).filter((a) => a.kind === "NO_ANSWER").length, 0);
    // a re-assignment of the closed collection is refused
    assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/assign`, { token: c.lab.tokens.RECEPTION, body: { phlebotomistId: c.lab.staff.PHLEBOTOMIST.id } })).body.code, "HOME_COLLECTION_CLOSED");
  });

  it("an on-site collector who cannot collect ends the visit as FAILED (not unsafe), which also stops the timer", async () => {
    const d = dayN(c, 7);
    const f = await inField(d, 0, "Refused Patient");
    const r = await call(c.t, "POST", `/home-collections/${f.id}/fail`, { token: c.lab.tokens.PHLEBOTOMIST, body: { reason: "patient refused" } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await hcRow(c.t, f.id)).status, "FAILED");
    await safety.tick(f.plannedEnd + 120 * MIN);
    assert.equal((await alertsOf(c.t, f.id)).length, 0);
  });

  it("an undeliverable alert is an incident that is kept and retried every tick until it reaches the contact", async () => {
    const d = dayN(c, 8);
    const f = await inField(d, 0, "Undeliverable");
    await call(c.t, "PUT", "/settings", { token: c.lab.tokens.OWNER, body: { safetyContactPhone: "+201000000998-fail" } }); // mock provider rejects this recipient on every channel
    await safety.tick(f.plannedEnd + 30 * MIN + 1000);
    await safety.tick(f.plannedEnd + 40 * MIN + 1000);
    let [alert] = await alertsOf(c.t, f.id);
    assert.equal(alert.delivered, false);
    assert.deepEqual((alert.attempts as any[]).map((a) => [a.channel, a.ok]), [["SMS", false], ["WHATSAPP", false]], "SMS then WhatsApp fallback were both tried");
    await call(c.t, "PUT", "/settings", { token: c.lab.tokens.OWNER, body: { safetyContactPhone: "+201000000999" } });
    const swept = await safety.tick(f.plannedEnd + 41 * MIN);
    assert.ok(swept.retried >= 1);
    [alert] = await alertsOf(c.t, f.id);
    assert.equal(alert.delivered, true);
    assert.equal(alert.withinSla, false, "the retry is honest about being late");
    assert.equal((await alertsOf(c.t, f.id)).length, 1, "the same alert is retried, never duplicated");
  });

  it("SAFETY IS NEVER SWITCHABLE: with lab.home_collection OFF (and on a plan without the entitlement) SOS, 'I'm OK', unsafe-abort and the timer still work for a collector in the field", async () => {
    const d = dayN(c, 9);
    const f = await inField(d, 0, "Switch Off A");
    const g = await inField(d, 3, "Switch Off B");
    const h = await inField(d, 6, "Switch Off C");
    const n = await inField(d, 9, "Switch Off N", "assigned");
    c.t.flags.setSnapshot(snapshot([{ key: "lab.home_collection", values: { global: "OFF" } }, { key: "lab.module", values: { global: "OFF" } }]));
    try {
      // the home-collection feature endpoints are off ...
      assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/arrive`, { token: c.lab.tokens.PHLEBOTOMIST, body: { geostamp: { lat: 1, lng: 1 } } })).body.code, "FEATURE_DISABLED");
      // ... the safety controls are not
      assert.equal((await call(c.t, "POST", `/home-collections/${f.id}/sos`, { token: c.lab.tokens.PHLEBOTOMIST, body: { lat: 30.1, lng: 31.1 } })).status, 201);
      assert.equal((await call(c.t, "POST", `/home-collections/${g.id}/safety/answer`, { token: c.lab.tokens.PHLEBOTOMIST })).status, 201);
      assert.equal((await call(c.t, "POST", `/home-collections/${h.id}/leave-unsafe`, { token: c.lab.tokens.PHLEBOTOMIST, body: { reason: "UNSAFE_ENVIRONMENT" } })).status, 201);
      // starting a NEW visit is the feature itself, and is off ...
      assert.equal((await call(c.t, "POST", `/home-collections/${n.id}/start`, { token: c.lab.tokens.PHLEBOTOMIST })).body.code, "FEATURE_DISABLED");
      // ... but the safety timer keeps watching everyone already out
      await safety.tick(g.plannedEnd + 30 * MIN + 1000);
      await safety.tick(g.plannedEnd + 40 * MIN + 5000);
      const [ga] = (await alertsOf(c.t, g.id)).filter((a) => a.kind === "NO_ANSWER");
      assert.equal(ga?.delivered, true, "timer + delivery ran with the feature flag OFF");
    } finally {
      c.t.flags.setSnapshot(null);
    }
    // plan downgrade: Lite has no home_collection entitlement; an in-field collector keeps SOS
    const lite = await makeLab(c.t, { edition: "PRO" });
    await c.t.prisma.tenant.update({ where: { id: lite.orgId }, data: { edition: "PRO" } });
    const lc: Ctx = { t: c.t, lab: lite, day: "2027-08-02" };
    const lf = await inField(lc, 0, "Plan Down");
    await c.t.prisma.tenant.update({ where: { id: lite.orgId }, data: { edition: "LITE" } });
    const ltoken = await c.t.tokens.signDev({ staffId: lite.staff.PHLEBOTOMIST.id, amr: ["pwd"] });
    assert.equal((await call(c.t, "POST", `/home-collections/${lf.id}/sos`, { token: ltoken, body: { lat: 30.1, lng: 31.1 } })).status, 201);
  });

  it("the safety path has no flag, entitlement or environment switch in code (static guard for field-safety/)", () => {
    const d = dayN(c, 10);
    const dir = resolve(__dirname, "../src/modules/field-safety");
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts"))) {
      const src = strip(readFileSync(join(dir, f), "utf8"));
      assert.doesNotMatch(src, /FeatureFlagsService|RequiresFlag|RequiresEntitlement|EntitlementsPort|isEnabled\(|assertFlagOn/, `${f} must not gate safety on a flag or plan`);
      assert.doesNotMatch(src, /process\.env\.(TIMERS_ENABLED|SAFETY|FIELD)/, `${f} must not read a switch from the environment`);
      assert.doesNotMatch(src, /timersEnabled/, `${f} must not honour TIMERS_ENABLED`);
    }
    const controller = readFileSync(join(dir, "field-safety.controller.ts"), "utf8");
    assert.doesNotMatch(strip(controller), /RequiresFlag|RequiresEntitlement/);
  });
});
