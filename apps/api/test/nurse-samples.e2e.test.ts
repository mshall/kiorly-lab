import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateEnvelope, validateEvent } from "@kiorex/contracts";
import type { LabOrderPlacedData } from "@kiorex/contracts";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, qcPass } from "./helpers/app";
import { type Client, post } from "./helpers/hmac";
import { labOrderPlacedToInbound, NurseHandoffError } from "../src/integration/nurse-handoff";

/**
 * KNLAB01 / KLORD05 end to end: Kiorly Nurse visit -> LabOrderPlaced (kiorex-contracts 1.5.0) -> Kiorex relay -> Kiorly Lab inbound order
 * (existing integration endpoints) -> chain of custody from the nurse's collection time -> receipt by scan -> results -> release on the
 * Kiorly Nurse import channel (KLCRIT02) -> nurse fetches the report. Also KLORD02 (source) and KLCRIT02 (channel) additions.
 */
describe("KNLAB01 nurse-collected samples (KLORD05, KLORD02, KLCRIT02)", () => {
  let t: TestApp;
  let lab: Lab;
  let nurse: Client;
  let kx: Client;
  let seq = 0;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
    nurse = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIORLY_NURSE" } })).body;
    kx = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
  });
  after(async () => t.close());

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

  /** The LabOrderPlaced a Kiorly Nurse tenant would emit (validated against the published contract), mapped by the relay. */
  function handoff(over: { items?: LabOrderPlacedData["items"]; samples?: { label: string; specimenType: string; container?: string }[]; collectedAt?: string; handedOverAt?: string | null; consentToken?: string; identifiers?: string[]; ref?: string } = {}) {
    const n = ++seq;
    const orderId = over.ref ?? `nurse_ord_${Date.now().toString(36)}_${n}`;
    const data: LabOrderPlacedData = {
      orderId, encounterId: `enc_${n}`, clinicId: "nurse_tenant_1", patientRef: `pat_${n}`, orderingClinicianId: "dr_ref_1", consentToken: over.consentToken ?? "consent-token-abcdef123456",
      orderedAt: minutesAgo(180), items: over.items ?? [{ code: "CBC", nameEn: "Complete blood count" }, { code: "GLU", nameEn: "Fasting glucose" }], preferredLabId: lab.labId,
    };
    const envelope = { eventId: `evt_${orderId}`, type: "LabOrderPlaced", aggregateType: "LabOrder", aggregateId: orderId, target: "KIOREX", occurredAt: new Date().toISOString(), data };
    assert.equal(validateEvent("LabOrderPlaced", envelope).valid, true, "the source event is contract-valid");
    const body = labOrderPlacedToInbound(data, {
      patient: { fullName: "Mona Nurse Patient", dateOfBirth: "1985-02-02", sex: "F", phone: `+2010000${String(10000 + n)}`, preferredLocale: "ar" },
      identifiersChecked: over.identifiers ?? ["dateOfBirth", "phone"],
      collection: {
        visitRef: `visit_${n}`, collectorRef: "nurse_mona_1", collectorName: "Nurse Mona", collectedAt: over.collectedAt ?? minutesAgo(95), temperatureC: 23.5,
        ...(over.handedOverAt === null ? {} : { handedOverAt: over.handedOverAt ?? minutesAgo(60) }),
        samples: over.samples ?? [{ label: `NSV${n}A`, specimenType: "Whole blood", container: "EDTA (lavender)" }, { label: `NSV${n}B`, specimenType: "Serum", container: "Serum gel (yellow)" }],
      },
    });
    return { orderId, body };
  }

  it("the mapper refuses events that cannot be placed (no consent token, item without a catalogue code)", () => {
    const base = { orderId: "o", clinicId: "c", patientRef: "p", consentToken: "t", orderedAt: new Date().toISOString(), items: [{ nameEn: "X" }] } as LabOrderPlacedData;
    const ctx = { patient: { fullName: "A B" }, identifiersChecked: ["phone", "dateOfBirth"], collection: { visitRef: "v", collectorRef: "n", collectedAt: new Date().toISOString(), samples: [] } };
    assert.throws(() => labOrderPlacedToInbound(base, ctx), (e: unknown) => e instanceof NurseHandoffError && e.code === "ITEM_CODE_REQUIRED");
    assert.throws(() => labOrderPlacedToInbound({ ...base, consentToken: "" }, ctx), (e: unknown) => e instanceof NurseHandoffError && e.code === "CONSENT_TOKEN_REQUIRED");
  });

  it("accepts a nurse-collected order: source KIORLY_NURSE, specimens arrive collected/in transit, custody starts at the NURSE's collection time", async () => {
    const h = handoff();
    const a = await post(t, nurse, "/integration/v1/orders", h.body);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.created, true);
    assert.equal(a.body.status, "COLLECTED", "pre-collected: the order is already COLLECTED");
    const o = await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION });
    assert.equal(o.body.source, "KIORLY_NURSE");
    assert.equal(o.body.collectionType, "NURSE_VISIT");
    assert.equal(o.body.identityVerified, true);
    assert.ok(o.body.consentShareChannels.includes("KIORLY_NURSE_IMPORT"), "results go back to the nurse by default (consent token present)");
    assert.equal(o.body.homeCollection, null, "no home address ever reaches the lab for a nurse sample");
    assert.equal(o.body.nurseCollection.collectorRef, "nurse_mona_1");
    assert.equal(o.body.specimens.length, 2);
    for (const sp of o.body.specimens) assert.equal(sp.status, "IN_TRANSIT");
    assert.deepEqual(o.body.specimens.map((s: any) => s.barcode).sort(), h.body.nurseCollection.samples.map((s) => s.label).sort(), "the nurse's tube label is the barcode to scan");

    const chain = await call(t, "GET", `/specimens/${o.body.specimens[0].id}/custody`, { token: lab.tokens.TECHNOLOGIST });
    assert.deepEqual(chain.body.map((c: any) => c.type), ["COLLECTED", "TRANSPORT_STARTED"]);
    assert.equal(new Date(chain.body[0].occurredAt).toISOString(), h.body.nurseCollection.collectedAt, "custody starts at the nurse's collection time, not at ingest");
    assert.equal(new Date(chain.body[1].occurredAt).toISOString(), h.body.nurseCollection.handedOverAt);
    assert.ok(chain.body.every((c: any) => c.actorId === "nurse:nurse_mona_1"));
    assert.equal(Number(chain.body[0].temperatureC), 23.5);
    assert.ok(new Date(chain.body[0].occurredAt).getTime() < Date.now() - 60 * 60_000);
  });

  it("is idempotent on the nurse's order id; emits LabOrderCreated as KIORLY_CLINIC with originEdition NURSE (contract enum), no home data", async () => {
    const h = handoff();
    const a = await post(t, nurse, "/integration/v1/orders", h.body);
    const b = await post(t, nurse, "/integration/v1/orders", h.body);
    assert.equal(b.body.created, false);
    assert.equal(b.body.orderId, a.body.orderId);
    assert.equal(await t.prisma.specimen.count({ where: { orderId: a.body.orderId } }), 2, "replay creates no extra specimens");
    assert.equal(await t.prisma.custodyEvent.count({ where: { specimen: { orderId: a.body.orderId }, type: "COLLECTED" } }), 2);
    const ev = await t.prisma.outboxEvent.findMany({ where: { orgId: lab.orgId, type: "LabOrderCreated", aggregateId: a.body.orderId } });
    assert.equal(ev.length, 1);
    const data = (ev[0].payload as any).data;
    assert.equal(data.source, "KIORLY_CLINIC");
    assert.equal(data.originEdition, "NURSE");
    assert.equal(validateEvent("LabOrderCreated", ev[0].payload).valid, true);
    const st = await t.prisma.outboxEvent.findMany({ where: { orgId: lab.orgId, type: "LabOrderStatusChanged", aggregateId: a.body.orderId } });
    for (const e of st) assert.equal(validateEvent("LabOrderStatusChanged", e.payload).valid, true);
  });

  it("refuses what would break custody or consent: no consent token, <2 identifiers, future clock, hand-over before collection, sample/test mismatches", async () => {
    const before = await t.prisma.labOrder.count({ where: { orgId: lab.orgId, source: "KIORLY_NURSE" } });
    const noConsent = handoff();
    delete (noConsent.body.nurseCollection as any).consentToken;
    assert.equal((await post(t, nurse, "/integration/v1/orders", noConsent.body)).status, 400);
    const shortToken = handoff({ consentToken: "short" });
    assert.equal((await post(t, nurse, "/integration/v1/orders", shortToken.body)).status, 400);

    const oneId = await post(t, nurse, "/integration/v1/orders", handoff({ identifiers: ["phone"] }).body);
    assert.equal(oneId.status, 422);
    assert.equal(oneId.body.code, "TWO_IDENTIFIERS_REQUIRED");
    const noId = await post(t, nurse, "/integration/v1/orders", handoff({ identifiers: [] }).body);
    assert.equal(noId.status, 422);

    const future = await post(t, nurse, "/integration/v1/orders", handoff({ collectedAt: new Date(Date.now() + 3_600_000).toISOString(), handedOverAt: null }).body);
    assert.equal(future.status, 422);
    assert.equal(future.body.code, "COLLECTED_IN_FUTURE");
    const early = await post(t, nurse, "/integration/v1/orders", handoff({ collectedAt: minutesAgo(30), handedOverAt: minutesAgo(50) }).body);
    assert.equal(early.status, 422);
    assert.equal(early.body.code, "HANDOVER_TIME_INVALID");

    const n = seq + 1;
    const missing = await post(t, nurse, "/integration/v1/orders", handoff({ samples: [{ label: `NSV${n}A`, specimenType: "Whole blood", container: "EDTA (lavender)" }] }).body);
    assert.equal(missing.status, 422);
    assert.equal(missing.body.code, "SAMPLE_MISSING_FOR_TEST");
    assert.deepEqual(missing.body.testCodes, ["GLU"]);
    const extra = await post(t, nurse, "/integration/v1/orders", handoff({ items: [{ code: "CBC", nameEn: "CBC" }], samples: [{ label: "EXTRA-1", specimenType: "Whole blood", container: "EDTA (lavender)" }, { label: "EXTRA-2", specimenType: "Urine" }] }).body);
    assert.equal(extra.status, 422);
    assert.equal(extra.body.code, "SAMPLE_UNMATCHED");
    const dupGroup = await post(t, nurse, "/integration/v1/orders", handoff({ items: [{ code: "CBC", nameEn: "CBC" }], samples: [{ label: "DUP-1", specimenType: "Whole blood", container: "EDTA (lavender)" }, { label: "DUP-2", specimenType: "Whole blood", container: "EDTA (lavender)" }] }).body);
    assert.equal(dupGroup.status, 422);
    assert.equal(dupGroup.body.code, "SAMPLE_DUPLICATE_GROUP");
    const unknown = await post(t, nurse, "/integration/v1/orders", handoff({ items: [{ code: "NOPE", nameEn: "?" }], samples: [{ label: "UNK-1", specimenType: "Whole blood" }] }).body);
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.code, "UNKNOWN_TESTS");
    // nothing was persisted for any refused order
    assert.equal(await t.prisma.labOrder.count({ where: { orgId: lab.orgId, source: "KIORLY_NURSE" } }), before);
  });

  it("duplicate tube labels are rejected (the label is the barcode; accession uniqueness is a safety control)", async () => {
    const first = handoff({ items: [{ code: "CBC", nameEn: "CBC" }], samples: [{ label: "SHARED-LABEL-1", specimenType: "Whole blood", container: "EDTA (lavender)" }] });
    assert.equal((await post(t, nurse, "/integration/v1/orders", first.body)).status, 200);
    const second = handoff({ items: [{ code: "CBC", nameEn: "CBC" }], samples: [{ label: "SHARED-LABEL-1", specimenType: "Whole blood", container: "EDTA (lavender)" }] });
    const r = await post(t, nurse, "/integration/v1/orders", second.body);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "ACCESSION_DUPLICATE");
    assert.equal(await t.prisma.labOrder.count({ where: { orgId: lab.orgId, sourceRef: second.orderId } }), 0, "the failed ingest rolled back completely");
  });

  it("client/source binding: only a KIORLY_NURSE client submits nurseCollection, and it must", async () => {
    const h = handoff();
    const viaKiorex = await post(t, kx, "/integration/v1/orders", h.body);
    assert.equal(viaKiorex.status, 422);
    assert.equal(viaKiorex.body.code, "NURSE_COLLECTION_NOT_ALLOWED");
    const { nurseCollection: _n, ...plain } = handoff().body;
    void _n;
    const noBlock = await post(t, nurse, "/integration/v1/orders", plain);
    assert.equal(noBlock.status, 400);
    assert.equal(noBlock.body.code, "NURSE_COLLECTION_REQUIRED");
    const home = await post(t, nurse, "/integration/v1/orders", { ...handoff().body, collection: { type: "HOME", address: "somewhere 1", windowStart: minutesAgo(-60), windowEnd: minutesAgo(-120) } });
    assert.equal(home.status, 400);
    assert.equal(home.body.code, "NURSE_ORDER_CANNOT_BE_HOME_COLLECTION");
  });

  it("receipt at the lab: a wrong label is blocked and recorded, the right scan records RECEIVED with the transit time; then the order flows to a released report", async () => {
    const h = handoff();
    const a = await post(t, nurse, "/integration/v1/orders", h.body);
    const o = (await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION })).body;
    const [s1, s2] = o.specimens;
    const bad = await call(t, "POST", `/specimens/${s1.id}/receive`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: "NOT-THE-LABEL" } });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.code, "LABEL_MISMATCH");
    assert.equal(await t.prisma.custodyEvent.count({ where: { specimenId: s1.id, type: "LABEL_MISMATCH_BLOCKED" } }), 1);
    for (const s of [s1, s2]) {
      for (const action of ["receive", "process"] as const) {
        const r = await call(t, "POST", `/specimens/${s.id}/${action}`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: s.barcode } });
        assert.equal(r.status, 201, JSON.stringify(r.body));
      }
    }
    const chain = (await call(t, "GET", `/specimens/${s1.id}/custody`, { token: lab.tokens.TECHNOLOGIST })).body;
    assert.deepEqual(chain.map((c: any) => c.type), ["COLLECTED", "TRANSPORT_STARTED", "LABEL_MISMATCH_BLOCKED", "RECEIVED", "PROCESSING_STARTED"]);
    const rec = chain.find((c: any) => c.type === "RECEIVED");
    assert.match(rec.note, /received from nurse collection, \d+ min after collection/);
    assert.ok((await t.prisma.nurseCollection.findUniqueOrThrow({ where: { orderId: a.body.orderId } })).receivedAt);
    // the custody chain is append-only even for nurse samples
    await assert.rejects(t.prisma.custodyEvent.update({ where: { id: chain[0].id }, data: { note: "tamper" } }), /append-only/);

    // nurse can follow the chain (ids, times, temperature, NURSE|LAB only); a Kiorex client cannot
    const view = await post(t, nurse, `/integration/v1/orders/${h.orderId}/custody`, undefined, { method: "GET" });
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.specimens[0].custody[0].by, "NURSE");
    assert.ok(view.body.specimens[0].custody.some((c: any) => c.by === "LAB" && c.type === "RECEIVED"));
    assert.equal(JSON.stringify(view.body).includes("Mona Nurse Patient"), false, "no patient name in the custody view");
    assert.equal((await post(t, kx, `/integration/v1/orders/${h.orderId}/custody`, undefined, { method: "GET" })).status, 404);

    // analysis -> signed report -> release on the Kiorly Nurse import channel (KLCRIT02)
    await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT", "GLU"]);
    await enterAndTechValidate(t, lab, a.body.orderId, NORMAL);
    assert.ok((await call(t, "POST", `/orders/${a.body.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).body.every((r: any) => r.ok));
    const rep = await call(t, "POST", `/orders/${a.body.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(rep.status, 201, JSON.stringify(rep.body));
    // before release: neither the nurse nor Kiorex vault can fetch it
    assert.equal((await post(t, nurse, `/integration/v1/reports/${rep.body.id}/pdf`, undefined, { method: "GET" })).status, 403);
    const rel = await call(t, "POST", `/reports/${rep.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["KIORLY_NURSE_IMPORT"] } });
    assert.equal(rel.status, 201, JSON.stringify(rel.body));
    assert.deepEqual(rel.body.channels, ["KIORLY_CLINIC"], "contract channel for the Nurse edition is KIORLY_CLINIC (Nurse is an edition of Clinic)");
    const pdf = await post(t, nurse, `/integration/v1/reports/${rep.body.id}/pdf`, undefined, { method: "GET" });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.subarray(0, 4).toString(), "%PDF");
    assert.equal((await post(t, kx, `/integration/v1/reports/${rep.body.id}/pdf`, undefined, { method: "GET" })).status, 403, "Kiorex vault was not consented");
    const released = await t.prisma.outboxEvent.findFirstOrThrow({ where: { orgId: lab.orgId, type: "LabResultReleased", aggregateId: { contains: "" }, payload: { path: ["data", "orderId"], equals: a.body.orderId } } });
    assert.equal(validateEnvelope(released.payload).valid, true);
    assert.equal(validateEvent("LabResultReleased", released.payload).valid, true);
  });

  it("an order whose release consent is narrowed cannot be released to the nurse channel without consent (safety.lab.consent_enforcement)", async () => {
    const h = handoff({ items: [{ code: "GLU", nameEn: "Glucose" }], samples: [{ label: `NOCONS${seq}`, specimenType: "Serum", container: "Serum gel (yellow)" }] });
    const a = await post(t, nurse, "/integration/v1/orders", h.body);
    await call(t, "PUT", `/orders/${a.body.orderId}/consent`, { token: lab.tokens.RECEPTION, body: { channels: ["PRINTED"] } });
    const o = (await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION })).body;
    const s = o.specimens[0];
    for (const action of ["receive", "process"] as const) await call(t, "POST", `/specimens/${s.id}/${action}`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: s.barcode } });
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    await enterAndTechValidate(t, lab, a.body.orderId, NORMAL);
    await call(t, "POST", `/orders/${a.body.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const rep = await call(t, "POST", `/orders/${a.body.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const rel = await call(t, "POST", `/reports/${rep.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["KIORLY_NURSE_IMPORT"] } });
    assert.equal(rel.status, 409);
    assert.equal(rel.body.code, "CONSENT_REQUIRED");
  });

  it("the consent token is never stored in clear (hash only) and no PHI lands in the audit log", async () => {
    const h = handoff();
    const a = await post(t, nurse, "/integration/v1/orders", h.body);
    const nc = await t.prisma.nurseCollection.findUniqueOrThrow({ where: { orderId: a.body.orderId } });
    assert.match(nc.consentTokenHash, /^[0-9a-f]{64}$/);
    assert.notEqual(nc.consentTokenHash, h.body.nurseCollection.consentToken);
    const logs = JSON.stringify(await t.prisma.auditLog.findMany({ where: { orgId: lab.orgId, entityId: a.body.orderId } }));
    assert.equal(logs.includes(h.body.nurseCollection.consentToken), false);
    assert.equal(logs.includes("Mona Nurse Patient"), false);
  });

  it("a rejected nurse sample (e.g. haemolysed) creates a re-collection specimen and never loses the order", async () => {
    const h = handoff({ items: [{ code: "GLU", nameEn: "Glucose" }], samples: [{ label: `REJ${seq}`, specimenType: "Serum", container: "Serum gel (yellow)" }] });
    const a = await post(t, nurse, "/integration/v1/orders", h.body);
    const sp = (await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION })).body.specimens[0];
    await call(t, "POST", `/specimens/${sp.id}/receive`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: sp.barcode } });
    const rej = await call(t, "POST", `/specimens/${sp.id}/reject`, { token: lab.tokens.TECHNOLOGIST, body: { reason: "HAEMOLYSED", note: "visibly haemolysed on receipt" } });
    assert.equal(rej.status, 201, JSON.stringify(rej.body));
    const after = (await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION })).body;
    assert.ok(after.specimens.some((s: any) => s.status === "PENDING_COLLECTION"), "a re-collection specimen exists");
    assert.notEqual(after.status, "CANCELLED");
  });
});
