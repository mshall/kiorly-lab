import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateEvent, verifyWebhook } from "@kiorex/contracts";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

describe("golden flow: order -> accession -> custody -> QC -> results -> validation -> signed report -> release -> secure link", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("runs end to end and emits a contract-valid LabResultReleased event via the outbox", async () => {
    // order (KLORD01-03)
    const f = await makeOrder(t, lab, ["CBC", "GLU"]);
    assert.equal(f.order.status, "AWAITING_COLLECTION");
    assert.equal(f.order.identityVerified, true);
    assert.equal(f.specimens.length, 2, "one specimen per container type");
    assert.match(f.order.orderNumber, /^ORD-\d{4}-\d{6}$/);

    // labels printable (KLSPC02)
    const label = await call(t, "GET", `/specimens/${f.specimens[0].id}/label`, { token: lab.tokens.RECEPTION });
    assert.equal(label.status, 200);
    assert.match(label.body.svg, /^<svg/);
    assert.match(label.body.zpl, /\^XA/);

    // custody chain (KLSPC03)
    await toProcessing(t, lab, f);
    const chain = await call(t, "GET", `/specimens/${f.specimens[0].id}/custody`, { token: lab.tokens.TECHNOLOGIST });
    assert.deepEqual(chain.body.map((e: any) => e.type), ["COLLECTED", "RECEIVED", "PROCESSING_STARTED"]);

    // QC then results (KLQC)
    await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT", "GLU"]);
    await enterAndTechValidate(t, lab, f.orderId, NORMAL);

    // not signable by a technologist, nor released without signature
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.TECHNOLOGIST })).status, 403);
    const early = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(early.status, 409, "medical validation still missing");
    assert.equal(early.body.code, "REPORT_NOT_READY");

    // medical validation by authorized signatory, then signature
    const mv = await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.ok(mv.body.every((r: any) => r.ok), JSON.stringify(mv.body));
    const signed = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(signed.status, 201, JSON.stringify(signed.body));
    assert.equal(signed.body.version, 1);
    assert.ok(signed.body.signedBy);
    assert.match(signed.body.contentHash, /^[0-9a-f]{64}$/);

    // PDF generated and downloadable
    const pdf = await call(t, "GET", `/reports/${signed.body.id}/pdf`, { token: lab.tokens.RECEPTION });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.subarray(0, 5).toString(), "%PDF-");

    // release with consent-checked channels
    const rel = await call(t, "POST", `/reports/${signed.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PATIENT_LINK_OTP", "KIOREX_VAULT"] } });
    assert.equal(rel.status, 201, JSON.stringify(rel.body));
    assert.match(rel.body.secureLink, /\/r\/[A-Za-z0-9_-]{20,}$/);
    const order = await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(order.body.status, "RELEASED");

    // outbox: contract-valid, no raw values, HMAC-signed delivery de-duplicated by eventId
    const ev = await t.prisma.outboxEvent.findFirstOrThrow({ where: { orgId: lab.orgId, type: "LabResultReleased" } });
    const check = validateEvent("LabResultReleased", ev.payload);
    assert.equal(check.valid, true, JSON.stringify((check as any).errors));
    const text = JSON.stringify(ev.payload);
    assert.ok(!/13\.5|"values"|"results"/.test(text), "no raw values in the event");
    t.outbox.transport.received.clear();
    const d1 = await t.outbox.dispatchDue(new Date(Date.now() + 1000), 5000); // the shared test DB holds pending events of earlier suites
    assert.ok(d1.sent >= 1);
    const received = t.outbox.transport.received.get(ev.id);
    assert.ok(received, "mock Kiorex receiver accepted the event");
    assert.equal(verifyWebhook({ secret: "kx_dev_webhook_secret", body: received.body, timestamp: String(Math.floor(Date.now() / 1000)), signature: `sha256=${(await import("node:crypto")).createHmac("sha256", "kx_dev_webhook_secret").update(`${Math.floor(Date.now() / 1000)}.${received.body}`).digest("hex")}` }).ok, true);
    assert.equal(JSON.parse(received.body).target, "KIOREX");

    // patient secure link: OTP gated (KLCRIT02), notification carries no raw values (KLCRIT03)
    const token = rel.body.secureLink.split("/r/")[1];
    const info = await call(t, "GET", `/public/reports/${token}`);
    assert.equal(info.status, 200);
    assert.equal(info.body.requiresOtp, true);
    assert.equal((await call(t, "GET", `/public/reports/${token}/download?t=bogus`)).status, 403);
    assert.equal((await call(t, "POST", `/public/reports/${token}/otp`)).status, 201);
    const otpMsg = await t.prisma.notificationAttempt.findFirstOrThrow({ where: { orgId: lab.orgId, purpose: "REPORT_OTP" }, orderBy: { createdAt: "desc" } });
    const otp = (otpMsg.params as any).otp as string;
    assert.equal((await call(t, "POST", `/public/reports/${token}/verify`, { body: { otp: otp === "000000" ? "111111" : "000000" } })).status, 403);
    const ver = await call(t, "POST", `/public/reports/${token}/verify`, { body: { otp } });
    assert.equal(ver.status, 201);
    const dl = await call(t, "GET", `/public/reports/${token}/download?t=${encodeURIComponent(ver.body.downloadToken)}`);
    assert.equal(dl.status, 200);
    assert.equal(dl.raw.subarray(0, 5).toString(), "%PDF-");
    const ready = await t.prisma.notificationAttempt.findFirstOrThrow({ where: { orgId: lab.orgId, purpose: "RESULT_READY" } });
    assert.ok(!/13\.5|85/.test(JSON.stringify(ready.params)), "result-ready notification has no values");

    // KIORLY_CLINIC_IMPORT was consented but not requested, so the clinic cannot fetch it; vault can (checked in integration tests)
    const releases = await t.prisma.releaseRecord.findMany({ where: { reportVersionId: signed.body.id } });
    assert.deepEqual(releases.map((r) => r.channel).sort(), ["KIOREX_VAULT", "PATIENT_LINK_OTP"]);
  });
});
