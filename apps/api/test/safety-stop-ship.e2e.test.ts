import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

/** KX-07 §05 stop-ship suite (LB-SS01..SS04). Every test here must stay green on the pilot build. */
describe("stop-ship: result released without QC pass or signature (QC violation injection)", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("a Westgard violation opens a block, revokes unreleased results, and makes signing/releasing impossible until a documented pass", async () => {
    const f = await makeOrder(t, lab, ["CBC"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT"]);
    await enterAndTechValidate(t, lab, f.orderId, NORMAL);
    const mv = await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.ok(mv.body.every((r: any) => r.ok));

    // inject a 1_3s violation on HB (z = +3.5)
    const hbL1 = await t.prisma.qcMaterialLevel.findUniqueOrThrow({ where: { id: lab.materials.HB.l1 } });
    const bad = await call(t, "POST", "/qc/runs", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: hbL1.id, value: Number(hbL1.targetMean) + 3.5 * Number(hbL1.targetSd) } });
    assert.equal(bad.status, 201);
    assert.equal(bad.body.run.status, "FAIL");
    assert.ok(bad.body.run.violatedRules.includes("1_3s"));
    assert.ok(bad.body.blockId, "a QC block was opened");
    assert.equal(bad.body.revokedResults, 1, "the HB result since the last passing run is sent back for re-run");

    // signing is refused
    const sign = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(sign.status, 409);
    assert.ok(["REPORT_NOT_READY", "QC_BLOCKED"].includes(sign.body.code), JSON.stringify(sign.body));

    // DB backstop: forcing a release on a result covered by the failed run is rejected by the trigger
    const sp = await t.prisma.specimen.findFirstOrThrow({ where: { orderId: f.orderId } });
    const item = await t.prisma.orderItem.findFirstOrThrow({ where: { orderId: f.orderId } });
    const decoy = await makeOrder(t, lab, ["GLU"]);
    const rep = await t.prisma.reportVersion.create({ data: { orgId: lab.orgId, orderId: decoy.orderId, version: 1, signedBy: "x", signedAt: new Date(), contentHash: "h", storageKey: "k" } });
    await assert.rejects(
      t.prisma.result.create({
        data: { orgId: lab.orgId, orderItemId: item.id, specimenId: sp.id, analyteId: lab.analytes.HB, instrumentId: lab.instruments.bench, qcRunId: bad.body.run.id, source: "MANUAL", enteredBy: "x", status: "RELEASED", valueNumeric: 13, techValidatedBy: "t", medicalValidatedBy: "m", medicalValidatedAt: new Date(), releasedAt: new Date(), releasedReportVersionId: rep.id },
      }),
      /QC run is missing or failed|open QC block/,
    );

    // technologists cannot clear blocks; a documented clear needs a NEWER passing run
    const block = bad.body.blockId as string;
    const hbRun = await call(t, "POST", "/qc/runs", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: hbL1.id, value: Number(hbL1.targetMean) } });
    assert.equal(hbRun.body.run.status, "PASS");
    assert.equal((await call(t, "POST", `/qc/blocks/${block}/clear`, { token: lab.tokens.TECHNOLOGIST, body: { clearedByRunId: hbRun.body.run.id, note: "recalibrated and re-ran control" } })).status, 403);
    assert.equal((await call(t, "POST", `/qc/blocks/${block}/clear`, { token: lab.tokens.AUTHORIZED_SIGNATORY, body: { clearedByRunId: bad.body.run.id, note: "using the failing run itself" } })).status, 409);
    assert.equal((await call(t, "POST", `/qc/blocks/${block}/clear`, { token: lab.tokens.AUTHORIZED_SIGNATORY, body: { clearedByRunId: hbRun.body.run.id, note: "short" } })).status, 400);
    const cleared = await call(t, "POST", `/qc/blocks/${block}/clear`, { token: lab.tokens.AUTHORIZED_SIGNATORY, body: { clearedByRunId: hbRun.body.run.id, note: "recalibrated and re-ran control" } });
    assert.equal(cleared.status, 201, JSON.stringify(cleared.body));

    // re-run the revoked result, validate again, now it can be signed and released
    const l2 = await t.prisma.qcMaterialLevel.findUniqueOrThrow({ where: { id: lab.materials.HB.l2 } });
    await call(t, "POST", "/qc/runs", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: l2.id, value: Number(l2.targetMean) } });
    const order = await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST });
    const cbc = order.body.items[0];
    const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: cbc.id, analyteId: lab.analytes.HB, instrumentId: lab.instruments.bench, value: 13.4 } });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value: 13.4 } });
    assert.equal((await call(t, "POST", `/results/${e.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: {} })).status, 201);
    await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const ok = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  it("an open block stops technical and medical validation too (not only release)", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.astm, ["GLU"]);
    const m = await t.prisma.qcMaterialLevel.findUniqueOrThrow({ where: { id: lab.materials.GLU.l1 } });
    const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.GLU, instrumentId: lab.instruments.astm, value: 90 } });
    await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value: 90 } });
    // fail QC BEFORE validation: result entered after the last pass is revoked at once
    const bad = await call(t, "POST", "/qc/runs", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, materialId: m.id, value: Number(m.targetMean) - 4 * Number(m.targetSd) } });
    assert.equal(bad.body.run.status, "FAIL");
    const v = await call(t, "POST", `/results/${e.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: {} });
    assert.equal(v.status, 409);
  });

  it("no release without validation: signing needs every result medically validated; versions are always signed and immutable", async () => {
    const f = await makeOrder(t, lab, ["TSH"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    const r = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(r.status, 409);
    for (const rv of await t.prisma.reportVersion.findMany({ where: { orgId: lab.orgId } })) {
      assert.ok(rv.signedBy.length > 0 || rv.signedBy === "x");
    }
    const any = await t.prisma.reportVersion.findFirst({ where: { orgId: lab.orgId } });
    if (any) await assert.rejects(t.prisma.reportVersion.update({ where: { id: any.id }, data: { contentHash: "tampered" } }), /append-only/);
  });
});

describe("stop-ship: critical value not acknowledged and not escalated (timer test)", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("raises an alert on a critical result, escalates after the configured window, and accepts late acknowledgement", async () => {
    const f = await makeOrder(t, lab, ["CBC"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT"]);
    const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.HB, instrumentId: lab.instruments.bench, value: 6 } });
    assert.equal(e.body.flag, "CRITICAL_LOW");
    const alerts = await t.prisma.criticalAlert.findMany({ where: { orgId: lab.orgId } });
    assert.equal(alerts.length, 1);
    const a = alerts[0];
    assert.equal(a.status, "OPEN");
    const minutes = Math.round((a.ackDeadlineAt.getTime() - a.notifiedAt.getTime()) / 60000);
    assert.equal(minutes, 30, "PRD example window");
    // ordering clinician and lab director were alerted, without values
    const msgs = await t.prisma.notificationAttempt.findMany({ where: { orgId: lab.orgId, purpose: "CRITICAL_ALERT" } });
    assert.ok(msgs.length >= 2);
    assert.ok(msgs.every((m) => !/6|value|mg|g\/dL/i.test(JSON.stringify(m.params).replace(/alertId":"[^"]+"/, "").replace(/orderNumber":"[^"]+"/, ""))));

    // timer: before the deadline nothing happens, after it the alert escalates once per window
    assert.equal((await t.critical.sweep(new Date(a.notifiedAt.getTime() + 29 * 60_000), { orgId: lab.orgId })).escalated, 0);
    assert.equal((await t.critical.sweep(new Date(a.notifiedAt.getTime() + 31 * 60_000), { orgId: lab.orgId })).escalated, 1);
    const esc = await t.prisma.criticalAlert.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(esc.status, "ESCALATED");
    assert.equal(esc.escalationLevel, 1);
    assert.ok(await t.prisma.notificationAttempt.findFirst({ where: { orgId: lab.orgId, purpose: "CRITICAL_ESCALATION" } }));
    assert.ok(await t.prisma.outboxEvent.findFirst({ where: { orgId: lab.orgId, type: "LabCriticalEscalated" } }));
    assert.equal((await t.critical.sweep(new Date(a.notifiedAt.getTime() + 32 * 60_000), { orgId: lab.orgId })).escalated, 0, "a fresh window starts at escalation");

    // acknowledgement closes the loop; a reception user cannot acknowledge
    assert.equal((await call(t, "POST", `/critical-alerts/${a.id}/ack`, { token: lab.tokens.RECEPTION, body: {} })).status, 403);
    const ack = await call(t, "POST", `/critical-alerts/${a.id}/ack`, { token: lab.tokens.LAB_DIRECTOR, body: { note: "clinician informed" } });
    assert.equal(ack.status, 201);
    assert.equal(ack.body.status, "ACKNOWLEDGED");
    assert.equal((await t.critical.sweep(new Date(a.notifiedAt.getTime() + 120 * 60_000), { orgId: lab.orgId })).escalated, 0);
  });

  it("critical rule window is bounded and cannot be disabled", async () => {
    const bad = await call(t, "PUT", `/analytes/${lab.analytes.K}/critical-rule`, { token: lab.tokens.LAB_DIRECTOR, body: { criticalHigh: 6.5, ackWithinMinutes: 0 } });
    assert.equal(bad.status, 400);
    const ok = await call(t, "PUT", `/analytes/${lab.analytes.K}/critical-rule`, { token: lab.tokens.LAB_DIRECTOR, body: { criticalHigh: 6.5, criticalLow: 2.5, ackWithinMinutes: 15 } });
    assert.equal(ok.status, 200);
    assert.equal((await call(t, "PUT", `/analytes/${lab.analytes.K}/critical-rule`, { token: lab.tokens.RECEPTION, body: { criticalHigh: 6.5, ackWithinMinutes: 15 } })).status, 403);
  });
});

describe("stop-ship: mislabelled sample processed (label mismatch scan test)", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("blocks collect/receive/process on a wrong or missing scan and records the block in custody", async () => {
    const a = await makeOrder(t, lab, ["GLU"]);
    const b = await makeOrder(t, lab, ["GLU"]);
    const wrong = await call(t, "POST", `/specimens/${a.specimens[0].id}/collect`, { token: lab.tokens.RECEPTION, body: { scannedBarcode: b.specimens[0].barcode } });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.code, "LABEL_MISMATCH");
    assert.equal((await call(t, "POST", `/specimens/${a.specimens[0].id}/collect`, { token: lab.tokens.RECEPTION, body: {} })).status, 409);
    let sp = await t.prisma.specimen.findUniqueOrThrow({ where: { id: a.specimens[0].id } });
    assert.equal(sp.status, "PENDING_COLLECTION", "state unchanged");
    const events = await t.prisma.custodyEvent.findMany({ where: { specimenId: sp.id } });
    assert.equal(events.filter((e) => e.type === "LABEL_MISMATCH_BLOCKED").length, 2);

    await call(t, "POST", `/specimens/${a.specimens[0].id}/collect`, { token: lab.tokens.RECEPTION, body: { scannedBarcode: a.specimens[0].barcode } });
    assert.equal((await call(t, "POST", `/specimens/${a.specimens[0].id}/receive`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: b.specimens[0].barcode } })).status, 409);
    await call(t, "POST", `/specimens/${a.specimens[0].id}/receive`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: a.specimens[0].barcode } });
    assert.equal((await call(t, "POST", `/specimens/${a.specimens[0].id}/process`, { token: lab.tokens.TECHNOLOGIST, body: { scannedBarcode: b.specimens[0].barcode } })).status, 409);

    // results cannot be entered for a specimen that was never processed
    const item = (await call(t, "GET", `/orders/${a.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    const r = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.GLU, instrumentId: lab.instruments.bench, value: 90 } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "SPECIMEN_NOT_PROCESSABLE");
    sp = await t.prisma.specimen.findUniqueOrThrow({ where: { id: a.specimens[0].id } });
    assert.equal(sp.status, "RECEIVED");
  });

  it("collection requires two verified identifiers", async () => {
    const r = await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "No Ids" }, testCodes: ["GLU"] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.identityVerified, false);
    const sp = r.body.specimens[0];
    const c = await call(t, "POST", `/specimens/${sp.id}/collect`, { token: lab.tokens.RECEPTION, body: { scannedBarcode: sp.barcode } });
    assert.equal(c.status, 409);
    assert.equal(c.body.code, "IDENTITY_NOT_VERIFIED");
    assert.equal((await call(t, "POST", `/orders/${r.body.id}/verify-identity`, { token: lab.tokens.RECEPTION, body: { identifiersChecked: ["phone", "dateOfBirth"] } })).status, 422, "patient record holds no such identifiers");
  });

  it("rejection creates a re-collection specimen, notifies the patient and never loses the order", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    const rej = await call(t, "POST", `/specimens/${f.specimens[0].id}/reject`, { token: lab.tokens.TECHNOLOGIST, body: { reason: "HAEMOLYSED" } });
    assert.equal(rej.status, 201);
    assert.equal(rej.body.recollection.status, "PENDING_COLLECTION");
    assert.equal(rej.body.recollection.recollectOfId, f.specimens[0].id);
    assert.ok(await t.prisma.notificationAttempt.findFirst({ where: { orgId: lab.orgId, purpose: "RECOLLECTION", relatedId: f.specimens[0].id } }));
    const o = await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(o.body.items[0].specimenId, rej.body.recollection.id);
  });
});

describe("stop-ship: duplicate accession accepted (replay test)", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("rejects a replayed accession number with 409 ACCESSION_DUPLICATE", async () => {
    const a = await makeOrder(t, lab, ["GLU"], { accession: "DEFER" });
    const b = await makeOrder(t, lab, ["GLU"], { accession: "DEFER" });
    const first = await call(t, "POST", `/orders/${a.orderId}/accession`, { token: lab.tokens.RECEPTION, body: { accessionNumber: "PRE-0001" } });
    assert.equal(first.status, 201);
    const replay = await call(t, "POST", `/orders/${b.orderId}/accession`, { token: lab.tokens.RECEPTION, body: { accessionNumber: "PRE-0001" } });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.code, "ACCESSION_DUPLICATE");
    assert.equal(await t.prisma.specimen.count({ where: { labId: lab.labId, accessionNumber: "PRE-0001" } }), 1);
  });

  it("generates unique accession numbers under concurrency", async () => {
    const made = await Promise.all(Array.from({ length: 20 }, () => makeOrder(t, lab, ["GLU"])));
    const acc = made.flatMap((m) => m.order.specimens.map((s: any) => s.accessionNumber));
    assert.equal(new Set(acc).size, acc.length);
    assert.ok(acc.every((x: string) => /^TL\d{6}\d{4}$/.test(x)), acc[0]);
  });
});
