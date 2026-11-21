import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, PATIENT, bootApp, call, makeLab, makeOrder, releaseOrder, toProcessing } from "./helpers/app";

describe("M4 analytics: value types, calculated tests, reruns/dilution, delta checks, condition ranges, worklists, microbiology, histopathology, amendments", () => {
  let t: TestApp;
  let lab: Lab;
  const T = () => lab.tokens;
  before(async () => { t = await bootApp(); lab = await makeLab(t); });
  after(async () => t.close());

  async function mkAnalyte(body: Record<string, unknown>) {
    const r = await call(t, "POST", "/catalogue/analytes", { token: T().LAB_DIRECTOR, body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  async function mkTest(code: string, analyteCodes: string[], extra: Record<string, unknown> = {}) {
    const r = await call(t, "POST", "/catalogue/tests", { token: T().LAB_DIRECTOR, body: { code, nameEn: code, specimenType: "Serum", container: "Serum gel (yellow)", volumeMl: 3, price: 100, analyteCodes, ...extra } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  }
  /** QC materials (two levels) + passing runs for an analyte on the bench instrument. */
  async function qcFor(analyteId: string, mean: number, sd: number, instrumentId = lab.instruments.bench) {
    for (const [level, m] of [["LEVEL_1", mean], ["LEVEL_2", mean * 1.3]] as const) {
      const mat = await call(t, "POST", "/qc/materials", { token: T().LAB_DIRECTOR, body: { analyteId, level, materialLot: `L-${level}`, targetMean: m, targetSd: sd } });
      assert.equal(mat.status, 201, JSON.stringify(mat.body));
      const run = await call(t, "POST", "/qc/runs", { token: T().TECHNOLOGIST, body: { instrumentId, materialId: mat.body.id, value: m } });
      assert.equal(run.status, 201, JSON.stringify(run.body));
    }
  }
  const enter = (body: Record<string, unknown>, token = T().TECHNOLOGIST) => call(t, "POST", "/results", { token, body });
  const dual = async (resultId: string, value: number | undefined, valueText?: string) => {
    const s = await call(t, "POST", `/results/${resultId}/second-entry`, { token: T().LAB_DIRECTOR, body: value !== undefined ? { value } : { valueText } });
    assert.equal(s.status, 201, JSON.stringify(s.body));
  };

  it("analyte value types: CHOICE/SEMI_QUANT enforce the scale and flag by the normal set; invalid specs refused", async () => {
    assert.equal((await call(t, "POST", "/catalogue/analytes", { token: T().LAB_DIRECTOR, body: { code: "BADCH", nameEn: "x", valueType: "CHOICE" } })).body.code, "ALLOWED_VALUES_REQUIRED");
    assert.equal((await call(t, "POST", "/catalogue/analytes", { token: T().LAB_DIRECTOR, body: { code: "BADN", nameEn: "x", valueType: "CHOICE", allowedValues: ["A"], normalValues: ["B"] } })).body.code, "NORMAL_VALUES_NOT_ALLOWED");
    const pro = await mkAnalyte({ code: "UPRO", nameEn: "Urine protein", valueType: "SEMI_QUANT", allowedValues: ["Negative", "Trace", "1+", "2+", "3+"], normalValues: ["Negative", "Trace"] });
    await mkTest("UA", ["UPRO"], { specimenType: "Urine", container: "Urine cup", section: "URINALYSIS" });
    await qcFor(pro.id, 10, 1);
    const f = await makeOrder(t, lab, ["UA"]);
    await toProcessing(t, lab, f);
    const item = f.order.items[0];
    assert.equal((await enter({ orderItemId: item.id, analyteId: pro.id, instrumentId: lab.instruments.bench, valueText: "5+" })).body.code, "VALUE_NOT_ALLOWED");
    assert.equal((await enter({ orderItemId: item.id, analyteId: pro.id, instrumentId: lab.instruments.bench, value: 3 })).status, 422);
    const ok = await enter({ orderItemId: item.id, analyteId: pro.id, instrumentId: lab.instruments.bench, valueText: "2+" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.flag, "ABNORMAL");
    await dual(ok.body.id, undefined, "2+");
    const rr = await call(t, "POST", `/results/${ok.body.id}/rerun`, { token: T().TECHNOLOGIST, body: { reason: "dip read unclear" } });
    assert.equal(rr.status, 201);
    const again = await enter({ orderItemId: item.id, analyteId: pro.id, instrumentId: lab.instruments.bench, valueText: "Trace" });
    assert.equal(again.body.flag, "NORMAL");
    assert.equal(again.body.rerunOfId, ok.body.id, "repeat links to the first run");
  });

  it("calculated tests: LDL is derived when inputs exist, recomputed on rerun, blocked by input QC, never from a missing input", async () => {
    const tc = await mkAnalyte({ code: "TC", nameEn: "Total cholesterol", unit: "mg/dL", precision: 0 });
    const hdl = await mkAnalyte({ code: "HDL", nameEn: "HDL", unit: "mg/dL", precision: 0 });
    const tg = await mkAnalyte({ code: "TG", nameEn: "Triglycerides", unit: "mg/dL", precision: 0 });
    assert.equal((await call(t, "POST", "/catalogue/analytes", { token: T().LAB_DIRECTOR, body: { code: "LDLX", nameEn: "x", formula: "TC - NOPE" } })).body.code, "FORMULA_UNKNOWN_ANALYTE");
    assert.equal((await call(t, "POST", "/catalogue/analytes", { token: T().LAB_DIRECTOR, body: { code: "LDLX", nameEn: "x", formula: "TC -" } })).body.code, "FORMULA_INVALID");
    const ldl = await mkAnalyte({ code: "LDL", nameEn: "LDL (calculated)", unit: "mg/dL", precision: 0, formula: "IF(TG < 400, TC - HDL - TG / 5, 0 / 0)" });
    assert.equal((await call(t, "POST", "/catalogue/analytes", { token: T().LAB_DIRECTOR, body: { code: "BAD2", nameEn: "x", formula: "LDL + 1" } })).body.code, "FORMULA_CHAINED");
    await mkTest("LIPID", ["TC", "HDL", "TG", "LDL"]);
    for (const [a, m, sd] of [[tc, 200, 5], [hdl, 50, 2], [tg, 150, 6]] as const) await qcFor(a.id, m, sd);
    const f = await makeOrder(t, lab, ["LIPID"], { patient: { ...PATIENT, fullName: "Lipid Pt", phone: "+201000000333" } });
    await toProcessing(t, lab, f);
    const item = f.order.items[0];
    const put = (analyteId: string, value: number, extra: object = {}) => enter({ orderItemId: item.id, analyteId, instrumentId: lab.instruments.bench, value, ...extra });
    const rTc = await put(tc.id, 200);
    await put(hdl.id, 50);
    let res = await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST });
    assert.ok(!res.body.some((r: any) => r.analyte.code === "LDL"), "no LDL until every input exists");
    const rTg = await put(tg.id, 100);
    res = await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST });
    const calc = res.body.find((r: any) => r.analyte.code === "LDL");
    assert.equal(calc.valueNumeric, 130);
    assert.equal(calc.source, "CALCULATED");
    assert.ok(calc.qcRunId, "calculated values inherit QC cover from their inputs");

    // rerun TG on a 5x dilution: the first run and the calculated LDL are sent back; the repeat applies the factor
    await dual(rTg.body.id, 100);
    const rr = await call(t, "POST", `/results/${rTg.body.id}/rerun`, { token: T().TECHNOLOGIST, body: { reason: "lipaemic, dilute", dilutionFactor: 5 } });
    assert.equal(rr.status, 201, JSON.stringify(rr.body));
    res = await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST });
    assert.equal(res.body.find((r: any) => r.analyte.code === "LDL").status, "REJECTED");
    assert.equal((await call(t, "GET", "/reruns?status=OPEN", { token: T().TECHNOLOGIST })).body.filter((r: any) => r.analyte === "TG").length, 1);
    const rep = await put(tg.id, 40);
    assert.equal(rep.status, 201, JSON.stringify(rep.body));
    assert.equal(rep.body.valueNumeric, 200, "measured 40 x dilution 5");
    assert.equal(rep.body.rawValue, 40);
    assert.equal(rep.body.dilutionFactor, 5);
    assert.equal((await call(t, "GET", "/reruns?status=DONE", { token: T().TECHNOLOGIST })).body.filter((r: any) => r.analyte === "TG").length, 1);
    res = await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST });
    const ldl2 = res.body.filter((r: any) => r.analyte.code === "LDL" && r.status !== "REJECTED");
    assert.equal(ldl2.length, 1);
    assert.equal(ldl2[0].valueNumeric, 110, "200 - 50 - 200/5");
    void rTc;

    // TG >= 400 -> formula not computable -> no derived value
    const f2 = await makeOrder(t, lab, ["LIPID"], { patient: { ...PATIENT, fullName: "Lipid Two", phone: "+201000000334" } });
    await toProcessing(t, lab, f2);
    const it2 = f2.order.items[0];
    for (const [a, v] of [[tc, 250], [hdl, 40], [tg, 450]] as const) await enter({ orderItemId: it2.id, analyteId: a.id, instrumentId: lab.instruments.bench, value: v });
    res = await call(t, "GET", `/orders/${f2.orderId}/results`, { token: T().TECHNOLOGIST });
    assert.ok(!res.body.some((r: any) => r.analyte.code === "LDL"));

    // QC block on an input analyte blocks the derived value from validation
    const f3 = await makeOrder(t, lab, ["LIPID"], { patient: { ...PATIENT, fullName: "Lipid Three", phone: "+201000000335" } });
    await toProcessing(t, lab, f3);
    const it3 = f3.order.items[0];
    const ids: Record<string, string> = {};
    for (const [a, v] of [[tc, 210], [hdl, 45], [tg, 100]] as const) { const r = await enter({ orderItemId: it3.id, analyteId: a.id, instrumentId: lab.instruments.bench, value: v }); ids[a.id] = r.body.id; }
    const mats = (await call(t, "GET", `/qc/materials?analyteId=${hdl.id}`, { token: T().TECHNOLOGIST })).body;
    await call(t, "POST", "/qc/runs", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: mats[0].id, value: 50 + 7 * 2 } }); // 7 SD out -> 1_3s -> block
    res = await call(t, "GET", `/orders/${f3.orderId}/results`, { token: T().TECHNOLOGIST });
    assert.equal(res.body.find((r: any) => r.analyte.code === "LDL").status, "REJECTED", "derived value is sent back with its input");
    assert.equal(res.body.find((r: any) => r.analyte.code === "HDL").status, "REJECTED");
  });

  it("reference ranges by condition: a pregnant patient gets the condition-specific interval; versions stay separate", async () => {
    const tsh = lab.analytes.TSH;
    const add = await call(t, "POST", `/catalogue/analytes/${tsh}/reference-intervals`, { token: T().LAB_DIRECTOR, body: { sex: "F", ageMinDays: 6570, low: 0.1, high: 2.5, condition: "PREGNANT_T1", source: "SYNTHETIC" } });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.condition, "PREGNANT_T1");
    const preg = (await call(t, "POST", "/patients", { token: T().RECEPTION, body: { fullName: "Preg Pt", dateOfBirth: "1995-04-04", sex: "F", phone: "+201000000444", conditions: ["PREGNANT_T1"] } })).body;
    const plain = (await call(t, "POST", "/patients", { token: T().RECEPTION, body: { fullName: "Plain Pt", dateOfBirth: "1995-04-04", sex: "F", phone: "+201000000445" } })).body;
    const run = async (patientId: string) => {
      const f = await makeOrder(t, lab, ["TSH"], { patientId, patient: undefined, identifiersChecked: ["dateOfBirth", "phone"] });
      await toProcessing(t, lab, f);
      const r = await enter({ orderItemId: f.order.items[0].id, analyteId: tsh, instrumentId: lab.instruments.bench, value: 3 });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body;
    };
    await call(t, "POST", "/qc/runs", { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: lab.materials.TSH.l1, value: 2 } });
    const a = await run(preg.id);
    const b = await run(plain.id);
    assert.deepEqual([a.refHigh, a.flag], [2.5, "HIGH"], "pregnancy interval applies: 3 mIU/L is high");
    assert.deepEqual([b.refHigh, b.flag], [4, "NORMAL"], "general interval for the non-pregnant patient");
  });

  it("delta checks honour the look-back window and the absolute limit", async () => {
    const crea = lab.analytes.CREA;
    assert.equal((await call(t, "PUT", `/analytes/${crea}/auto-verification`, { token: T().LAB_DIRECTOR, body: { enabled: false, maxDeltaAbsolute: 0.3, deltaWindowDays: 30 } })).status, 200);
    const p = { ...PATIENT, fullName: "Delta Pt", phone: "+201000000555" };
    const f1 = await makeOrder(t, lab, ["KFT"], { patient: p });
    await releaseOrder(t, lab, f1, { values: { CREA: 1.0 } });
    const f2 = await makeOrder(t, lab, ["KFT"], { patient: p });
    await toProcessing(t, lab, f2);
    const it = f2.order.items[0];
    const r = await enter({ orderItemId: it.id, analyteId: crea, instrumentId: lab.instruments.bench, value: 1.5 });
    assert.equal(r.body.deltaCheckFailed, true, "absolute change 0.5 > 0.3");
    assert.equal(r.body.deltaPercent, 50);
    // outside the window the prior no longer counts
    await t.prisma.result.updateMany({ where: { orgId: lab.orgId, analyteId: crea, status: "RELEASED" }, data: { enteredAt: new Date(Date.now() - 90 * 86_400_000) } });
    const f3 = await makeOrder(t, lab, ["KFT"], { patient: p });
    await toProcessing(t, lab, f3);
    const r3 = await enter({ orderItemId: f3.order.items[0].id, analyteId: crea, instrumentId: lab.instruments.bench, value: 1.5 });
    assert.equal(r3.body.deltaCheckFailed, false);
    assert.equal(r3.body.deltaPercent, null);
  });

  it("worklists filter by section, instrument sections and priority", async () => {
    const cbc = await makeOrder(t, lab, ["CBC"], { patient: { ...PATIENT, fullName: "WL One", phone: "+201000000601" }, priority: "STAT" });
    const glu = await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "WL Two", phone: "+201000000602" } });
    await call(t, "PUT", "/catalogue/tests/" + (await call(t, "GET", "/catalogue/tests?search=CBC", { token: T().TECHNOLOGIST })).body[0].id, { token: T().LAB_DIRECTOR, body: { section: "HEMATOLOGY" } });
    await call(t, "PUT", "/catalogue/tests/" + (await call(t, "GET", "/catalogue/tests?search=GLU", { token: T().TECHNOLOGIST })).body[0].id, { token: T().LAB_DIRECTOR, body: { section: "CHEMISTRY" } });
    await toProcessing(t, lab, cbc);
    await toProcessing(t, lab, glu);
    const orderIds = (rows: any[]) => rows.map((s) => s.order.id);
    const h = await call(t, "GET", "/worklist?section=HEMATOLOGY", { token: T().TECHNOLOGIST });
    assert.ok(orderIds(h.body).includes(cbc.orderId) && !orderIds(h.body).includes(glu.orderId));
    assert.ok(h.body.every((s: any) => s.items.every((i: any) => i.test.section === "HEMATOLOGY")));
    assert.equal((await call(t, "PUT", `/instruments/${lab.instruments.hl7}/sections`, { token: T().LAB_DIRECTOR, body: { sections: ["CHEMISTRY"] } })).status, 200);
    const c = await call(t, "GET", `/worklist?instrumentId=${lab.instruments.hl7}`, { token: T().TECHNOLOGIST });
    assert.ok(orderIds(c.body).includes(glu.orderId) && !orderIds(c.body).includes(cbc.orderId));
    const s = await call(t, "GET", "/worklist?priority=STAT", { token: T().TECHNOLOGIST });
    assert.ok(orderIds(s.body).includes(cbc.orderId) && !orderIds(s.body).includes(glu.orderId));
    assert.equal((await call(t, "PUT", `/instruments/${lab.instruments.hl7}/sections`, { token: T().RECEPTION, body: { sections: [] } })).status, 403);
  });

  it("microbiology: culture + sensitivity with selective reporting, QC-covered structured result, validation and positive-blood-culture critical alert", async () => {
    assert.equal((await call(t, "POST", "/microbiology/catalogue/starter", { token: T().LAB_DIRECTOR })).status, 201);
    assert.equal((await call(t, "POST", "/microbiology/catalogue/starter", { token: T().LAB_DIRECTOR })).body.created, 0, "idempotent");
    const cult = await mkAnalyte({ code: "CULT", nameEn: "Culture result", valueType: "TEXT" });
    await mkTest("UCULT", ["CULT"], { nameEn: "Urine culture", specimenType: "Urine", container: "Sterile cup", section: "MICROBIOLOGY", price: 150 });
    await mkTest("BCULT", ["CULT"], { nameEn: "Blood culture", specimenType: "Blood", container: "Blood culture bottle", section: "MICROBIOLOGY", price: 250 });
    await qcFor(cult.id, 10, 1);
    const org = (await call(t, "GET", "/microbiology/organisms", { token: T().TECHNOLOGIST })).body;
    const abx = (await call(t, "GET", "/microbiology/antibiotics", { token: T().TECHNOLOGIST })).body;
    const ecoli = org.find((o: any) => o.code === "ECOLI");
    const ab = (c: string) => abx.find((a: any) => a.code === c).id;
    assert.ok((await call(t, "GET", "/microbiology/panels", { token: T().TECHNOLOGIST })).body.some((p: any) => p.name === "Enterobacterales" && p.antibiotics.length === 13));

    const f = await makeOrder(t, lab, ["UCULT"], { patient: { ...PATIENT, fullName: "Micro Pt", phone: "+201000000701" } });
    await toProcessing(t, lab, f);
    const item = f.order.items[0];
    const bad = await call(t, "POST", "/microbiology/cases", { token: T().RECEPTION, body: { orderItemId: item.id } });
    assert.equal(bad.status, 403);
    const c = await call(t, "POST", "/microbiology/cases", { token: T().TECHNOLOGIST, body: { orderItemId: item.id, site: "Midstream urine", gramStain: "Gram-negative bacilli", cultureMedia: ["CLED", "MacConkey"] } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal((await call(t, "POST", "/microbiology/cases", { token: T().TECHNOLOGIST, body: { orderItemId: item.id } })).body.code, "CASE_EXISTS");
    assert.equal((await call(t, "POST", `/microbiology/cases/${c.body.id}/finalize`, { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench } })).body.code, "GROWTH_NOT_RECORDED");
    assert.equal((await call(t, "PUT", `/microbiology/cases/${c.body.id}`, { token: T().TECHNOLOGIST, body: { status: "INCUBATING" } })).body.status, "INCUBATING");
    const iso = await call(t, "POST", `/microbiology/cases/${c.body.id}/isolates`, { token: T().TECHNOLOGIST, body: { organismId: ecoli.id, quantity: ">10^5 CFU/mL" } });
    assert.equal(iso.body.growth, true);
    assert.equal((await call(t, "POST", `/microbiology/cases/${c.body.id}/finalize`, { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench } })).body.code, "SUSCEPTIBILITY_REQUIRED");
    const isoId = iso.body.isolates[0].id;
    const sus = await call(t, "PUT", `/microbiology/cases/${c.body.id}/isolates/${isoId}/susceptibilities`, { token: T().TECHNOLOGIST, body: { rows: [
      { antibioticId: ab("AMK"), interpretation: "S", zoneMm: 22 }, { antibioticId: ab("MEM"), interpretation: "S", method: "MIC", micMgL: 0.25 },
      { antibioticId: ab("AMP"), interpretation: "R" }, { antibioticId: ab("COL"), interpretation: "S", reported: false },
    ] } });
    assert.equal(sus.status, 200, JSON.stringify(sus.body));
    const fin = await call(t, "POST", `/microbiology/cases/${c.body.id}/finalize`, { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, comment: "Correlate clinically." } });
    assert.equal(fin.status, 201, JSON.stringify(fin.body));
    assert.match(fin.body.text, /Isolate: Escherichia coli \(>10\^5 CFU\/mL\)/);
    assert.match(fin.body.text, /Sensitive: Amikacin, Meropenem/);
    assert.match(fin.body.text, /Resistant: Ampicillin/);
    assert.ok(!/Colistin/.test(fin.body.text), "unreported (selectively suppressed) result is not on the report");
    assert.equal((await call(t, "PUT", `/microbiology/cases/${c.body.id}`, { token: T().TECHNOLOGIST, body: { comment: "x" } })).body.code, "CASE_FINAL");
    // validation chain still applies: tech then medical, then sign + release
    const rid = fin.body.resultId;
    const r = (await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST })).body.find((x: any) => x.id === rid);
    assert.equal(r.flag, "ABNORMAL");
    assert.equal(r.source, "STRUCTURED");
    assert.equal((await call(t, "POST", `/results/${rid}/tech-validate`, { token: T().TECHNOLOGIST, body: {} })).status, 201, "no dual control for structured results");
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: T().AUTHORIZED_SIGNATORY })).body[0].ok, true);
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/reports`, { token: T().AUTHORIZED_SIGNATORY })).status, 201);

    // positive blood culture => critical alert (acknowledgement + escalation like any critical value)
    const fb = await makeOrder(t, lab, ["BCULT"], { patient: { ...PATIENT, fullName: "Blood Pt", phone: "+201000000702" } });
    await toProcessing(t, lab, fb);
    const bc = await call(t, "POST", "/microbiology/cases", { token: T().TECHNOLOGIST, body: { orderItemId: fb.order.items[0].id, site: "Blood" } });
    const saure = org.find((o: any) => o.code === "SAURE");
    const iso2 = await call(t, "POST", `/microbiology/cases/${bc.body.id}/isolates`, { token: T().TECHNOLOGIST, body: { organismId: saure.id } });
    await call(t, "PUT", `/microbiology/cases/${bc.body.id}/isolates/${iso2.body.isolates[0].id}/susceptibilities`, { token: T().TECHNOLOGIST, body: { rows: [{ antibioticId: ab("VAN"), interpretation: "S" }] } });
    assert.equal((await call(t, "POST", `/microbiology/cases/${bc.body.id}/finalize`, { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench } })).status, 201);
    const alerts = await call(t, "GET", "/critical-alerts", { token: T().LAB_DIRECTOR });
    assert.ok(alerts.body.some((a: any) => a.orderId === fb.orderId));
    // no-growth path
    const f0 = await makeOrder(t, lab, ["UCULT"], { patient: { ...PATIENT, fullName: "Clean Pt", phone: "+201000000703" } });
    await toProcessing(t, lab, f0);
    const c0 = await call(t, "POST", "/microbiology/cases", { token: T().TECHNOLOGIST, body: { orderItemId: f0.order.items[0].id, site: "Urine" } });
    await call(t, "PUT", `/microbiology/cases/${c0.body.id}`, { token: T().TECHNOLOGIST, body: { status: "INCUBATING", growth: false } });
    const fin0 = await call(t, "POST", `/microbiology/cases/${c0.body.id}/finalize`, { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench } });
    assert.match(fin0.body.text, /^No growth/);
    assert.equal((await call(t, "GET", "/microbiology/cases?status=FINAL", { token: T().TECHNOLOGIST })).body.length, 3);
    assert.equal((await call(t, "POST", "/microbiology/cases", { token: T().TECHNOLOGIST, body: { orderItemId: (await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "NotMicro", phone: "+201000000704" } })).order.items[0].id } })).body.code, "NOT_A_MICROBIOLOGY_TEST");
  });

  it("histopathology: grossing -> processing -> reporting -> pathologist sign-out (structured, QC-covered), addenda append-only", async () => {
    const histo = await mkAnalyte({ code: "HISTD", nameEn: "Histology diagnosis", valueType: "TEXT" });
    await mkTest("HISTO", ["HISTD"], { nameEn: "Histopathology", specimenType: "Tissue", container: "Formalin pot", section: "HISTOPATHOLOGY", price: 400 });
    await qcFor(histo.id, 10, 1);
    const f = await makeOrder(t, lab, ["HISTO"], { patient: { ...PATIENT, fullName: "Histo Pt", phone: "+201000000801" }, clinicalInfo: "colonic polyp", icdCodes: ["C80"] });
    await toProcessing(t, lab, f);
    const item = f.order.items[0];
    const c = await call(t, "POST", "/histopathology/cases", { token: T().AUTHORIZED_SIGNATORY, body: { orderItemId: item.id, site: "Sigmoid colon" } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.clinicalHistory, "colonic polyp", "defaults from the order's clinical info");
    assert.equal((await call(t, "POST", "/histopathology/cases", { token: T().RECEPTION, body: { orderItemId: item.id } })).status, 403);
    assert.equal((await call(t, "POST", `/histopathology/cases/${c.body.id}/advance`, { token: T().AUTHORIZED_SIGNATORY })).body.status, "GROSSING");
    assert.equal((await call(t, "POST", `/histopathology/cases/${c.body.id}/advance`, { token: T().AUTHORIZED_SIGNATORY })).body.code, "GROSS_DESCRIPTION_REQUIRED");
    await call(t, "PUT", `/histopathology/cases/${c.body.id}`, { token: T().AUTHORIZED_SIGNATORY, body: { grossDescription: "5 mm sessile polyp", blocks: 2, slides: 4 } });
    await call(t, "POST", `/histopathology/cases/${c.body.id}/advance`, { token: T().AUTHORIZED_SIGNATORY });
    await call(t, "POST", `/histopathology/cases/${c.body.id}/advance`, { token: T().AUTHORIZED_SIGNATORY });
    assert.equal((await call(t, "POST", `/histopathology/cases/${c.body.id}/sign-out`, { token: T().AUTHORIZED_SIGNATORY, body: { instrumentId: lab.instruments.bench } })).body.code, "DIAGNOSIS_REQUIRED");
    await call(t, "PUT", `/histopathology/cases/${c.body.id}`, { token: T().AUTHORIZED_SIGNATORY, body: { diagnosis: "Tubular adenoma, low-grade dysplasia", microscopicDescription: "Tubular glands", morphologyCode: "8211/0", synoptic: { margins: "Clear" } } });
    assert.equal((await call(t, "POST", `/histopathology/cases/${c.body.id}/sign-out`, { token: T().TECHNOLOGIST, body: { instrumentId: lab.instruments.bench } })).status, 403);
    const so = await call(t, "POST", `/histopathology/cases/${c.body.id}/sign-out`, { token: T().AUTHORIZED_SIGNATORY, body: { instrumentId: lab.instruments.bench } });
    assert.equal(so.status, 201, JSON.stringify(so.body));
    assert.match(so.body.text, /^DIAGNOSIS: Tubular adenoma, low-grade dysplasia \[8211\/0\]/);
    const res = (await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST })).body.find((r: any) => r.id === so.body.resultId);
    assert.equal(res.status, "MEDICAL_VALIDATED");
    assert.equal((await call(t, "PUT", `/histopathology/cases/${c.body.id}`, { token: T().AUTHORIZED_SIGNATORY, body: { diagnosis: "changed" } })).body.code, "CASE_SIGNED");
    const ad = await call(t, "POST", `/histopathology/cases/${c.body.id}/addenda`, { token: T().AUTHORIZED_SIGNATORY, body: { text: "Immunostain MLH1 retained." } });
    assert.equal(ad.body.addenda.length, 1);
    const signed = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: T().AUTHORIZED_SIGNATORY });
    assert.equal(signed.status, 201, JSON.stringify(signed.body));
  });

  it("amendments: corrected reports keep versions; the timeline shows old -> new values and reasons", async () => {
    const f = await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "Amend Pt", phone: "+201000000901" } });
    const rel = await releaseOrder(t, lab, f, { values: { GLU: 85 } });
    const res = (await call(t, "GET", `/orders/${f.orderId}/results`, { token: T().TECHNOLOGIST })).body.find((r: any) => r.status === "RELEASED");
    const cor = await call(t, "POST", `/results/${res.id}/correct`, { token: T().TECHNOLOGIST, body: { value: 95, reason: "transcription error" } });
    assert.equal(cor.status, 201, JSON.stringify(cor.body));
    await dual(cor.body.id, 95);
    await call(t, "POST", `/results/${cor.body.id}/tech-validate`, { token: T().TECHNOLOGIST, body: {} });
    await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: T().AUTHORIZED_SIGNATORY });
    // release queue: an amended order that needs a NEW version is offered for signing (not hidden), and is not "ready to release" yet
    const q1 = (await call(t, "GET", "/release-queue", { token: T().AUTHORIZED_SIGNATORY })).body;
    assert.ok(q1.readyToSign.some((o: any) => o.orderId === f.orderId), "amended order needs signing");
    assert.ok(!q1.readyToRelease.some((o: any) => o.orderId === f.orderId));
    const v2 = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: T().AUTHORIZED_SIGNATORY });
    assert.equal(v2.status, 201, JSON.stringify(v2.body));
    assert.equal(v2.body.version, 2);
    // signed but not yet released: moves to readyToRelease and leaves readyToSign (a second sign would 409 NO_CHANGES_TO_REPORT)
    const q2 = (await call(t, "GET", "/release-queue", { token: T().AUTHORIZED_SIGNATORY })).body;
    assert.ok(!q2.readyToSign.some((o: any) => o.orderId === f.orderId), "signed order must not be offered for signing again");
    assert.ok(q2.readyToRelease.some((o: any) => o.orderId === f.orderId), "signed order is ready to release");
    assert.ok(q2.signedNotReleased.some((r: any) => r.reportId === v2.body.id));
    const again = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: T().AUTHORIZED_SIGNATORY });
    assert.equal(again.status, 409); assert.equal(again.body.code, "NO_CHANGES_TO_REPORT");
    const am = await call(t, "GET", `/orders/${f.orderId}/amendments`, { token: T().TECHNOLOGIST });
    assert.equal(am.body.versions.length, 2);
    assert.equal(am.body.versions[1].correctionReason !== null, true);
    assert.equal(am.body.corrections.length, 1);
    assert.deepEqual([am.body.corrections[0].from.value, am.body.corrections[0].to.value, am.body.corrections[0].reason], [85, 95, "transcription error"]);
    assert.equal(am.body.corrections[0].from.releasedReportVersionId, rel.reportId);
  });
});
