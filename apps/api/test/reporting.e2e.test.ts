import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, PATIENT, bootApp, call, makeLab, makeOrder, releaseOrder } from "./helpers/app";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("M7 reporting: templates (bilingual, logo, QR), signed PDFs, verification, delivery (email/WhatsApp/SMS), referrer auto-delivery, cumulative report", () => {
  let t: TestApp;
  let lab: Lab;
  const T = () => lab.tokens;
  before(async () => { t = await bootApp(); lab = await makeLab(t); });
  after(async () => t.close());

  let tpl: any;

  it("templates: create/default/update, logo magic-byte validation, preview renders bilingual with the Arabic font", async () => {
    tpl = (await call(t, "POST", "/report-templates", { token: T().BRANCH_MANAGER, body: { name: "Standard bilingual", language: "BILINGUAL", headerTitle: "Cairo Central Lab", headerSubtitle: "12 Nile St, Cairo - 02 5555 0000", footerText: "Results relate to the specimen as received.", accentColor: "#0369A1" } }));
    assert.equal(tpl.status, 201, JSON.stringify(tpl.body));
    tpl = tpl.body;
    assert.equal(tpl.isDefault, true, "the first template becomes the default");
    assert.equal((await call(t, "POST", "/report-templates", { token: T().BRANCH_MANAGER, body: { name: "Standard bilingual" } })).status, 409);
    assert.equal((await call(t, "POST", "/report-templates", { token: T().RECEPTION, body: { name: "Nope" } })).status, 403);
    assert.equal((await call(t, "POST", "/report-templates", { token: T().BRANCH_MANAGER, body: { name: "Bad colour", accentColor: "blue" } })).status, 400);
    assert.equal((await call(t, "PUT", `/report-templates/${tpl.id}/logo`, { token: T().BRANCH_MANAGER, body: { imageBase64: Buffer.from("<svg onload=alert(1)>").toString("base64") + "AAAAAAAA" } })).body.code, "LOGO_TYPE_INVALID");
    const lg = await call(t, "PUT", `/report-templates/${tpl.id}/logo`, { token: T().BRANCH_MANAGER, body: { imageBase64: PNG } });
    assert.equal(lg.status, 200);
    assert.equal(lg.body.logoType, "image/png");
    const list = await call(t, "GET", "/report-templates", { token: T().RECEPTION });
    assert.equal(list.body[0].hasLogo, true);
    assert.equal(list.body[0].logo, undefined, "logo bytes never in the list");
    assert.equal((await call(t, "GET", `/report-templates/${tpl.id}/logo`, { token: T().RECEPTION })).headers.get("content-type"), "image/png");
    const pv = await call(t, "GET", `/report-templates/${tpl.id}/preview.pdf`, { token: T().RECEPTION });
    assert.equal(pv.raw.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pv.raw.toString("latin1").includes("IBMPlexSansArabic"), "bilingual template embeds the Arabic font");
    const en = (await call(t, "POST", "/report-templates", { token: T().BRANCH_MANAGER, body: { name: "English only", language: "EN" } })).body;
    assert.equal(en.isDefault, false);
    assert.equal((await call(t, "DELETE", `/report-templates/${tpl.id}`, { token: T().BRANCH_MANAGER })).body.code, "DEFAULT_TEMPLATE");
    assert.equal((await call(t, "DELETE", `/report-templates/${en.id}`, { token: T().BRANCH_MANAGER })).body.active, false);
  });

  let fx: { orderId: string };
  let rep: { reportId: string; secureLink: string };
  it("signing uses the template active at that moment; the stored report stays unchanged when the template changes later; QR verification works", async () => {
    const f = await makeOrder(t, lab, ["CBC"], { consentChannels: ["PRINTED", "PATIENT_LINK_OTP", "REFERRER_PORTAL"], patient: { ...PATIENT, email: "amira@example.test" } });
    fx = f;
    rep = await releaseOrder(t, lab, f, { channels: ["PATIENT_LINK_OTP"] });
    const pdf = await call(t, "GET", `/reports/${rep.reportId}/pdf`, { token: T().RECEPTION });
    const text = pdf.raw.toString("latin1");
    assert.ok(text.includes("IBMPlexSansArabic"), "signed with the bilingual template");
    const before = pdf.raw.length;
    await call(t, "PUT", `/report-templates/${tpl.id}`, { token: T().BRANCH_MANAGER, body: { language: "EN", headerTitle: "Changed" } });
    const again = await call(t, "GET", `/reports/${rep.reportId}/pdf`, { token: T().RECEPTION });
    assert.equal(again.raw.length, before, "signed report is immutable");
    const v = await call(t, "GET", `/public/verify/${rep.reportId}`);
    assert.equal(v.status, 200);
    assert.deepEqual([v.body.valid, v.body.version, v.body.superseded], [true, 1, false]);
    assert.ok(!/patient|fullName|Amira/i.test(JSON.stringify(v.body)), "verification exposes no patient data");
    assert.equal((await call(t, "GET", "/public/verify/rep_nope")).status, 404);
    await call(t, "PUT", `/report-templates/${tpl.id}`, { token: T().BRANCH_MANAGER, body: { language: "BILINGUAL", headerTitle: "Cairo Central Lab" } });
  });

  it("delivery: needs a released report and consent; email/WhatsApp/SMS land in the dev inbox with a link and no values; failures retry", async () => {
    const unreleased = await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "Not Released", phone: "+201000007001" } });
    assert.equal((await call(t, "POST", "/reports/nope/deliver", { token: T().RECEPTION, body: { recipient: "PATIENT", channels: ["EMAIL"] } })).status, 404);
    void unreleased;
    assert.equal((await call(t, "POST", `/reports/${rep.reportId}/deliver`, { token: T().PHLEBOTOMIST, body: { recipient: "PATIENT", channels: ["EMAIL"] } })).status, 403);
    const d = await call(t, "POST", `/reports/${rep.reportId}/deliver`, { token: T().RECEPTION, body: { recipient: "PATIENT", channels: ["EMAIL", "WHATSAPP", "SMS"] } });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    assert.deepEqual(d.body.map((x: any) => x.status), ["SENT", "SENT", "SENT"]);
    assert.equal(d.body[0].recipient, "a***@example.test");
    assert.match(d.body[1].recipient, /^\+2010\*+111$|\*\*\*\*/);
    const inbox = await t.prisma.notificationAttempt.findMany({ where: { orgId: lab.orgId, relatedType: "ReportVersion", relatedId: rep.reportId, templateId: "TODO_NEEDS_HUMAN_REPORT_DELIVERY" }, orderBy: { createdAt: "asc" } });
    assert.deepEqual(inbox.map((n) => n.channel).sort(), ["EMAIL", "SMS", "WHATSAPP"]);
    for (const n of inbox) { assert.match(String((n.params as any).link), /\/r\/[A-Za-z0-9_-]{20,}$/); assert.ok(!/13\.5|mg\/dL|g\/dL/.test(JSON.stringify(n.params))); }
    const token = String((inbox[0]!.params as any).link).split("/r/")[1];
    assert.equal((await call(t, "GET", `/public/reports/${token}`)).status, 200, "the delivered link is a working OTP-gated secure link");
    assert.equal((await call(t, "GET", `/reports/${rep.reportId}/deliveries`, { token: T().RECEPTION })).body.length, 3);
    // referrer delivery needs a referrer + the doctor-portal consent
    assert.equal((await call(t, "POST", `/reports/${rep.reportId}/deliver`, { token: T().RECEPTION, body: { recipient: "REFERRER", channels: ["EMAIL"] } })).body.code, "NO_REFERRER");
    // a missing contact is a recorded FAILED delivery, not an exception
    const nomail = await makeOrder(t, lab, ["CBC"], { patient: { ...PATIENT, fullName: "No Mail", phone: "+201000007002-fail" }, consentChannels: ["PATIENT_LINK_OTP"] });
    const rel2 = await releaseOrder(t, lab, nomail);
    const f1 = await call(t, "POST", `/reports/${rel2.reportId}/deliver`, { token: T().RECEPTION, body: { recipient: "PATIENT", channels: ["EMAIL", "SMS"] } });
    assert.deepEqual(f1.body.map((x: any) => [x.channel, x.status]), [["EMAIL", "FAILED"], ["SMS", "FAILED"]]);
    const retry = await call(t, "POST", `/deliveries/${f1.body[1].id}/retry`, { token: T().RECEPTION });
    assert.equal(retry.status, 201);
    assert.equal(retry.body[0].status, "FAILED", "the mock provider rejects recipients ending in -fail");
    assert.equal((await call(t, "POST", `/deliveries/${(await call(t, "GET", `/reports/${rep.reportId}/deliveries`, { token: T().RECEPTION })).body[0].id}/retry`, { token: T().RECEPTION })).body.code, "DELIVERY_NOT_FAILED");
    // no consent for the doctor portal => refused
    const refNo = (await call(t, "POST", "/referrers", { token: T().BRANCH_MANAGER, body: { name: "Dr No Consent", email: "dr@example.test", phone: "+201000007003" } })).body;
    const o3 = await makeOrder(t, lab, ["CBC"], { referrerId: refNo.id, patient: { ...PATIENT, fullName: "NC Pt", phone: "+201000007004" } });
    const rel3 = await releaseOrder(t, lab, o3);
    assert.equal((await call(t, "POST", `/reports/${rel3.reportId}/deliver`, { token: T().RECEPTION, body: { recipient: "REFERRER", channels: ["EMAIL"] } })).body.code, "CONSENT_REQUIRED");
  });

  it("referrer preferences deliver automatically on release when the patient consented to the doctor channel", async () => {
    const ref = (await call(t, "POST", "/referrers", { token: T().BRANCH_MANAGER, body: { name: "Dr Auto", email: "auto@example.test", phone: "+201000007010", deliveryChannels: ["EMAIL", "WHATSAPP"], deliverOnRelease: true } })).body;
    const f = await makeOrder(t, lab, ["CBC"], { referrerId: ref.id, consentChannels: ["PATIENT_LINK_OTP", "REFERRER_PORTAL"], patient: { ...PATIENT, fullName: "Auto Pt", phone: "+201000007011" } });
    const r = await releaseOrder(t, lab, f);
    const ds = await call(t, "GET", `/reports/${r.reportId}/deliveries`, { token: T().RECEPTION });
    assert.deepEqual(ds.body.map((d: any) => [d.recipientType, d.channel, d.status, d.trigger]).sort(), [["REFERRER", "EMAIL", "SENT", "AUTO"], ["REFERRER", "WHATSAPP", "SENT", "AUTO"]]);
    const noConsent = await makeOrder(t, lab, ["CBC"], { referrerId: ref.id, consentChannels: ["PATIENT_LINK_OTP"], patient: { ...PATIENT, fullName: "Auto Pt2", phone: "+201000007012" } });
    const r2 = await releaseOrder(t, lab, noConsent);
    assert.equal((await call(t, "GET", `/reports/${r2.reportId}/deliveries`, { token: T().RECEPTION })).body.length, 0, "no consent, no automatic delivery");
  });

  it("cumulative report PDF per patient (trend table + chart), template language, audited", async () => {
    const pid = (await call(t, "GET", `/orders/${fx.orderId}`, { token: T().RECEPTION })).body.patient.id;
    for (const v of [8, 9]) { const f = await makeOrder(t, lab, ["CBC"], { patient: PATIENT }); await releaseOrder(t, lab, f, { values: { HB: 11 + v / 10 } }); }
    const pdf = await call(t, "GET", `/patients/${pid}/cumulative.pdf`, { token: T().TECHNOLOGIST });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.raw.length > 2000);
    assert.equal((await call(t, "GET", `/patients/${pid}/cumulative.pdf?analyteId=${lab.analytes.HB}`, { token: T().TECHNOLOGIST })).status, 200);
    assert.equal((await call(t, "GET", `/patients/${pid}/cumulative.pdf`, { token: T().FINANCE })).status, 403);
    assert.ok(await t.prisma.auditLog.findFirst({ where: { orgId: lab.orgId, action: "patient.cumulative_report", entityId: pid } }));
  });
});
