import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

describe("M5 quality: QC lots + statistics, calibration, EQA, maintenance, NCR/CAPA, document control", () => {
  let t: TestApp;
  let lab: Lab;
  const T = () => lab.tokens;
  before(async () => { t = await bootApp(); lab = await makeLab(t); });
  after(async () => t.close());

  it("QC lots: list with expiry state, statistics vs target, retired lots refuse new runs", async () => {
    const lots = await call(t, "GET", "/qc/lots", { token: T().TECHNOLOGIST });
    assert.equal(lots.status, 200);
    const hb = lots.body.find((l: any) => l.analyte.code === "HB" && l.level === "LEVEL_1");
    assert.equal(hb.state, "OK");
    for (const v of [14, 14.2, 13.8, 14.1]) await call(t, "POST", "/qc/runs", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: hb.id, value: v } });
    const st = await call(t, "GET", `/qc/statistics?materialId=${hb.id}`, { token: T().TECHNOLOGIST });
    assert.equal(st.body.observed.n, 4);
    assert.equal(st.body.observed.mean, 14.025);
    assert.equal(st.body.biasPercent, 0.18);
    assert.equal(st.body.target.cv, 2.14);
    assert.equal((await call(t, "PUT", `/qc/lots/${hb.id}`, { token: T().TECHNOLOGIST, body: { status: "RETIRED" } })).status, 403);
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    assert.equal((await call(t, "PUT", `/qc/lots/${hb.id}`, { token: T().SUPERVISOR, body: { manufacturer: "Bio-Rad (synthetic)", expiresAt: soon } })).status, 200);
    assert.equal((await call(t, "GET", "/qc/lots", { token: T().TECHNOLOGIST })).body.find((l: any) => l.id === hb.id).state, "EXPIRING_SOON");
    assert.equal((await call(t, "GET", "/quality/summary", { token: T().SUPERVISOR })).body.lotsExpiringSoon, 1);
    await call(t, "PUT", `/qc/lots/${hb.id}`, { token: T().SUPERVISOR, body: { status: "RETIRED" } });
    const run = await call(t, "POST", "/qc/runs", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: hb.id, value: 14 } });
    assert.equal(run.status, 409);
    assert.equal(run.body.code, "QC_MATERIAL_RETIRED");
  });

  it("calibration: failed calibration needs a note and raises an NCR; passing one sets the next due date", async () => {
    const b = { instrumentId: lab.instruments.astm, calibratorLot: "CAL-001", status: "FAIL" };
    assert.equal((await call(t, "POST", "/calibrations", { token: T().TECHNOLOGIST, body: b })).body.code, "NOTE_REQUIRED");
    assert.equal((await call(t, "POST", "/calibrations", { token: T().RECEPTION, body: { ...b, note: "x" } })).status, 403);
    const fail = await call(t, "POST", "/calibrations", { token: T().TECHNOLOGIST, body: { ...b, note: "re-ran with fresh calibrator" } });
    assert.equal(fail.status, 201);
    const ncrs = await call(t, "GET", "/ncrs?status=OPEN", { token: T().SUPERVISOR });
    assert.ok(ncrs.body.some((n: any) => n.source === "INSTRUMENT" && n.title === "Calibration failed"));
    const ok = await call(t, "POST", "/calibrations", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, analyteId: lab.analytes.GLU, calibratorLot: "CAL-002", status: "PASS", slope: 1.01, intercept: 0.2, nextDueDays: 30 } });
    assert.equal(ok.body.slope, 1.01);
    assert.ok(ok.body.nextDueAt);
    const list = await call(t, "GET", `/calibrations?instrumentId=${lab.instruments.astm}`, { token: T().TECHNOLOGIST });
    assert.equal(list.body.length, 2);
  });

  it("EQA: z-score from peer SD, status thresholds, unacceptable result opens an NCR automatically", async () => {
    const mk = (reported: number) => call(t, "POST", "/eqa", { token: T().TECHNOLOGIST, body: { scheme: "RIQAS (synthetic)", cycle: "2026-C5", sampleCode: "S1", analyteId: lab.analytes.GLU, reportedValue: reported, assignedValue: 100, groupSd: 3 } });
    const a = await mk(102);
    assert.deepEqual([a.body.zScore, a.body.status, a.body.ncrId], [0.667, "ACCEPTABLE", null]);
    const w = await mk(107);
    assert.deepEqual([w.body.zScore, w.body.status], [2.333, "WARNING"]);
    const u = await mk(95);
    assert.deepEqual([u.body.zScore, u.body.status], [-1.667, "ACCEPTABLE"]);
    const bad = await mk(112);
    assert.equal(bad.body.status, "UNACCEPTABLE");
    assert.ok(bad.body.ncrId);
    const ncr = await call(t, "GET", `/ncrs/${bad.body.ncrId}`, { token: T().SUPERVISOR });
    assert.equal(ncr.body.source, "EQA");
    assert.equal(ncr.body.severity, "MAJOR");
    assert.equal((await call(t, "GET", `/eqa?analyteId=${lab.analytes.GLU}`, { token: T().SUPERVISOR })).body.length, 4);
    assert.equal((await call(t, "POST", "/eqa", { token: T().TECHNOLOGIST, body: { scheme: "x", cycle: "1", sampleCode: "S", analyteId: lab.analytes.GLU, reportedValue: 1, assignedValue: 1, groupSd: 0 } })).status, 400);
    assert.equal((await call(t, "GET", "/quality/summary", { token: T().SUPERVISOR })).body.eqaUnacceptable90d, 1);
  });

  it("maintenance: schedules go overdue, logging against a schedule resets the due date", async () => {
    const s = await call(t, "POST", "/maintenance/schedules", { token: T().SUPERVISOR, body: { instrumentId: lab.instruments.astm, task: "Daily probe cleaning", frequencyDays: 1, firstDueAt: new Date(Date.now() - 86_400_000).toISOString() } });
    assert.equal(s.status, 201);
    assert.equal((await call(t, "POST", "/maintenance/schedules", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, task: "x", frequencyDays: 7 } })).status, 403);
    const over = await call(t, "GET", "/maintenance/schedules?overdue=true", { token: T().TECHNOLOGIST });
    assert.equal(over.body.length, 1);
    assert.equal(over.body[0].overdue, true);
    assert.equal((await call(t, "GET", "/quality/summary", { token: T().SUPERVISOR })).body.maintenanceOverdue, 1);
    const log = await call(t, "POST", "/maintenance/logs", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, scheduleId: s.body.id, kind: "CLEANING", notes: "done", downtimeMinutes: 15 } });
    assert.equal(log.status, 201);
    assert.equal((await call(t, "GET", "/maintenance/schedules?overdue=true", { token: T().TECHNOLOGIST })).body.length, 0);
    const after = (await call(t, "GET", "/maintenance/schedules", { token: T().TECHNOLOGIST })).body[0];
    assert.ok(new Date(after.nextDueAt).getTime() > Date.now());
    assert.ok(after.lastDoneAt);
    assert.equal((await call(t, "POST", "/maintenance/logs", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, scheduleId: s.body.id, kind: "CLEANING" } })).status, 404, "schedule must belong to the instrument");
    assert.equal((await call(t, "GET", `/maintenance/logs?instrumentId=${lab.instruments.astm}`, { token: T().TECHNOLOGIST })).body.length, 1);
  });

  it("NCR/CAPA: strict workflow, root cause before action, all CAPA done then verified by someone else before closure", async () => {
    const n = await call(t, "POST", "/ncrs", { token: T().TECHNOLOGIST, body: { title: "Sample labelling error", description: "Tube labelled with wrong accession", area: "PRE_ANALYTICAL", severity: "MAJOR" } });
    assert.equal(n.status, 201);
    assert.match(n.body.number, /^NCR-\d{4}-\d{6}$/);
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "CLOSED" } })).body.code, "NCR_ILLEGAL_TRANSITION");
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().TECHNOLOGIST, body: { to: "INVESTIGATING" } })).status, 403, "technologists raise, supervisors manage");
    await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "INVESTIGATING" } });
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "ACTION" } })).body.code, "ROOT_CAUSE_REQUIRED");
    await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "ACTION", rootCause: "label printer misfeed", containment: "all tubes relabelled" } });
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "VERIFIED" } })).body.code, "CAPA_INCOMPLETE");
    const capa = await call(t, "POST", `/ncrs/${n.body.id}/actions`, { token: T().SUPERVISOR, body: { description: "Replace printer ribbon + daily check", ownerId: lab.staff.SUPERVISOR.id, dueAt: new Date(Date.now() - 86_400_000).toISOString() } });
    assert.equal(capa.status, 201);
    assert.equal((await call(t, "GET", "/capa-actions?overdue=true", { token: T().SUPERVISOR })).body.length, 1);
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "VERIFIED" } })).body.code, "CAPA_INCOMPLETE");
    assert.equal((await call(t, "POST", `/capa-actions/${capa.body.id}/verify`, { token: T().SUPERVISOR, body: { effectiveness: "no recurrence" } })).body.code, "CAPA_NOT_DONE");
    await call(t, "POST", `/capa-actions/${capa.body.id}/complete`, { token: T().TECHNOLOGIST });
    assert.equal((await call(t, "POST", `/capa-actions/${capa.body.id}/verify`, { token: T().SUPERVISOR, body: { effectiveness: "no recurrence in 30 days" } })).status, 403, "owner cannot verify own action");
    await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "VERIFIED" } });
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "CLOSED" } })).body.code, "CAPA_NOT_VERIFIED");
    assert.equal((await call(t, "POST", `/capa-actions/${capa.body.id}/verify`, { token: T().LAB_DIRECTOR, body: { effectiveness: "no recurrence in 30 days" } })).status, 201);
    const closed = await call(t, "POST", `/ncrs/${n.body.id}/advance`, { token: T().SUPERVISOR, body: { to: "CLOSED" } });
    assert.equal(closed.body.status, "CLOSED");
    assert.ok(closed.body.closedAt && closed.body.closedBy);
    assert.equal((await call(t, "POST", `/ncrs/${n.body.id}/actions`, { token: T().SUPERVISOR, body: { description: "late" } })).body.code, "NCR_CLOSED");
  });

  it("document control: draft -> review -> approval by a different person, supersession, acknowledgements, review due", async () => {
    const d = await call(t, "POST", "/documents", { token: T().SUPERVISOR, body: { code: "sop-001", title: "Specimen reception", category: "SOP", section: "Pre-analytics", body: "# Specimen reception\n1. Check two identifiers." } });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.equal(d.body.code, "SOP-001");
    assert.equal((await call(t, "POST", "/documents", { token: T().SUPERVISOR, body: { code: "SOP-001", title: "dup", body: "x" } })).status, 409);
    assert.equal((await call(t, "POST", "/documents", { token: T().RECEPTION, body: { code: "SOP-X", title: "no", body: "x" } })).status, 403);
    const v1 = d.body.versions[0];
    assert.equal(v1.status, "DRAFT");
    assert.equal((await call(t, "POST", `/documents/${d.body.id}/versions/${v1.id}/approve`, { token: T().AUTHORIZED_SIGNATORY, body: {} })).body.code, "VERSION_ILLEGAL_TRANSITION", "must be reviewed first");
    await call(t, "PUT", `/documents/${d.body.id}/versions/${v1.id}`, { token: T().SUPERVISOR, body: { body: "# Specimen reception\n1. Check two identifiers.\n2. Reject haemolysed samples." } });
    await call(t, "POST", `/documents/${d.body.id}/versions/${v1.id}/submit`, { token: T().SUPERVISOR });
    assert.equal((await call(t, "PUT", `/documents/${d.body.id}/versions/${v1.id}`, { token: T().SUPERVISOR, body: { body: "x" } })).body.code, "VERSION_NOT_DRAFT");
    assert.equal((await call(t, "POST", `/documents/${d.body.id}/versions/${v1.id}/approve`, { token: T().SUPERVISOR, body: {} })).status, 403, "supervisors cannot approve");
    const authorIsApprover = await call(t, "POST", "/documents", { token: T().LAB_DIRECTOR, body: { code: "SOP-002", title: "Self approve", body: "x" } });
    await call(t, "POST", `/documents/${authorIsApprover.body.id}/versions/${authorIsApprover.body.versions[0].id}/submit`, { token: T().LAB_DIRECTOR });
    assert.equal((await call(t, "POST", `/documents/${authorIsApprover.body.id}/versions/${authorIsApprover.body.versions[0].id}/approve`, { token: T().LAB_DIRECTOR, body: {} })).body.code, "APPROVER_MUST_DIFFER");
    const ap = await call(t, "POST", `/documents/${d.body.id}/versions/${v1.id}/approve`, { token: T().AUTHORIZED_SIGNATORY, body: { reviewMonths: 6 } });
    assert.equal(ap.status, 201, JSON.stringify(ap.body));
    assert.equal(ap.body.status, "APPROVED");
    assert.ok(ap.body.reviewDueAt);
    // acknowledgement
    assert.equal((await call(t, "GET", "/documents/pending-acks", { token: T().TECHNOLOGIST })).body.length, 1);
    assert.equal((await call(t, "POST", `/documents/${d.body.id}/versions/${v1.id}/ack`, { token: T().TECHNOLOGIST })).status, 201);
    assert.equal((await call(t, "GET", "/documents/pending-acks", { token: T().TECHNOLOGIST })).body.length, 0);
    // revision supersedes
    const r = await call(t, "POST", `/documents/${d.body.id}/revisions`, { token: T().SUPERVISOR, body: { changeNote: "add rejection criteria" } });
    assert.equal(r.body.version, 2);
    assert.equal((await call(t, "POST", `/documents/${d.body.id}/revisions`, { token: T().SUPERVISOR, body: { changeNote: "again" } })).body.code, "DRAFT_EXISTS");
    assert.equal((await call(t, "POST", `/documents/${d.body.id}/versions/${r.body.id}/ack`, { token: T().TECHNOLOGIST })).body.code, "VERSION_NOT_EFFECTIVE");
    await call(t, "POST", `/documents/${d.body.id}/versions/${r.body.id}/submit`, { token: T().SUPERVISOR });
    await call(t, "POST", `/documents/${d.body.id}/versions/${r.body.id}/approve`, { token: T().AUTHORIZED_SIGNATORY, body: {} });
    const full = await call(t, "GET", `/documents/${d.body.id}`, { token: T().TECHNOLOGIST });
    assert.deepEqual(full.body.versions.map((v: any) => [v.version, v.status]), [[2, "APPROVED"], [1, "SUPERSEDED"]]);
    const list = await call(t, "GET", "/documents?search=reception", { token: T().TECHNOLOGIST });
    assert.equal(list.body[0].effectiveVersion, 2);
    assert.equal((await call(t, "GET", "/documents/pending-acks", { token: T().TECHNOLOGIST })).body.length, 1, "new effective version needs a new acknowledgement");
    // reject back to draft
    const rj = await call(t, "POST", `/documents/${authorIsApprover.body.id}/versions/${authorIsApprover.body.versions[0].id}/reject`, { token: T().AUTHORIZED_SIGNATORY });
    assert.equal(rj.body.status, "DRAFT");
  });
});
