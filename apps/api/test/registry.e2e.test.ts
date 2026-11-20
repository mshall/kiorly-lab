import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, PATIENT, bootApp, call, makeLab, makeOrder, releaseOrder } from "./helpers/app";

describe("M1 registry: patients (standalone), history/trends, merge, consent, referrers, commissions, doctor portal", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => { t = await bootApp(); lab = await makeLab(t, { vat: 14 }); });
  after(async () => t.close());

  it("creates patients with an MRN, extended demographics, search by MRN/email and update with audit", async () => {
    const r = await call(t, "POST", "/patients", { token: lab.tokens.RECEPTION, body: { fullName: "Salma Hassan", dateOfBirth: "1985-03-02", sex: "F", phone: "+201001234567", nationalId: "28503020100123", email: "salma@example.test", city: "Cairo", bloodGroup: "O+", conditions: ["PREGNANT_T1"] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.mrn, /^MRN-\d{6}$/);
    assert.equal(r.body.nationalIdHash, undefined, "hash never leaves the API");
    const s1 = await call(t, "GET", `/patient-registry?search=${r.body.mrn}`, { token: lab.tokens.RECEPTION });
    assert.equal(s1.body.length, 1);
    const s2 = await call(t, "GET", "/patient-registry?search=salma@example", { token: lab.tokens.RECEPTION });
    assert.equal(s2.body.length, 1);
    const up = await call(t, "PUT", `/patients/${r.body.id}`, { token: lab.tokens.RECEPTION, body: { address: "12 Nile St", notes: "prefers morning" } });
    assert.equal(up.status, 200);
    assert.equal(up.body.address, "12 Nile St");
    assert.equal((await call(t, "PUT", `/patients/${r.body.id}`, { token: lab.tokens.PHLEBOTOMIST, body: { notes: "x" } })).status, 403);
    const audit = await t.prisma.auditLog.findFirst({ where: { orgId: lab.orgId, action: "patient.update", entityId: r.body.id } });
    assert.ok(audit);
    assert.ok(!JSON.stringify(audit.meta).includes("12 Nile"), "no PHI in audit");
    // same national id is the same person (no second registry row)
    const again = await call(t, "POST", "/patients", { token: lab.tokens.RECEPTION, body: { fullName: "Salma H.", nationalId: "28503020100123" } });
    assert.equal(again.body.id, r.body.id);
  });

  it("history + cumulative trend per analyte across visits, with delta", async () => {
    const vals = [{ GLU: 85 }, { GLU: 99 }, { GLU: 140 }];
    let patientId = "";
    for (const v of vals) {
      const f = await makeOrder(t, lab, ["GLU"]);
      patientId = f.order.patient.id;
      await releaseOrder(t, lab, f, { values: v });
    }
    const trends = await call(t, "GET", `/patients/${patientId}/trends`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(trends.status, 200);
    const glu = trends.body.find((g: any) => g.analyte.code === "GLU");
    assert.deepEqual(glu.points.map((p: any) => p.value), [85, 99, 140]);
    assert.equal(glu.stats.min, 85);
    assert.equal(glu.stats.max, 140);
    assert.equal(glu.stats.deltaPercent, 41.4);
    assert.equal(glu.points.at(-1).flag, "HIGH");
    const hist = await call(t, "GET", `/patients/${patientId}/history?analyteId=${lab.analytes.GLU}`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(hist.body[0].points.length, 3);
    const prof = await call(t, "GET", `/patients/${patientId}/profile`, { token: lab.tokens.RECEPTION });
    assert.equal(prof.body.stats.orders, 3);
    assert.equal(prof.body.stats.results, 3);
    assert.equal((await call(t, "GET", `/patients/${patientId}/trends`, { token: lab.tokens.FINANCE })).status, 403, "finance has no clinical result access");
  });

  it("detects duplicates and merges them: orders move, history is unified, source is hidden, audit kept", async () => {
    const a = (await call(t, "POST", "/patients", { token: lab.tokens.RECEPTION, body: { fullName: "Omar Dup", dateOfBirth: "1970-01-01", phone: "+201111111111" } })).body;
    const b = (await call(t, "POST", "/patients", { token: lab.tokens.RECEPTION, body: { fullName: "omar  dup", dateOfBirth: "1970-01-01", sex: "M", phone: "+201222222222" } })).body;
    assert.notEqual(a.id, b.id);
    await makeOrder(t, lab, ["GLU"], { patientId: b.id, patient: undefined });
    const d = await call(t, "GET", "/patient-registry/duplicates", { token: lab.tokens.SUPERVISOR });
    assert.ok(d.body.some((g: any) => g.members.some((m: any) => m.id === a.id) && g.members.some((m: any) => m.id === b.id) && g.reasons.includes("NAME_DOB")));
    assert.equal((await call(t, "GET", "/patient-registry/duplicates", { token: lab.tokens.RECEPTION })).status, 403);
    assert.equal((await call(t, "POST", `/patients/${b.id}/merge`, { token: lab.tokens.RECEPTION, body: { targetId: a.id } })).status, 403);
    assert.equal((await call(t, "POST", `/patients/${b.id}/merge`, { token: lab.tokens.SUPERVISOR, body: { targetId: b.id } })).status, 400);
    const m = await call(t, "POST", `/patients/${b.id}/merge`, { token: lab.tokens.SUPERVISOR, body: { targetId: a.id } });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    assert.equal(m.body.ordersMoved, 1);
    const prof = await call(t, "GET", `/patients/${a.id}/profile`, { token: lab.tokens.RECEPTION });
    assert.equal(prof.body.orders.length, 1);
    assert.equal(prof.body.patient.sex, "M", "unknown sex filled from the merged record");
    const list = await call(t, "GET", "/patient-registry?search=Omar", { token: lab.tokens.RECEPTION });
    assert.deepEqual(list.body.map((p: any) => p.id), [a.id]);
    assert.equal((await call(t, "POST", `/patients/${b.id}/merge`, { token: lab.tokens.SUPERVISOR, body: { targetId: a.id } })).status, 409);
  });

  it("consent history is append-only and the current state is the latest per kind", async () => {
    const p = (await call(t, "POST", "/patients", { token: lab.tokens.RECEPTION, body: { fullName: "Consent Case" } })).body;
    await call(t, "POST", `/patients/${p.id}/consents`, { token: lab.tokens.RECEPTION, body: { kind: "RESULT_SHARING", granted: true, version: "v1" } });
    await call(t, "POST", `/patients/${p.id}/consents`, { token: lab.tokens.RECEPTION, body: { kind: "MARKETING", granted: false } });
    await call(t, "POST", `/patients/${p.id}/consents`, { token: lab.tokens.RECEPTION, body: { kind: "RESULT_SHARING", granted: false } });
    const c = await call(t, "GET", `/patients/${p.id}/consents`, { token: lab.tokens.RECEPTION });
    assert.equal(c.body.current.RESULT_SHARING.granted, false);
    assert.equal(c.body.current.MARKETING.granted, false);
    assert.equal(c.body.current.RESEARCH, null);
    assert.equal(c.body.history.length, 3);
  });

  it("referrers: directory, delivery prefs, commission accrual on invoice, reversal on void, payouts bounded by balance, credit limit", async () => {
    const ref = await call(t, "POST", "/referrers", { token: lab.tokens.BRANCH_MANAGER, body: { name: "Dr Hana Referrer", kind: "DOCTOR", specialty: "Endocrinology", phone: "+201000000333", deliveryChannels: ["WHATSAPP"], deliverOnRelease: true, commissionType: "PERCENT", commissionValue: 10, creditLimit: 500 } });
    assert.equal(ref.status, 201, JSON.stringify(ref.body));
    assert.equal((await call(t, "POST", "/referrers", { token: lab.tokens.PHLEBOTOMIST, body: { name: "Nope" } })).status, 403);
    const f = await makeOrder(t, lab, ["CBC", "GLU"], { referrerId: ref.body.id });
    assert.equal(f.order.referringDoctorName, "Dr Hana Referrer");
    const inv = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.FINANCE });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    let r = await call(t, "GET", `/referrers/${ref.body.id}`, { token: lab.tokens.FINANCE });
    assert.equal(r.body.balances.COMMISSION, 16, "10% of the 160 pre-VAT subtotal");
    const dup = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.FINANCE });
    assert.equal(dup.status, 409);
    assert.equal((await call(t, "POST", `/referrers/${ref.body.id}/payout`, { token: lab.tokens.FINANCE, body: { amount: 20 } })).status, 422);
    const pay = await call(t, "POST", `/referrers/${ref.body.id}/payout`, { token: lab.tokens.FINANCE, body: { amount: 6, memo: "June" } });
    assert.equal(pay.body.balance, 10);
    await call(t, "POST", `/invoices/${inv.body.id}/void`, { token: lab.tokens.FINANCE, body: { reason: "test" } });
    r = await call(t, "GET", `/referrers/${ref.body.id}`, { token: lab.tokens.FINANCE });
    assert.equal(r.body.balances.COMMISSION, -6, "reversal exceeds what was left: the lab is owed 6 back");
    const st = await call(t, "GET", "/referrers/statement", { token: lab.tokens.FINANCE });
    assert.equal(st.body.find((x: any) => x.referrerId === ref.body.id).paid, -6);
    // credit
    assert.equal((await call(t, "POST", `/referrers/${ref.body.id}/credit/charge`, { token: lab.tokens.FINANCE, body: { amount: 600 } })).status, 422);
    assert.equal((await call(t, "POST", `/referrers/${ref.body.id}/credit/charge`, { token: lab.tokens.FINANCE, body: { amount: 400, memo: "monthly" } })).body.balance, 400);
    assert.equal((await call(t, "POST", `/referrers/${ref.body.id}/credit/payment`, { token: lab.tokens.FINANCE, body: { amount: 150 } })).body.balance, 250);
    const noCredit = await call(t, "POST", "/referrers", { token: lab.tokens.BRANCH_MANAGER, body: { name: "No credit clinic", kind: "CLINIC" } });
    assert.equal((await call(t, "POST", `/referrers/${noCredit.body.id}/credit/charge`, { token: lab.tokens.FINANCE, body: { amount: 1 } })).body.code, "CREDIT_NOT_ENABLED");
  });

  it("doctor portal: token-gated, consent + released only, token revocable", async () => {
    const ref = (await call(t, "POST", "/referrers", { token: lab.tokens.BRANCH_MANAGER, body: { name: "Dr Portal" } })).body;
    const tok = await call(t, "POST", `/referrers/${ref.id}/portal-token`, { token: lab.tokens.BRANCH_MANAGER });
    const token = tok.body.token as string;
    const yes = await makeOrder(t, lab, ["GLU"], { referrerId: ref.id, consentChannels: ["PATIENT_LINK_OTP", "REFERRER_PORTAL"] });
    const no = await makeOrder(t, lab, ["GLU"], { referrerId: ref.id, patient: { ...PATIENT, fullName: "No Consent", phone: "+201000000555" } });
    await releaseOrder(t, lab, yes);
    let list = await call(t, "GET", `/public/portal/${token}/orders`);
    assert.equal(list.status, 200);
    const y = list.body.orders.find((o: any) => o.id === yes.orderId);
    assert.equal(y.consented, true);
    assert.ok(y.report);
    assert.equal(list.body.orders.find((o: any) => o.id === no.orderId).report, null);
    const pdf = await call(t, "GET", `/public/portal/${token}/orders/${yes.orderId}/report.pdf`);
    assert.equal(pdf.raw.subarray(0, 5).toString(), "%PDF-");
    assert.equal((await call(t, "GET", `/public/portal/${token}/orders/${no.orderId}/report.pdf`)).status, 409);
    assert.equal((await call(t, "GET", `/public/portal/bogus/orders`)).status, 404);
    await call(t, "DELETE", `/referrers/${ref.id}/portal-token`, { token: lab.tokens.BRANCH_MANAGER });
    assert.equal((await call(t, "GET", `/public/portal/${token}/orders`)).status, 404);
  });
});
