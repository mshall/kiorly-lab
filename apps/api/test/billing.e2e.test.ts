import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab, makeOrder } from "./helpers/app";

describe("business: price lists, invoices (VAT lines only), payments (mock PSP), cash close, reconciliation, exports", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t, { vat: 14 });
  });
  after(async () => t.close());

  it("invoices an order with VAT lines, one invoice per order; PDF and CSV carry VAT columns only", async () => {
    const f = await makeOrder(t, lab, ["CBC", "GLU"]);
    const inv = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.RECEPTION });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.equal(inv.body.subtotal, 160);
    assert.equal(inv.body.vatTotal, 22.4);
    assert.equal(inv.body.total, 182.4);
    assert.equal(inv.body.lines.length, 2);
    assert.ok(inv.body.lines.every((l: any) => l.vatRatePercent === 14));
    assert.match(inv.body.number, /^INV-\d{4}-\d{6}$/);
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.RECEPTION })).status, 409);
    const pdf = await call(t, "GET", `/invoices/${inv.body.id}/pdf`, { token: lab.tokens.RECEPTION });
    assert.equal(pdf.raw.subarray(0, 4).toString(), "%PDF");
    const csv = await call(t, "GET", "/exports/invoices.csv", { token: lab.tokens.BRANCH_MANAGER });
    assert.equal(csv.status, 200);
    assert.match(csv.body, /vat_rate_percent,vat_total,total/);
    assert.match(csv.body, new RegExp(inv.body.number));
    assert.equal((await call(t, "GET", "/exports/invoices.csv", { token: lab.tokens.PHLEBOTOMIST })).status, 403);
    assert.equal((await call(t, "GET", "/exports/secrets.csv", { token: lab.tokens.BRANCH_MANAGER })).status, 400);
  });

  it("package orders allocate the package price across items; B2B price list applies", async () => {
    const f = await makeOrder(t, lab, [], { packageCodes: ["CHECKUP1"] });
    const total = f.order.items.reduce((a: number, i: any) => a + i.price, 0);
    assert.equal(total, 360);
    assert.ok(f.order.items.every((i: any) => i.packageCode === "CHECKUP1"));

    const pl = await call(t, "POST", "/price-lists", { token: lab.tokens.BRANCH_MANAGER, body: { name: "Insurer A" } });
    const test = (await call(t, "GET", "/catalogue/tests?search=GLU", { token: lab.tokens.RECEPTION })).body[0];
    assert.equal((await call(t, "PUT", `/price-lists/${pl.body.id}/prices`, { token: lab.tokens.BRANCH_MANAGER, body: { testId: test.id, amount: 30 } })).status, 200);
    const acc = await call(t, "POST", "/b2b-accounts", { token: lab.tokens.BRANCH_MANAGER, body: { name: "Insurer A Ltd", priceListId: pl.body.id, paymentTermsDays: 45 } });
    assert.equal(acc.status, 201);
    const g = await makeOrder(t, lab, ["GLU"], { b2bAccountId: acc.body.id });
    assert.equal(g.order.items[0].price, 30, "payer contract price");
    const std = await makeOrder(t, lab, ["GLU"]);
    assert.equal(std.order.items[0].price, 40, "standard price");
  });

  it("price changes are versioned (never edited in place) and history is kept", async () => {
    const test = (await call(t, "GET", "/catalogue/tests?search=TSH", { token: lab.tokens.RECEPTION })).body[0];
    const up = await call(t, "PUT", `/catalogue/tests/${test.id}`, { token: lab.tokens.LAB_DIRECTOR, body: { price: 150 } });
    assert.equal(up.status, 200);
    assert.equal(up.body.priceVersion, 2);
    const hist = await call(t, "GET", `/catalogue/tests/${test.id}/price-history`, { token: lab.tokens.BRANCH_MANAGER });
    assert.deepEqual(hist.body.map((h: any) => [h.version, Number(h.amount), h.effectiveTo !== null]), [[2, 150, false], [1, 130, true]]);
    const o = await makeOrder(t, lab, ["TSH"]);
    assert.equal(o.order.items[0].price, 150);
  });

  it("payments: idempotency key, cash + mock card, overpayment guard, decline, refund, reconciliation", async () => {
    const f = await makeOrder(t, lab, ["CBC"]);
    const inv = (await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.RECEPTION })).body; // 120 + 16.8
    assert.equal(inv.total, 136.8);
    const pay = (body: unknown, key?: string, token = lab.tokens.RECEPTION) => call(t, "POST", `/invoices/${inv.id}/payments`, { token, body, headers: key ? { "idempotency-key": key } : {} });
    assert.equal((await pay({ method: "CASH", amount: 50 })).status, 400, "key required");
    const p1 = await pay({ method: "CASH", amount: 50 }, "k-1");
    assert.equal(p1.status, 201);
    assert.equal(p1.body.replayed, false);
    const replay = await pay({ method: "CASH", amount: 50 }, "k-1");
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.payment.id, p1.body.payment.id, "same key => same payment, no double charge");
    assert.equal((await pay({ method: "CASH", amount: 60 }, "k-1")).status, 409, "key reuse with different amount");
    assert.equal((await pay({ method: "CASH", amount: 500 }, "k-2")).status, 422, "overpayment");
    const decl = await pay({ method: "CARD", amount: 86.8, cardToken: "tok_decline" }, "k-3");
    assert.equal(decl.status, 422);
    assert.equal(decl.body.code, "CARD_DECLINED");
    assert.equal((await pay({ method: "CARD", amount: 86.8, cardToken: "4242424242424242" }, "k-4")).status, 422, "raw card numbers refused");
    const card = await pay({ method: "CARD", amount: 86.8, cardToken: "tok_visa" }, "k-5");
    assert.equal(card.status, 201);
    const paid = await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION });
    assert.equal(paid.body.status, "PAID");
    assert.equal(paid.body.paidTotal, 136.8);

    let rec = await call(t, "GET", "/billing/reconciliation", { token: lab.tokens.BRANCH_MANAGER });
    assert.equal(rec.body.reconciled, true, JSON.stringify(rec.body));
    assert.equal((await call(t, "POST", `/payments/${p1.body.payment.id}/refund`, { token: lab.tokens.BRANCH_MANAGER })).status, 201);
    const after = await call(t, "GET", `/invoices/${inv.id}`, { token: lab.tokens.RECEPTION });
    assert.equal(after.body.status, "PARTIALLY_PAID");
    rec = await call(t, "GET", "/billing/reconciliation", { token: lab.tokens.BRANCH_MANAGER });
    assert.equal(rec.body.reconciled, true, "refund keeps ledger == tables");
    // concurrent same-key requests never double-charge
    const g = await makeOrder(t, lab, ["GLU"]);
    const inv2 = (await call(t, "POST", `/orders/${g.orderId}/invoice`, { token: lab.tokens.RECEPTION })).body;
    const race = await Promise.all(Array.from({ length: 5 }, () => call(t, "POST", `/invoices/${inv2.id}/payments`, { token: lab.tokens.RECEPTION, body: { method: "CASH", amount: 10 }, headers: { "idempotency-key": "race-1" } })));
    assert.equal(race.filter((r) => r.status === 201).length, 5, JSON.stringify(race.map((r) => r.status)));
    assert.equal(await t.prisma.payment.count({ where: { orgId: lab.orgId, idempotencyKey: "race-1" } }), 1);
    assert.equal((await call(t, "GET", "/billing/reconciliation", { token: lab.tokens.BRANCH_MANAGER })).body.reconciled, true);
    // voiding is refused with payments; allowed otherwise
    assert.equal((await call(t, "POST", `/invoices/${inv.id}/void`, { token: lab.tokens.BRANCH_MANAGER, body: { reason: "x" } })).status, 409);
    const h = await makeOrder(t, lab, ["GLU"]);
    const inv3 = (await call(t, "POST", `/orders/${h.orderId}/invoice`, { token: lab.tokens.RECEPTION })).body;
    assert.equal((await call(t, "POST", `/invoices/${inv3.id}/void`, { token: lab.tokens.BRANCH_MANAGER, body: { reason: "duplicate" } })).body.status, "VOID");
    assert.equal((await call(t, "GET", "/billing/reconciliation", { token: lab.tokens.BRANCH_MANAGER })).body.reconciled, true);
  });

  it("cash close computes expected cash, records variance, and is once per lab/day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const expected = (await t.prisma.payment.findMany({ where: { orgId: lab.orgId, method: "CASH", status: "SUCCEEDED" } })).reduce((a, p) => a + Number(p.amount), 0);
    const close = await call(t, "POST", "/cash-closes", { token: lab.tokens.RECEPTION, body: { businessDate: today, countedCash: expected - 5 } });
    assert.equal(close.status, 201, JSON.stringify(close.body));
    assert.equal(close.body.expectedCash, expected);
    assert.equal(close.body.variance, -5);
    assert.equal((await call(t, "POST", "/cash-closes", { token: lab.tokens.RECEPTION, body: { businessDate: today, countedCash: 1 } })).status, 409);
  });

  it("TAT dashboard classifies items and the SLA sweep raises one deduplicated alert per breach", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await t.prisma.labOrder.update({ where: { id: f.orderId }, data: { createdAt: new Date(Date.now() - 5 * 3600_000) } });
    const tat = await call(t, "GET", "/tat", { token: lab.tokens.BRANCH_MANAGER });
    const row = tat.body.rows.find((r: any) => r.orderId === f.orderId);
    assert.equal(row.status, "BREACHED");
    assert.equal(row.targetMinutes, 120);
    const s1 = await t.insights.slaSweep(new Date(), { orgId: lab.orgId });
    assert.ok(s1.raised >= 1);
    assert.equal((await t.insights.slaSweep(new Date(), { orgId: lab.orgId })).raised, 0, "deduplicated");
    assert.ok(await t.prisma.notificationAttempt.findFirst({ where: { orgId: lab.orgId, purpose: "SLA_ALERT" } }));
    const dash = await call(t, "GET", "/dashboard", { token: lab.tokens.BRANCH_MANAGER });
    assert.equal(dash.status, 200);
    assert.ok(dash.body.tat.breached >= 1);
  });

  it("referring-doctor statements stay disabled until a human enables them (NH-LB-003); send-out costs need the PRO plan", async () => {
    assert.equal((await call(t, "GET", "/statements/referring-doctors", { token: lab.tokens.BRANCH_MANAGER })).status, 403);
    await call(t, "PUT", "/settings", { token: lab.tokens.OWNER, body: { referringDoctorStatements: true } });
    const st = await call(t, "GET", "/statements/referring-doctors", { token: lab.tokens.BRANCH_MANAGER });
    assert.equal(st.status, 200);
    assert.ok(st.body.some((d: any) => d.doctor === "Dr Ref" && d.orders >= 1));
    // send-out
    const sendOut = await call(t, "POST", "/catalogue/tests", { token: lab.tokens.LAB_DIRECTOR, body: { code: "SENDX", nameEn: "Send-out marker", specimenType: "Serum", price: 500, sendOut: true, analyteCodes: ["TSH"] } });
    assert.equal(sendOut.status, 201);
    await call(t, "PUT", `/catalogue/tests/${sendOut.body.id}`, { token: lab.tokens.LAB_DIRECTOR, body: { sendOut: true } });
    const o = await makeOrder(t, lab, ["SENDX"]);
    const cost = await call(t, "POST", `/order-items/${o.order.items[0].id}/send-out-cost`, { token: lab.tokens.BRANCH_MANAGER, body: { referralLabName: "Partner Lab", cost: 320 } });
    assert.equal(cost.status, 201, JSON.stringify(cost.body));
    const sum = await call(t, "GET", "/send-out-costs", { token: lab.tokens.BRANCH_MANAGER });
    assert.equal(sum.body.totals.cost, 320);
    const lite = await makeLab(t, { edition: "LITE" });
    const lo = await makeOrder(t, lite, ["GLU"]);
    const r = await call(t, "POST", `/order-items/${lo.order.items[0].id}/send-out-cost`, { token: lite.tokens.BRANCH_MANAGER, body: { referralLabName: "X", cost: 1 } });
    assert.ok([402, 409].includes(r.status));
  });
});
