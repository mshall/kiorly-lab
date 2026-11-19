import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

describe("analysis: analyzer bridge (simulated ASTM/HL7), dual control, auto-verification, corrections", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("simulated ASTM analyzer posts results through the same ingest path; QC messages build Levey-Jennings data", async () => {
    const f = await makeOrder(t, lab, ["CBC"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.astm, ["HB", "WBC", "PLT"]);
    const sim = await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, specimenId: f.specimens[0].id } });
    assert.equal(sim.status, 201, JSON.stringify(sim.body));
    assert.match(sim.body.raw, /^H\|\\\^&/);
    assert.equal(sim.body.outcome.status, "PARSED", JSON.stringify(sim.body.outcome));
    assert.equal(sim.body.outcome.accepted, 3);
    const results = await call(t, "GET", `/orders/${f.orderId}/results`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(results.body.length, 3);
    assert.ok(results.body.every((r: any) => r.source === "ANALYZER_ASTM" && r.qcRunId && r.refLow !== null));
    // replaying the same message is idempotent (duplicates ignored, no second result)
    const again = await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, specimenId: f.specimens[0].id } });
    assert.equal(again.status, 400, "nothing left to simulate");
    const msg = await call(t, "GET", `/analyzers/messages?instrumentId=${lab.instruments.astm}`, { token: lab.tokens.TECHNOLOGIST });
    assert.ok(msg.body.length >= 1);

    // a QC measurement over the bridge is evaluated (3.5 SD => block)
    const q = await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, qc: { materialId: lab.materials.HB.l1, z: 3.5 } } });
    assert.equal(q.body.outcome.qcRuns[0].status, "FAIL");
    assert.ok(q.body.outcome.qcRuns[0].blockId);
    const lj = await call(t, "GET", `/qc/levey-jennings?instrumentId=${lab.instruments.astm}&materialId=${lab.materials.HB.l1}`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(lj.status, 200);
    assert.ok(lj.body.points.length >= 2);
    assert.equal(lj.body.limits.plus3, lj.body.mean + 3 * lj.body.sd);
    assert.equal(lj.body.points.at(-1).status, "FAIL");
  });

  it("HL7 ORU via the bridge endpoint with an instrument API key; unknown specimens and bad keys are refused", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    const key = (await call(t, "POST", `/instruments/${lab.instruments.hl7}/api-key`, { token: lab.tokens.LAB_DIRECTOR })).body.apiKey;
    const raw = `MSH|^~\\&|SimAnalyzer|LAB|KIORLY|LAB|20261120101500||ORU^R01|MSG1|P|2.5\rOBR|1||${f.specimens[0].barcode}|GLU\rOBX|1|NM|GLU^Glucose||91|mg/dL|70-100|N|||F\r`;
    assert.equal((await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": "bad" }, body: { instrumentId: lab.instruments.hl7, payload: raw } })).status, 401);
    const ok = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key }, body: { instrumentId: lab.instruments.hl7, payload: raw } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.accepted, 1);
    assert.match(ok.body.ack, /MSA\|AA\|MSG1/);
    const dup = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key }, body: { instrumentId: lab.instruments.hl7, payload: raw } });
    assert.equal(dup.body.duplicates, 1);
    const unknown = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key }, body: { instrumentId: lab.instruments.hl7, payload: raw.replace(f.specimens[0].barcode, "NOT-A-SPECIMEN") } });
    assert.equal(unknown.body.status, "FAILED");
    assert.equal(unknown.body.errors[0].code, "UNKNOWN_SPECIMEN");
    const garbage = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key }, body: { instrumentId: lab.instruments.hl7, payload: "garbage" } });
    assert.equal(garbage.body.status, "FAILED");
    assert.match(garbage.body.ack, /MSA\|AE/);
    // results are refused for specimens not in processing (label-match safety)
    const g = await makeOrder(t, lab, ["GLU"]);
    const notProcessing = `MSH|^~\\&|S|LAB|K|LAB|20261120101500||ORU^R01|MSG9|P|2.5\rOBR|1||${g.specimens[0].barcode}|GLU\rOBX|1|NM|GLU^Glucose||91|mg/dL|||||F\r`;
    const r = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key }, body: { instrumentId: lab.instruments.hl7, payload: notProcessing } });
    assert.equal(r.body.errors[0].code, "SPECIMEN_NOT_PROCESSABLE");
  });

  it("Lite edition has no analyzer interfaces (402 PLAN_REQUIRED)", async () => {
    const lite = await makeLab(t, { edition: "LITE" });
    const key = (await call(t, "POST", `/instruments/${lite.instruments.hl7}/api-key`, { token: lite.tokens.LAB_DIRECTOR })).body.apiKey;
    const r = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key }, body: { instrumentId: lite.instruments.hl7, payload: "x" } });
    assert.equal(r.status, 402);
    assert.equal(r.body.code, "PLAN_REQUIRED");
    assert.equal((await call(t, "POST", "/orders", { token: lite.tokens.RECEPTION, body: { patient: { fullName: "Home Lite" }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { address: "Somewhere 5" } } })).status, 402);
  });

  it("auto-verification technically validates clean analyzer results only; never medical validation or release", async () => {
    await call(t, "PUT", `/analytes/${lab.analytes.GLU}/auto-verification`, { token: lab.tokens.LAB_DIRECTOR, body: { enabled: true, maxDeltaPercent: 50 } });
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.hl7, ["GLU"]);
    const sim = await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.hl7, specimenId: f.specimens[0].id } });
    assert.equal(sim.body.outcome.accepted, 1, JSON.stringify(sim.body));
    const r = (await call(t, "GET", `/orders/${f.orderId}/results`, { token: lab.tokens.TECHNOLOGIST })).body[0];
    assert.equal(r.status, "TECH_VALIDATED");
    assert.equal(r.autoVerified, true);
    assert.equal(r.techValidatedBy, "system:auto-verify");
    assert.equal(r.medicalValidatedBy, null);
    assert.equal(r.releasedAt, null);
    // an abnormal result is NOT auto-verified
    const g = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, g);
    const abn = await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.hl7, specimenId: g.specimens[0].id, mode: "abnormal" } });
    assert.equal(abn.body.outcome.accepted, 1);
    const r2 = (await call(t, "GET", `/orders/${g.orderId}/results`, { token: lab.tokens.TECHNOLOGIST })).body[0];
    assert.equal(r2.flag, "HIGH");
    assert.equal(r2.status, "ENTERED");
    // a critical simulated result raises an alert
    const c = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, c);
    await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.hl7, specimenId: c.specimens[0].id, mode: "critical" } });
    assert.ok(await t.prisma.criticalAlert.findFirst({ where: { orderId: c.orderId } }));
  });

  it("delta check flags large changes vs the prior validated result and demands acknowledgement", async () => {
    const p = { patient: { fullName: "Delta Patient", phone: "+201000000888", dateOfBirth: "1980-01-01", sex: "M" }, identifiersChecked: ["phone", "dateOfBirth"], consentChannels: ["PRINTED"] };
    const mk = async (code: string) => {
      const r = await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { ...p, testCodes: [code] } });
      const f = { orderId: r.body.id, order: r.body, specimens: r.body.specimens.map((s: any) => ({ id: s.id, barcode: s.barcode })) };
      await toProcessing(t, lab, f);
      return f;
    };
    await call(t, "PUT", `/analytes/${lab.analytes.CREA}/auto-verification`, { token: lab.tokens.LAB_DIRECTOR, body: { enabled: false, maxDeltaPercent: 40 } });
    const a = await mk("KFT");
    await qcPass(t, lab, lab.instruments.bench, ["CREA", "K", "NA"]);
    await enterAndTechValidate(t, lab, a.orderId, NORMAL);
    await call(t, "POST", `/orders/${a.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const b = await mk("KFT");
    const item = (await call(t, "GET", `/orders/${b.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.CREA, instrumentId: lab.instruments.bench, value: 1.5 } });
    assert.equal(e.body.deltaCheckFailed, true);
    assert.equal(e.body.deltaPercent, 66.67);
    await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value: 1.5 } });
    const v1 = await call(t, "POST", `/results/${e.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: {} });
    assert.equal(v1.status, 409);
    assert.equal(v1.body.code, "DELTA_CHECK_ACK_REQUIRED");
    const v2 = await call(t, "POST", `/results/${e.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: { deltaAcknowledged: true, note: "patient on new drug, confirmed" } });
    assert.equal(v2.status, 201);
  });

  it("dual control: a different person must re-key the same value; mismatch and same-user are refused; validation needs the confirmation", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.GLU, instrumentId: lab.instruments.bench, value: 95 } });
    assert.equal((await call(t, "POST", `/results/${e.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: {} })).body.code, "DUAL_CONTROL_REQUIRED");
    assert.equal((await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.TECHNOLOGIST, body: { value: 95 } })).status, 403);
    const mism = await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value: 59 } });
    assert.equal(mism.status, 422);
    assert.equal(mism.body.code, "DUAL_ENTRY_MISMATCH");
    assert.equal((await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value: 95 } })).status, 201);
    assert.equal((await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.GLU, instrumentId: lab.instruments.bench, value: 96 } })).status, 409, "no overwriting");
    assert.equal((await call(t, "POST", `/results/${e.body.id}/medical-validate`, { token: lab.tokens.TECHNOLOGIST })).status, 403);
    assert.equal((await call(t, "POST", `/results/${e.body.id}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).status, 409, "tech validation first");
  });

  it("corrections: a released result is never edited; a correction needs a reason, full re-validation and a new signed version with notifications", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    await enterAndTechValidate(t, lab, f.orderId, { ...NORMAL, GLU: 90 });
    await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const v1 = (await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).body;
    assert.equal((await call(t, "POST", `/reports/${v1.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PATIENT_LINK_OTP", "PRINTED"] } })).status, 201);
    const rel = (await call(t, "GET", `/orders/${f.orderId}/results`, { token: lab.tokens.TECHNOLOGIST })).body[0];
    assert.equal(rel.status, "RELEASED");
    // direct DB edit of a released value is impossible
    await assert.rejects(t.prisma.result.update({ where: { id: rel.id }, data: { valueNumeric: 1 } }), /immutable/);
    // no-op version is refused
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).status, 409);
    // correction
    assert.equal((await call(t, "POST", `/results/${rel.id}/correct`, { token: lab.tokens.TECHNOLOGIST, body: { value: 99, reason: "x" } })).status, 400);
    const cor = await call(t, "POST", `/results/${rel.id}/correct`, { token: lab.tokens.TECHNOLOGIST, body: { value: 99, reason: "transcription error in entry" } });
    assert.equal(cor.status, 201, JSON.stringify(cor.body));
    assert.equal(cor.body.supersedesResultId, rel.id);
    assert.equal((await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.status, "AWAITING_VALIDATION");
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).status, 409, "needs validation again");
    await call(t, "POST", `/results/${cor.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value: 99 } });
    await call(t, "POST", `/results/${cor.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: {} });
    await call(t, "POST", `/results/${cor.body.id}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    // the old version still exists unchanged, the new one carries the reason
    const v2 = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(v2.status, 201, JSON.stringify(v2.body));
    assert.equal(v2.body.version, 2);
    assert.equal(v2.body.correctionReason, "transcription error in entry");
    assert.equal(v2.body.supersedesId, v1.id);
    assert.equal((await call(t, "POST", `/reports/${v1.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PRINTED"] } })).status, 409, "v1 is superseded");
    const rel2 = await call(t, "POST", `/reports/${v2.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PATIENT_LINK_OTP"] } });
    assert.equal(rel2.status, 201);
    assert.ok(await t.prisma.notificationAttempt.findFirst({ where: { orgId: lab.orgId, purpose: "REPORT_CORRECTED", relatedId: v2.body.id } }), "recipients notified");
    const events = await t.prisma.outboxEvent.findMany({ where: { orgId: lab.orgId, aggregateId: v2.body.id } });
    assert.deepEqual(events.map((e) => e.type).sort(), ["LabReportCorrected", "LabResultReleased"]);
    assert.equal((events.find((e) => e.type === "LabResultReleased")!.payload as any).data.reportVersion, 2);
    const v1pdf = await call(t, "GET", `/reports/${v1.id}/pdf`, { token: lab.tokens.RECEPTION });
    assert.equal(v1pdf.status, 200, "v1 stays retrievable");
  });

  it("release needs consent for every channel (safety.lab.consent_enforcement)", async () => {
    const r = await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "No Consent", phone: "+201000000999", dateOfBirth: "1991-01-01" }, testCodes: ["GLU"], identifiersChecked: ["phone", "dateOfBirth"] } });
    const f = { orderId: r.body.id, order: r.body, specimens: r.body.specimens.map((s: any) => ({ id: s.id, barcode: s.barcode })) };
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    await enterAndTechValidate(t, lab, f.orderId, NORMAL);
    await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const rep = (await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).body;
    const no = await call(t, "POST", `/reports/${rep.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PRINTED"] } });
    assert.equal(no.status, 409);
    assert.equal(no.body.code, "CONSENT_REQUIRED");
    await call(t, "PUT", `/orders/${f.orderId}/consent`, { token: lab.tokens.RECEPTION, body: { channels: ["PRINTED"] } });
    assert.equal((await call(t, "POST", `/reports/${rep.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["KIOREX_VAULT"] } })).body.code, "CONSENT_REQUIRED");
    assert.equal((await call(t, "POST", `/reports/${rep.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PRINTED"] } })).status, 201);
    // the patient link refuses without a PATIENT_LINK_OTP release
    const link = await t.prisma.reportShareLink.findFirstOrThrow({ where: { reportVersionId: rep.id } });
    void link;
  });
});
