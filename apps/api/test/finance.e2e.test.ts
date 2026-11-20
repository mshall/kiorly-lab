import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, PATIENT, bootApp, call, makeLab, makeOrder } from "./helpers/app";

describe("M8 finance: contract pricing + insurance share, discounts (approval), payer settlements, partial refunds, aging, expenses, cash close, summary, exports", () => {
  let t: TestApp;
  let lab: Lab;
  const T = () => lab.tokens;
  const key = () => `k-${Math.random().toString(36).slice(2)}`;
  before(async () => { t = await bootApp(); lab = await makeLab(t, { vat: 14 }); });
  after(async () => t.close());

  const pay = (invoiceId: string, body: Record<string, unknown>, token = T().FINANCE, k = key()) => call(t, "POST", `/invoices/${invoiceId}/payments`, { token, headers: { "idempotency-key": k }, body });

  it("insurance contract: discount applies on every invoice, payer covers a share, patient pays the rest; settlements by transfer", async () => {
    const acc = await call(t, "POST", "/b2b-accounts", { token: T().FINANCE, body: { name: "MedInsure (synthetic)", kind: "INSURANCE", discountPercent: 10, coveragePercent: 80, paymentTermsDays: 45, contractRef: "POL-2026-77" } });
    assert.equal(acc.status, 201, JSON.stringify(acc.body));
    assert.equal(acc.body.coveragePercent, 80);
    const f = await makeOrder(t, lab, ["CBC", "GLU"], { b2bAccountId: acc.body.id });
    const inv = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.equal(inv.body.grossSubtotal, 160);
    assert.equal(inv.body.discountTotal, 16);
    assert.equal(inv.body.subtotal, 144);
    assert.equal(inv.body.vatTotal, 20.16);
    assert.equal(inv.body.total, 164.16);
    assert.equal(inv.body.payerAmount, 131.33, "80% of 164.16");
    assert.equal(inv.body.patientOutstanding, 32.83);
    assert.match(inv.body.discountReason, /contract POL-2026-77 10%/);
    assert.equal(inv.body.lines.reduce((a: number, l: any) => a + l.discountAmount, 0), 16);
    assert.equal(inv.body.dueAt.slice(0, 10), new Date(Date.now() + 45 * 86_400_000).toISOString().slice(0, 10));
    // patient share
    assert.equal((await pay(inv.body.id, { method: "CASH", amount: 40 })).body.code, "OVERPAYMENT", "patient cannot pay more than their share");
    assert.equal((await pay(inv.body.id, { method: "TRANSFER", amount: 10 })).body.code, "METHOD_FOR_PAYER_ONLY");
    assert.equal((await pay(inv.body.id, { method: "CASH", amount: 32.83 })).status, 201);
    let cur = (await call(t, "GET", `/invoices/${inv.body.id}`, { token: T().FINANCE })).body;
    assert.deepEqual([cur.status, cur.patientOutstanding, cur.payerOutstanding], ["PARTIALLY_PAID", 0, 131.33]);
    // payer settlement in two instalments
    assert.equal((await pay(inv.body.id, { method: "TRANSFER", payer: "PAYER", amount: 200 })).body.code, "OVERPAYMENT");
    assert.equal((await pay(inv.body.id, { method: "TRANSFER", payer: "PAYER", amount: 100, reference: "TRF-1" })).status, 201);
    assert.equal((await pay(inv.body.id, { method: "CHEQUE", payer: "PAYER", amount: 31.33, reference: "CHQ-9" })).status, 201);
    cur = (await call(t, "GET", `/invoices/${inv.body.id}`, { token: T().FINANCE })).body;
    assert.equal(cur.status, "PAID");
    assert.equal((await call(t, "GET", "/billing/reconciliation", { token: T().FINANCE })).body.reconciled, true, "ledger includes the BANK account");
    // a plain patient invoice has no payer share
    const g = await makeOrder(t, lab, ["GLU"]);
    const inv2 = await call(t, "POST", `/orders/${g.orderId}/invoice`, { token: T().RECEPTION });
    assert.equal((await pay(inv2.body.id, { method: "TRANSFER", payer: "PAYER", amount: 5 })).body.code, "NO_PAYER_SHARE");
  });

  it("manual discounts: reason required, split proportionally, above the threshold only with pricing authority, audited", async () => {
    const f = await makeOrder(t, lab, ["CBC", "GLU", "TSH"], { patient: { ...PATIENT, fullName: "Disc 1", phone: "+201000008001" } });
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION, body: { discountPercent: 10 } })).body.code, "DISCOUNT_REASON_REQUIRED");
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION, body: { discountPercent: 30, reason: "staff relative" } })).body.code, "DISCOUNT_NEEDS_APPROVAL");
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION, body: { discountPercent: 5, discountAmount: 5, reason: "x" } })).status, 400);
    const ok = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION, body: { discountPercent: 10, reason: "returning patient" } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.grossSubtotal, 290);
    assert.equal(ok.body.discountTotal, 29);
    assert.equal(ok.body.subtotal, 261);
    assert.equal(ok.body.total, 297.54);
    assert.ok(ok.body.lines.every((l: any) => l.discountAmount > 0));
    await call(t, "POST", `/invoices/${ok.body.id}/void`, { token: T().FINANCE, body: { reason: "redo" } });
    const big = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().FINANCE, body: { discountAmount: 100, reason: "goodwill, delayed result" } });
    assert.equal(big.status, 201, "finance holds billing.pricing");
    assert.equal(big.body.discountTotal, 100);
    assert.equal(big.body.subtotal, 190);
    assert.ok(await t.prisma.auditLog.findFirst({ where: { orgId: lab.orgId, action: "invoice.issue", entityId: big.body.id } }));
  });

  it("partial refunds are cumulative and bounded, restore the invoice balance, keep the ledger reconciled, and net the cash drawer", async () => {
    const f = await makeOrder(t, lab, ["CBC"], { patient: { ...PATIENT, fullName: "Refund Pt", phone: "+201000008002" } });
    const inv = (await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION })).body;
    const p = (await pay(inv.id, { method: "CASH", amount: inv.total })).body.payment;
    const r1 = await call(t, "POST", `/payments/${p.id}/refund`, { token: T().FINANCE, body: { amount: 30, reason: "test cancelled" } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    assert.deepEqual([r1.body.status, r1.body.refundedTotal], ["SUCCEEDED", 30]);
    let cur = (await call(t, "GET", `/invoices/${inv.id}`, { token: T().FINANCE })).body;
    assert.deepEqual([cur.status, Math.round(cur.paidTotal * 100) / 100, cur.patientOutstanding], ["PARTIALLY_PAID", Math.round((inv.total - 30) * 100) / 100, 30]);
    assert.equal((await call(t, "POST", `/payments/${p.id}/refund`, { token: T().FINANCE, body: { amount: 999 } })).body.code, "REFUND_EXCEEDS_PAYMENT");
    assert.equal((await call(t, "GET", "/billing/reconciliation", { token: T().FINANCE })).body.reconciled, true);
    const r2 = await call(t, "POST", `/payments/${p.id}/refund`, { token: T().FINANCE, body: {} });
    assert.deepEqual([r2.body.status, r2.body.refunded, r2.body.refundedTotal], ["REFUNDED", Math.round((inv.total - 30) * 100) / 100, inv.total]);
    assert.equal((await call(t, "POST", `/payments/${p.id}/refund`, { token: T().FINANCE, body: {} })).body.code, "PAYMENT_NOT_REFUNDABLE");
    cur = (await call(t, "GET", `/invoices/${inv.id}`, { token: T().FINANCE })).body;
    assert.deepEqual([cur.status, cur.paidTotal], ["ISSUED", 0]);
    assert.equal((await call(t, "GET", "/billing/reconciliation", { token: T().FINANCE })).body.reconciled, true);
    assert.equal((await call(t, "GET", "/refunds", { token: T().FINANCE })).body.length, 2);
    const rf = await t.prisma.refund.findFirstOrThrow({ where: { orgId: lab.orgId } });
    await assert.rejects(t.prisma.refund.update({ where: { id: rf.id }, data: { reason: "tamper" } }), /append-only/);
  });

  it("expenses: create/list/void, drawer expenses reduce expected cash at close, closed days are locked", async () => {
    const day = new Date().toISOString().slice(0, 10);
    assert.equal((await call(t, "POST", "/expenses", { token: T().RECEPTION, body: { date: day, category: "TRANSPORT", amount: 10 } })).status, 403);
    assert.equal((await call(t, "POST", "/expenses", { token: T().FINANCE, body: { date: day, category: "TRANSPORT", amount: 10, paidVia: "BANK", fromDrawer: true } })).body.code, "DRAWER_NEEDS_CASH");
    const rent = await call(t, "POST", "/expenses", { token: T().FINANCE, body: { date: day, category: "RENT", amount: 5000, vendor: "Landlord", paidVia: "BANK", reference: "RENT-NOV" } });
    assert.equal(rent.status, 201);
    const taxi = await call(t, "POST", "/expenses", { token: T().FINANCE, body: { date: day, category: "TRANSPORT", amount: 25, vendor: "Taxi", fromDrawer: true, note: "courier fare" } });
    assert.equal(taxi.status, 201);
    const list = await call(t, "GET", `/expenses?from=${day}&to=${day}`, { token: T().FINANCE });
    assert.equal(list.body.length, 2);
    // expected cash = cash payments today - cash refunds today - drawer expenses
    const cashIn = (await t.prisma.payment.findMany({ where: { orgId: lab.orgId, method: "CASH", status: { in: ["SUCCEEDED", "REFUNDED"] } } })).reduce((a, p) => a + Number(p.amount), 0);
    const cashOut = (await t.prisma.refund.findMany({ where: { orgId: lab.orgId } })).reduce((a, r) => a + Number(r.amount), 0);
    const close = await call(t, "POST", "/cash-closes", { token: T().FINANCE, body: { businessDate: day, countedCash: cashIn - cashOut - 25 } });
    assert.equal(close.status, 201, JSON.stringify(close.body));
    assert.equal(Math.round(close.body.expectedCash * 100) / 100, Math.round((cashIn - cashOut - 25) * 100) / 100);
    assert.equal(close.body.variance, 0);
    assert.equal((await call(t, "POST", `/expenses/${taxi.body.id}/void`, { token: T().FINANCE, body: { reason: "mistake" } })).body.code, "CASH_ALREADY_CLOSED");
    assert.equal((await call(t, "POST", "/expenses", { token: T().FINANCE, body: { date: day, category: "OTHER", amount: 1, fromDrawer: true } })).body.code, "CASH_ALREADY_CLOSED");
    const v = await call(t, "POST", `/expenses/${rent.body.id}/void`, { token: T().FINANCE, body: { reason: "duplicate entry" } });
    assert.ok(v.body.voidedAt);
    assert.equal((await call(t, "GET", `/expenses?from=${day}&to=${day}`, { token: T().FINANCE })).body.length, 2, "voided rows stay visible, flagged");
  });

  it("receivables aging by payer and patient, bucketed from the due date", async () => {
    const acc = await call(t, "POST", "/b2b-accounts", { token: T().FINANCE, body: { name: "Aging Corp", coveragePercent: 100, paymentTermsDays: 30 } });
    const mk = async (n: number, daysAgo: number) => {
      const f = await makeOrder(t, lab, ["GLU"], { b2bAccountId: acc.body.id, patient: { ...PATIENT, fullName: `Aging ${n}`, phone: `+20100000810${n}` } });
      const inv = (await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: T().RECEPTION })).body;
      await t.prisma.invoice.update({ where: { id: inv.id }, data: { issuedAt: new Date(Date.now() - daysAgo * 86_400_000), dueAt: new Date(Date.now() - (daysAgo - 30) * 86_400_000) } });
      return inv;
    };
    await mk(1, 10);   // not yet due (due in 20 days)
    await mk(2, 45);   // 15 days overdue
    await mk(3, 100);  // 70 days overdue
    const walk = await makeOrder(t, lab, ["GLU"], { patient: { ...PATIENT, fullName: "Walk Debt", phone: "+201000008109" } });
    await call(t, "POST", `/orders/${walk.orderId}/invoice`, { token: T().RECEPTION });
    const a = await call(t, "GET", "/finance/aging", { token: T().FINANCE });
    assert.equal(a.status, 200);
    const corp = a.body.parties.find((p: any) => p.party === "Aging Corp");
    assert.equal(corp.kind, "PAYER");
    assert.deepEqual([corp.current > 0, corp.d1_30 > 0, corp.d31_60, corp.d61_90 > 0, corp.d90_plus], [true, true, 0, true, 0]);
    assert.equal(Math.round(corp.total * 100) / 100, Math.round((corp.current + corp.d1_30 + corp.d61_90) * 100) / 100);
    assert.ok(a.body.parties.some((p: any) => p.kind === "PATIENT" && p.party === "Walk Debt"));
    assert.ok(a.body.totals.total > 0);
    const pdf = await call(t, "GET", "/finance/aging.pdf", { token: T().FINANCE });
    assert.equal(pdf.raw.subarray(0, 5).toString(), "%PDF-");
    assert.equal((await call(t, "GET", "/finance/aging", { token: T().PHLEBOTOMIST })).status, 403);
  });

  it("financial summary and CSV/PDF exports (VAT as a plain line; nothing is submitted anywhere)", async () => {
    const s = await call(t, "GET", "/finance/summary", { token: T().FINANCE });
    assert.equal(s.status, 200);
    assert.ok(s.body.revenue > 0 && s.body.vatLines > 0);
    assert.ok(s.body.discounts >= 45, "contract + manual discounts");
    assert.equal(s.body.costs.expensesByCategory.TRANSPORT, 25);
    assert.equal(s.body.costs.expenses, 25, "the voided rent is excluded");
    assert.ok(s.body.refunds > 0);
    assert.equal(Math.round((s.body.netOperating + s.body.costs.sendOut + s.body.costs.expenses + s.body.costs.referrerCommissions + s.body.costs.reagents) * 100) / 100, s.body.revenue);
    for (const kind of ["expenses", "aging", "refunds", "commissions", "inventory-stock", "invoices"]) {
      const csv = await call(t, "GET", `/exports/${kind}.csv`, { token: T().FINANCE });
      assert.equal(csv.status, 200, kind);
      assert.match(csv.body, /\r\n$/);
      const pdf = await call(t, "GET", `/exports/${kind}.pdf`, { token: T().FINANCE });
      assert.equal(pdf.raw.subarray(0, 5).toString(), "%PDF-", kind);
    }
    assert.match((await call(t, "GET", "/exports/expenses.csv", { token: T().FINANCE })).body, /TRANSPORT/);
    assert.equal((await call(t, "GET", "/exports/nope.pdf", { token: T().FINANCE })).status, 400);
    assert.equal((await call(t, "GET", "/exports/expenses.pdf", { token: T().PHLEBOTOMIST })).status, 403);
  });
});
