import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab, makeOrder } from "./helpers/app";
import { startFakeProvider } from "../src/providers/fake-provider-server";
import { MOCK_WEBHOOK_SECRET } from "../src/providers/provider-env";
import { signWebhook } from "../src/providers/webhook-signature";
import { MessagingAdapter } from "../src/adapters/messaging.adapter";

const RUN = Date.now().toString(36); // event ids are deduped in the (persistent) test DB: unique per run
const evt = (id: string, type: string, ref: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id: `${id}_${RUN}`, type, createdAt: new Date().toISOString(), data: { id: ref, ...extra } });
const hook = (t: TestApp, kind: string, body: string, secret: string | null = MOCK_WEBHOOK_SECRET, sig?: string) =>
  call(t, "POST", `/webhooks/providers/${kind}`, { rawBody: body, headers: { "content-type": "application/json", ...(secret || sig ? { "x-kiorex-signature": sig ?? signWebhook(secret!, body) } : {}) } });
async function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; process.env[k] = env[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
}

describe("provider go-live wiring: messaging + pay-by-link (mock end to end, real against a local fake provider)", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => { t = await bootApp(); lab = await makeLab(t, { vat: 14 }); });
  after(async () => t.close());

  async function invoice() {
    const f = await makeOrder(t, lab, ["CBC", "GLU"]);
    const inv = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.RECEPTION });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    return inv.body as { id: string; total: number; number: string };
  }

  it("mock: demo runner sends every flow, delivers receipts through the signed webhook path and exercises pay-by-link success, refund and failure", async () => {
    await invoice();
    const run = await call(t, "POST", "/dev/providers/demo/run", { token: lab.tokens.OWNER, body: {} });
    assert.equal(run.status, 201, JSON.stringify(run.body));
    assert.deepEqual(run.body.messages.map((m: any) => m.flow), ["result-ready (WhatsApp)", "result-ready (email)", "critical alert (SMS)", "invoice email"]);
    for (const m of run.body.messages) { assert.equal(m.status, "SENT"); assert.equal(m.receipt.applied, 1); }
    assert.ok(run.body.payments.success.payUrl.includes("/mock-pay/mocklink_"));
    assert.equal(run.body.payments.refund.pending, false);
    const rows = await call(t, "GET", "/dev/providers/messages?limit=20", { token: lab.tokens.OWNER });
    assert.equal(rows.status, 200);
    const delivered = rows.body.filter((r: any) => r.relatedType === "DemoFlow");
    assert.equal(delivered.length, 4);
    assert.ok(delivered.every((r: any) => r.status === "DELIVERED" && r.deliveredAt && r.rendered.text.length > 5));
    assert.match(delivered.find((r: any) => r.purpose === "CRITICAL_ALERT").rendered.text, /DEMO-0002/);
    const links = await call(t, "GET", "/dev/providers/pay-links", { token: lab.tokens.OWNER });
    assert.deepEqual(links.body.slice(0, 2).map((l: any) => l.status).sort(), ["FAILED", "REFUNDED"]);
    const after = await call(t, "GET", `/invoices/${links.body[0].invoiceId}`, { token: lab.tokens.RECEPTION });
    assert.equal(after.body.paidTotal, 0, "paid 1.00 then refunded 1.00");
    assert.ok(links.body.length >= 2);
  });

  it("public webhook: bad / missing / stale signatures are 401, valid applies once, replay is deduped, receipts never downgrade", async () => {
    const send = await t.app.get(MessagingAdapter).send({ orgId: lab.orgId, channel: "SMS", purpose: "CRITICAL_ALERT", recipientRef: "+201000000003", templateId: "TODO_NEEDS_HUMAN_CRITICAL_ALERT", params: { orderNumber: "O-1", locale: "en" } });
    const row = await t.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: send.id } });
    const ref = row.providerMessageId!;
    const body = evt("evt_a1", "message.delivered", ref);
    assert.equal((await hook(t, "sms", body, null)).status, 401);
    assert.equal((await hook(t, "sms", body, "wrong-secret")).status, 401);
    assert.equal((await hook(t, "sms", body, null, signWebhook(MOCK_WEBHOOK_SECRET, body, Math.floor(Date.now() / 1000) - 3600))).status, 401);
    assert.equal((await hook(t, "sms", body + " ", null, signWebhook(MOCK_WEBHOOK_SECRET, body))).status, 401, "body tampered after signing");
    assert.equal((await hook(t, "nope", body)).status, 404);
    const ok = await hook(t, "sms", body);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.applied, ok.body.duplicates], [1, 0]);
    assert.equal((await t.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: send.id } })).status, "DELIVERED");
    assert.equal((await hook(t, "sms", body)).body.duplicates, 1, "replayed event id");
    await hook(t, "sms", evt("evt_a2", "message.failed", ref, { error: "late failure" }));
    assert.equal((await t.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: send.id } })).status, "DELIVERED", "failed after delivered is ignored");
    assert.equal((await hook(t, "sms", JSON.stringify({ nonsense: true }))).status, 400);
    assert.equal((await hook(t, "sms", evt("evt_a3", "message.delivered", "unknown_ref"))).body.unmatched, 1);
  });

  it("pay-by-link lifecycle via the API: create, optional SMS, success books ONE payment, replay is a no-op, refund, failure path", async () => {
    const inv = await invoice();
    const k = `k-${Date.now()}`;
    const a = await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.RECEPTION, headers: { "idempotency-key": k }, body: { amount: 100, sendVia: { channel: "SMS" } } });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.link.status, "PENDING");
    assert.equal(a.body.notification.status, "SENT");
    const again = await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.RECEPTION, headers: { "idempotency-key": k }, body: { amount: 100 } });
    assert.equal(again.body.replayed, true);
    assert.equal(again.body.link.id, a.body.link.id);
    assert.equal((await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.PHLEBOTOMIST, body: {} })).status, 403);
    assert.equal((await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.RECEPTION, body: { amount: inv.total + 1 } })).status, 422);

    const ref = a.body.link.providerRef as string;
    const paid = evt("evt_p1", "payment.succeeded", ref, { amount: "100.00", currency: "EGP" });
    const r1 = await hook(t, "payment", paid);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    await hook(t, "payment", evt("evt_p2", "payment.succeeded", ref, { amount: "100.00" }));
    const after = await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION });
    assert.equal(after.body.paidTotal, 100);
    assert.equal(after.body.status, "PARTIALLY_PAID");
    assert.equal(after.body.payments.filter((p: any) => p.status === "SUCCEEDED").length, 1, "two success events book one payment");
    const link = (await call(t, "GET", `/invoices/${inv.id}/pay-links`, { token: lab.tokens.RECEPTION })).body[0];
    assert.equal(link.status, "PAID");
    assert.ok(link.paymentId);

    const rf = await call(t, "POST", `/pay-links/${link.id}/refund`, { token: lab.tokens.RECEPTION, body: { amount: 40, reason: "customer request" } });
    assert.equal(rf.status, 201, JSON.stringify(rf.body));
    assert.equal(rf.body.link.refundedAmount, 40);
    assert.equal(rf.body.link.status, "PAID");
    assert.equal((await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION })).body.paidTotal, 60);
    assert.equal((await call(t, "POST", `/pay-links/${link.id}/refund`, { token: lab.tokens.RECEPTION, body: { amount: 61 } })).status, 422);
    assert.equal((await call(t, "POST", `/pay-links/${link.id}/refund`, { token: lab.tokens.RECEPTION, body: {} })).body.link.status, "REFUNDED");

    const b = await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.RECEPTION, body: { amount: 50 } });
    await hook(t, "payment", evt("evt_f1", "payment.failed", b.body.link.providerRef, { error: "card_declined" }));
    const failed = (await call(t, "GET", `/invoices/${inv.id}/pay-links`, { token: lab.tokens.RECEPTION })).body.find((l: any) => l.id === b.body.link.id);
    assert.deepEqual([failed.status, failed.failureReason], ["FAILED", "card_declined"]);
    assert.equal((await call(t, "POST", `/pay-links/${failed.id}/refund`, { token: lab.tokens.RECEPTION, body: {} })).status, 409);
  });

  it("invoice and receipt emails go through the email provider with the rendered body", async () => {
    const inv = await invoice();
    const noEmail = await call(t, "POST", `/invoices/${inv.id}/send`, { token: lab.tokens.RECEPTION, body: { kind: "INVOICE" } });
    assert.equal(noEmail.status, 422, "test patient has no email on file");
    const sent = await call(t, "POST", `/invoices/${inv.id}/send`, { token: lab.tokens.RECEPTION, body: { kind: "INVOICE", channel: "EMAIL", to: "billing.demo@example.test" } });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const msgs = await call(t, "GET", "/dev/providers/messages?channel=EMAIL", { token: lab.tokens.OWNER });
    const m = msgs.body.find((x: any) => x.id === sent.body.id);
    assert.ok(m.rendered.subject.includes(inv.number), "rendered in the patient locale (default ar)");
    assert.equal((await call(t, "POST", `/invoices/${inv.id}/send`, { token: lab.tokens.RECEPTION, body: { kind: "RECEIPT", channel: "EMAIL", to: "a@b.test" } })).status, 409, "nothing paid yet");
  });

  it("dev tools are hidden when disabled (production behaviour) and the simulator refuses real mode", async () => {
    await withEnv({ PROVIDER_DEV_TOOLS: "false" }, async () => {
      assert.equal((await call(t, "GET", "/dev/providers/messages", { token: lab.tokens.OWNER })).status, 404);
      assert.equal((await call(t, "POST", "/dev/providers/demo/run", { token: lab.tokens.OWNER, body: {} })).status, 404);
    });
    assert.equal((await call(t, "GET", "/dev/providers/messages", { token: lab.tokens.FINANCE })).status, 403);
    await withEnv({ SMS_MODE: "real" }, async () => {
      const r = await call(t, "POST", "/dev/providers/simulate/webhook", { token: lab.tokens.OWNER, body: { kind: "sms", type: "message.delivered", providerRef: "x" } });
      assert.equal(r.status, 409);
    });
    const st = await call(t, "GET", "/dev/providers/status", { token: lab.tokens.OWNER });
    assert.ok(st.body.every((s: any) => typeof s.apiKeySet === "boolean" && !("apiKey" in s)));
  });

  it("REAL mode against a local fake provider: SMS send, retry on 5xx, failure mapping, delivery receipt with the kind's own secret", async () => {
    const fake = await startFakeProvider((_r, n) => (n === 2 ? { status: 503, body: {} } : undefined), `fake${RUN}`);
    try {
      await withEnv({ SMS_MODE: "real", SMS_API_URL: fake.url, SMS_API_KEY: "k_sms", SMS_WEBHOOK_SECRET: "whsec_sms", SMS_SENDER_ID: "KIORLY", SMS_BACKOFF_MS: "5" }, async () => {
        const msg = t.app.get(MessagingAdapter);
        const ok = await msg.send({ orgId: lab.orgId, channel: "SMS", purpose: "REPORT_OTP", recipientRef: "+201000000009", templateId: "TODO_NEEDS_HUMAN_REPORT_OTP", params: { otp: "123456", locale: "en" } });
        assert.equal(ok.status, "SENT");
        const row = await t.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: ok.id } });
        assert.equal(row.providerMessageId, `fake${RUN}_msg_1`);
        assert.equal(fake.requests[0]!.headers.authorization, "Bearer k_sms");
        assert.equal(fake.requests[0]!.headers["idempotency-key"], ok.id);
        assert.deepEqual([fake.requests[0]!.body.to, fake.requests[0]!.body.from, fake.requests[0]!.body.text], ["+201000000009", "KIORLY", "Your Kiorly Lab verification code is 123456. Do not share it."]);
        // second send: first attempt 503, retried with the same key, then accepted
        const retried = await msg.send({ orgId: lab.orgId, channel: "SMS", purpose: "CRITICAL_ALERT", recipientRef: "+201000000010", templateId: "TODO_NEEDS_HUMAN_CRITICAL_ALERT", params: { orderNumber: "O-9", locale: "ar" } });
        assert.equal(retried.status, "SENT");
        const keys = fake.requests.filter((q) => q.body?.to === "+201000000010").map((q) => q.headers["idempotency-key"]);
        assert.equal(keys.length, 2);
        assert.equal(new Set(keys).size, 1);
        assert.match(fake.requests.at(-1)!.body.text, /O-9/);
        // the default mock secret is NOT accepted once a real secret is configured
        const body = evt("evt_r1", "message.delivered", row.providerMessageId!);
        assert.equal((await hook(t, "sms", body, MOCK_WEBHOOK_SECRET)).status, 401);
        assert.equal((await hook(t, "sms", body, "whsec_sms")).status, 200);
        assert.equal((await t.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: ok.id } })).status, "DELIVERED");
      });
      // provider down: mapped FAILED row with the error code, never throws into the business flow
      const down = await startFakeProvider(() => ({ status: 500, body: {} }));
      try {
        await withEnv({ SMS_MODE: "real", SMS_API_URL: down.url, SMS_API_KEY: "k", SMS_WEBHOOK_SECRET: "w", SMS_SENDER_ID: "K", SMS_BACKOFF_MS: "5", SMS_MAX_RETRIES: "1" }, async () => {
          const f = await t.app.get(MessagingAdapter).send({ orgId: lab.orgId, channel: "SMS", purpose: "REPORT_OTP", recipientRef: "+201000000011", templateId: "TODO_NEEDS_HUMAN_REPORT_OTP", params: { otp: "654321", locale: "en" } });
          assert.equal(f.status, "FAILED");
          const row = await t.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: f.id } });
          assert.match(row.error ?? "", /^PROVIDER_5XX/);
          assert.ok(!(row.error ?? "").includes("k"), "no secrets in the stored error");
          assert.equal(down.requests.length, 2);
        });
      } finally { await down.close(); }
    } finally { await fake.close(); }
  });

  it("REAL mode PSP: pay link from the fake PSP, payment.succeeded books it, a pending refund completes on refund.succeeded", async () => {
    const fake = await startFakeProvider(undefined, `fake${RUN}`);
    try {
      await withEnv({ PAYMENT_MODE: "real", PAYMENT_API_URL: fake.url, PAYMENT_API_KEY: "k_pay", PAYMENT_WEBHOOK_SECRET: "whsec_pay" }, async () => {
        const inv = await invoice();
        const a = await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.RECEPTION, body: { amount: 70 } });
        assert.equal(a.status, 201, JSON.stringify(a.body));
        assert.match(a.body.link.payUrl, /^https:\/\/pay\.fake\.test\//);
        const plReq = fake.requests.find((q) => q.path === "/pay-links")!;
        assert.equal(plReq.headers.authorization, "Bearer k_pay");
        assert.equal(plReq.body.amount, "70.00");
        assert.equal(plReq.body.reference, a.body.link.id);
        const sim = await call(t, "POST", "/dev/providers/simulate/webhook", { token: lab.tokens.OWNER, body: { kind: "payment", type: "payment.succeeded", providerRef: a.body.link.providerRef } });
        assert.equal(sim.status, 409, "no simulating in real mode");
        assert.equal((await hook(t, "payment", evt("e_ok", "payment.succeeded", a.body.link.providerRef, { amount: "70.00" }), MOCK_WEBHOOK_SECRET)).status, 401);
        assert.equal((await hook(t, "payment", evt("e_ok", "payment.succeeded", a.body.link.providerRef, { amount: "70.00" }), "whsec_pay")).status, 200);
        assert.equal((await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION })).body.paidTotal, 70);
        const rf = await call(t, "POST", `/pay-links/${a.body.link.id}/refund`, { token: lab.tokens.RECEPTION, body: { amount: 20, reason: "partial" } });
        assert.equal(rf.status, 201, JSON.stringify(rf.body));
        assert.equal(rf.body.pending, true);
        assert.equal(rf.body.link.status, "REFUND_PENDING");
        assert.equal((await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION })).body.paidTotal, 70, "not booked until the PSP confirms");
        const rfRef = rf.body.link.refundRef as string;
        assert.equal((await hook(t, "payment", evt("e_rf", "refund.succeeded", rfRef), "whsec_pay")).status, 200);
        assert.equal((await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION })).body.paidTotal, 50);
        const l = (await call(t, "GET", `/invoices/${inv.id}/pay-links`, { token: lab.tokens.RECEPTION })).body[0];
        assert.deepEqual([l.status, l.refundedAmount], ["PAID", 20]);
        // a refund the PSP rejects returns the link to PAID with a reason and books nothing
        const rf2 = await call(t, "POST", `/pay-links/${a.body.link.id}/refund`, { token: lab.tokens.RECEPTION, body: { amount: 10 } });
        await hook(t, "payment", evt("e_rf2", "refund.failed", rf2.body.link.refundRef, { error: "insufficient settlement balance" }), "whsec_pay");
        const l2 = (await call(t, "GET", `/invoices/${inv.id}/pay-links`, { token: lab.tokens.RECEPTION })).body[0];
        assert.equal(l2.status, "PAID");
        assert.match(l2.failureReason, /REFUND_FAILED/);
        assert.equal((await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION })).body.paidTotal, 50);
        // PSP outage -> 502 with a mapped code and the link marked FAILED
        const down = await startFakeProvider(() => ({ status: 500, body: {} }));
        try {
          await withEnv({ PAYMENT_API_URL: down.url, PAYMENT_MAX_RETRIES: "0" }, async () => {
            const bad = await call(t, "POST", `/invoices/${inv.id}/pay-link`, { token: lab.tokens.RECEPTION, body: { amount: 10 } });
            assert.equal(bad.status, 502);
            assert.equal(bad.body.providerCode, "PROVIDER_5XX");
          });
        } finally { await down.close(); }
      });
    } finally { await fake.close(); }
  });
});
