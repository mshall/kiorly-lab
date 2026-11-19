import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { InvoiceStatus, PaymentMethod } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { PspAdapter } from "../../adapters/psp.adapter";
import { D, type Db, nextSequence, pad, round2 } from "../../common/db";
import { IdempotencyService } from "../../common/idempotency";
import { page } from "../../common/pagination";
import { resolveLabId } from "../../common/lab-scope";
import { KERNEL_LEDGER, KERNEL_PRICE_BOOK, type LedgerPort, type PriceBookPort } from "../../kernel-adapter/ports";
import { OutboxService } from "../../outbox/outbox.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogueService } from "../catalogue/catalogue.service";

@Injectable()
export class BillingService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(KERNEL_LEDGER) private readonly ledger: LedgerPort,
    @Inject(KERNEL_PRICE_BOOK) private readonly prices: PriceBookPort,
    @Inject(PspAdapter) private readonly psp: PspAdapter,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  // ----------------------------------------------------------- price lists
  async listPriceLists(orgId: string) {
    return this.prisma.priceList.findMany({ where: { orgId }, orderBy: { name: "asc" } });
  }
  async createPriceList(u: AuthUser, b: { name: string; isDefault?: boolean }) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
    return this.prisma.$transaction(async (tx) => {
      if (b.isDefault) await tx.priceList.updateMany({ where: { orgId: u.orgId, isDefault: true }, data: { isDefault: false } });
      const pl = await tx.priceList.create({ data: { orgId: u.orgId, name: b.name, isDefault: b.isDefault ?? false, currency: t.currency } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "price_list.create", entityType: "PriceList", entityId: pl.id }, tx);
      return pl;
    });
  }
  async setPrice(u: AuthUser, priceListId: string, b: { testId?: string; packageId?: string; amount: number }) {
    if (!b.testId === !b.packageId) throw new BadRequestException({ code: "TEST_OR_PACKAGE" });
    const pl = await this.prisma.priceList.findFirst({ where: { id: priceListId, orgId: u.orgId } });
    if (!pl) throw new NotFoundException({ code: "PRICE_LIST_NOT_FOUND" });
    return this.prisma.$transaction(async (tx) => {
      const r = await this.prices.set({ orgId: u.orgId, priceListId, testId: b.testId, packageId: b.packageId, amount: b.amount, actorId: u.staffId }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "price.set", entityType: "PriceList", entityId: priceListId, meta: { version: r.version } }, tx);
      return r;
    });
  }
  async priceListItems(orgId: string, priceListId: string) {
    const rows = await this.prisma.priceListItem.findMany({ where: { orgId, priceListId, effectiveTo: null }, orderBy: { effectiveFrom: "desc" } });
    return rows.map((r) => ({ ...r, amount: D(r.amount) }));
  }

  // -------------------------------------------------------------- B2B accounts
  listAccounts(orgId: string) {
    return this.prisma.b2bAccount.findMany({ where: { orgId }, include: { priceList: { select: { name: true } } }, orderBy: { name: "asc" } });
  }
  async createAccount(u: AuthUser, b: { name: string; priceListId?: string; paymentTermsDays?: number; creditLimit?: number }) {
    if (b.priceListId && !(await this.prisma.priceList.findFirst({ where: { id: b.priceListId, orgId: u.orgId } }))) throw new NotFoundException({ code: "PRICE_LIST_NOT_FOUND" });
    const a = await this.prisma.b2bAccount.create({ data: { orgId: u.orgId, name: b.name, priceListId: b.priceListId, paymentTermsDays: b.paymentTermsDays ?? 30, creditLimit: b.creditLimit } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "b2b_account.create", entityType: "B2bAccount", entityId: a.id });
    return a;
  }

  // ----------------------------------------------------------------- invoices
  /** KLBIZ01: one invoice per order. VAT is a display/export LINE only (market-pack rate); nothing is ever submitted to a tax authority (ADR-011). */
  async invoiceOrder(u: AuthUser, orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, include: { items: { where: { status: { not: "CANCELLED" } }, include: { test: true } } } });
      if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
      if (await tx.invoice.findFirst({ where: { orderId, status: { not: "VOID" } } })) throw new ConflictException({ code: "INVOICE_EXISTS" });
      if (!order.items.length) throw new ConflictException({ code: "NOTHING_TO_INVOICE" });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
      const rate = D(tenant.vatRatePercent);
      const lines = order.items.map((i) => {
        const unit = D(i.price);
        const vat = round2((unit * rate) / 100);
        return { description: i.packageCode ? `${i.test.nameEn} (${i.packageCode})` : i.test.nameEn, testId: i.testId, quantity: 1, unitPrice: unit, vatRatePercent: rate, vatAmount: vat, lineTotal: round2(unit + vat) };
      });
      const subtotal = round2(lines.reduce((a, l) => a + l.unitPrice, 0));
      const vatTotal = round2(lines.reduce((a, l) => a + l.vatAmount, 0));
      const total = round2(subtotal + vatTotal);
      const number = `INV-${new Date().getUTCFullYear()}-${pad(await nextSequence(tx, u.orgId, `inv:${new Date().getUTCFullYear()}`), 6)}`;
      const inv = await tx.invoice.create({
        data: { orgId: u.orgId, labId: order.labId, orderId, b2bAccountId: order.b2bAccountId, number, status: "ISSUED", currency: tenant.currency, subtotal, vatRatePercent: rate, vatTotal, total, issuedAt: new Date(), createdBy: u.staffId, lines: { create: lines } },
      });
      await this.ledger.post({ orgId: u.orgId, refType: "Invoice", refId: inv.id, debit: "RECEIVABLES", credit: "REVENUE", amount: subtotal, currency: tenant.currency, memo: number }, tx);
      if (vatTotal > 0) await this.ledger.post({ orgId: u.orgId, refType: "Invoice", refId: inv.id, debit: "RECEIVABLES", credit: "VAT_PAYABLE", amount: vatTotal, currency: tenant.currency, memo: `${number} VAT line` }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "invoice.issue", entityType: "Invoice", entityId: inv.id, meta: { total } }, tx);
      if (order.source === "KIOREX_BOOKING") {
        await this.outbox.enqueue({ orgId: u.orgId, type: "LabInvoiceIssued", aggregateType: "Invoice", aggregateId: inv.id, data: { invoiceId: inv.id, orderId, sourceRef: order.sourceRef, currency: tenant.currency, total }, eventId: `evt_labinv_${inv.id}` }, tx);
      }
      return this.getInvoiceIn(tx, u.orgId, inv.id);
    });
  }

  private async getInvoiceIn(db: Db, orgId: string, id: string) {
    const inv = await db.invoice.findFirst({ where: { id, orgId }, include: { lines: true, payments: { orderBy: { createdAt: "asc" } }, order: { select: { orderNumber: true, patient: { select: { fullName: true } } } }, b2bAccount: { select: { name: true } } } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    return { ...inv, subtotal: D(inv.subtotal), vatTotal: D(inv.vatTotal), total: D(inv.total), paidTotal: D(inv.paidTotal), vatRatePercent: D(inv.vatRatePercent), lines: inv.lines.map((l) => ({ ...l, unitPrice: D(l.unitPrice), vatAmount: D(l.vatAmount), lineTotal: D(l.lineTotal), vatRatePercent: D(l.vatRatePercent) })), payments: inv.payments.map((p) => ({ ...p, amount: D(p.amount) })) };
  }
  getInvoice(orgId: string, id: string) {
    return this.getInvoiceIn(this.prisma, orgId, id);
  }

  async listInvoices(u: AuthUser, q: { status?: string; search?: string; limit?: string; offset?: string }) {
    const rows = await this.prisma.invoice.findMany({
      where: { orgId: u.orgId, ...(q.status ? { status: q.status as InvoiceStatus } : {}), ...(q.search ? { OR: [{ number: { contains: q.search, mode: "insensitive" } }, { order: { patient: { fullName: { contains: q.search, mode: "insensitive" } } } }] } : {}) },
      include: { order: { select: { orderNumber: true, patient: { select: { fullName: true } } } }, b2bAccount: { select: { name: true } } }, orderBy: { createdAt: "desc" }, ...page(q),
    });
    return rows.map((r) => ({ ...r, subtotal: D(r.subtotal), vatTotal: D(r.vatTotal), total: D(r.total), paidTotal: D(r.paidTotal), vatRatePercent: D(r.vatRatePercent) }));
  }

  async voidInvoice(u: AuthUser, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, orgId: u.orgId } });
      if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
      if (inv.status === "VOID") return this.getInvoiceIn(tx, u.orgId, id);
      if (D(inv.paidTotal) > 0) throw new ConflictException({ code: "INVOICE_HAS_PAYMENTS", message: "refund payments before voiding" });
      await tx.invoice.update({ where: { id }, data: { status: "VOID" } });
      await this.ledger.post({ orgId: u.orgId, refType: "InvoiceVoid", refId: id, debit: "REVENUE", credit: "RECEIVABLES", amount: D(inv.subtotal), currency: inv.currency, memo: `void ${inv.number}` }, tx);
      if (D(inv.vatTotal) > 0) await this.ledger.post({ orgId: u.orgId, refType: "InvoiceVoid", refId: id, debit: "VAT_PAYABLE", credit: "RECEIVABLES", amount: D(inv.vatTotal), currency: inv.currency, memo: `void ${inv.number} VAT line` }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "invoice.void", entityType: "Invoice", entityId: id, meta: { reasonProvided: reason.length > 0 } }, tx);
      return this.getInvoiceIn(tx, u.orgId, id);
    });
  }

  // ----------------------------------------------------------------- payments
  /**
   * Money path: Idempotency-Key (unique per tenant) -> payment row -> ledger entry -> audit (+ outbox for Kiorex-sourced orders).
   * Replays with the same key return the original payment; reusing a key for a different invoice/amount is a 409.
   */
  async pay(u: AuthUser, invoiceId: string, b: { method: PaymentMethod; amount: number; cardToken?: string }, idemKey: string | undefined) {
    if (!idemKey) throw new BadRequestException({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    const amount = round2(b.amount);
    if (!(amount > 0)) throw new BadRequestException({ code: "AMOUNT_INVALID" });
    const existing = await this.prisma.payment.findUnique({ where: { orgId_idempotencyKey: { orgId: u.orgId, idempotencyKey: idemKey } } });
    if (existing) {
      if (existing.invoiceId !== invoiceId || D(existing.amount) !== amount || existing.method !== b.method) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
      return { payment: { ...existing, amount: D(existing.amount) }, replayed: true };
    }
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId: u.orgId } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    if (inv.status === "VOID" || inv.status === "DRAFT") throw new ConflictException({ code: "INVOICE_NOT_PAYABLE", status: inv.status });
    const outstanding = round2(D(inv.total) - D(inv.paidTotal));
    if (amount > outstanding) throw new UnprocessableEntityException({ code: "OVERPAYMENT", outstanding });

    let pspRef: string | undefined;
    if (b.method === "CARD") {
      if (!b.cardToken) throw new BadRequestException({ code: "CARD_TOKEN_REQUIRED" });
      const r = await this.psp.charge({ amount, currency: inv.currency, cardToken: b.cardToken, idempotencyKey: idemKey });
      if (!r.ok) {
        await this.prisma.payment.create({ data: { orgId: u.orgId, labId: inv.labId, invoiceId, method: "CARD", status: "FAILED", amount, idempotencyKey: idemKey, receivedBy: u.staffId } });
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "payment.failed", entityType: "Invoice", entityId: invoiceId, meta: { method: "CARD" } });
        throw new UnprocessableEntityException({ code: "CARD_DECLINED", message: r.error });
      }
      pspRef = r.pspRef;
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
        if (amount > round2(D(fresh.total) - D(fresh.paidTotal))) throw new UnprocessableEntityException({ code: "OVERPAYMENT" });
        const p = await tx.payment.create({ data: { orgId: u.orgId, labId: inv.labId, invoiceId, method: b.method, status: "SUCCEEDED", amount, idempotencyKey: idemKey, pspRef, receivedBy: u.staffId } });
        const paid = round2(D(fresh.paidTotal) + amount);
        await tx.invoice.update({ where: { id: invoiceId }, data: { paidTotal: paid, status: paid >= D(fresh.total) ? "PAID" : "PARTIALLY_PAID" } });
        await this.ledger.post({ orgId: u.orgId, refType: "Payment", refId: p.id, debit: b.method === "CASH" ? "CASH_DRAWER" : "CARD_CLEARING", credit: "RECEIVABLES", amount, currency: inv.currency, memo: inv.number }, tx);
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "payment.record", entityType: "Payment", entityId: p.id, meta: { method: b.method, invoiceId } }, tx);
        const order = inv.orderId ? await tx.labOrder.findUnique({ where: { id: inv.orderId } }) : null;
        if (order?.source === "KIOREX_BOOKING") {
          await this.outbox.enqueue({ orgId: u.orgId, type: "LabPaymentRecorded", aggregateType: "Payment", aggregateId: p.id, data: { paymentId: p.id, invoiceId, sourceRef: order.sourceRef, method: b.method, amount, currency: inv.currency }, eventId: `evt_labpay_${p.id}` }, tx);
        }
        return { payment: { ...p, amount }, replayed: false };
      });
    } catch (e) {
      // two concurrent requests with the same key: the loser returns the winner's row
      const winner = await this.prisma.payment.findUnique({ where: { orgId_idempotencyKey: { orgId: u.orgId, idempotencyKey: idemKey } } });
      if (winner && winner.status === "SUCCEEDED") return { payment: { ...winner, amount: D(winner.amount) }, replayed: true };
      throw e;
    }
  }

  async refund(u: AuthUser, paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId, orgId: u.orgId }, include: { invoice: true } });
      if (!p) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
      if (p.status !== "SUCCEEDED") throw new ConflictException({ code: "PAYMENT_NOT_REFUNDABLE", status: p.status });
      await tx.payment.update({ where: { id: p.id }, data: { status: "REFUNDED" } });
      const paid = round2(D(p.invoice.paidTotal) - D(p.amount));
      await tx.invoice.update({ where: { id: p.invoiceId }, data: { paidTotal: paid, status: paid <= 0 ? "ISSUED" : "PARTIALLY_PAID" } });
      await this.ledger.post({ orgId: u.orgId, refType: "PaymentRefund", refId: p.id, debit: "RECEIVABLES", credit: p.method === "CASH" ? "CASH_DRAWER" : "CARD_CLEARING", amount: D(p.amount), currency: p.invoice.currency, memo: `refund ${p.invoice.number}` }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "payment.refund", entityType: "Payment", entityId: p.id }, tx);
      return { id: p.id, status: "REFUNDED" };
    });
  }

  /** Reconciliation: ledger balances must equal the payment and invoice tables. Returns the differences (empty => reconciled). */
  async reconcile(orgId: string) {
    const bal = await this.ledger.balances(orgId);
    const pays = await this.prisma.payment.findMany({ where: { orgId, status: "SUCCEEDED" } });
    const cash = round2(pays.filter((p) => p.method === "CASH").reduce((a, p) => a + D(p.amount), 0));
    const card = round2(pays.filter((p) => p.method === "CARD").reduce((a, p) => a + D(p.amount), 0));
    const invs = await this.prisma.invoice.findMany({ where: { orgId, status: { not: "VOID" } } });
    const receivables = round2(invs.reduce((a, i) => a + D(i.total) - D(i.paidTotal), 0));
    const revenue = round2(invs.reduce((a, i) => a + D(i.subtotal), 0));
    const vat = round2(invs.reduce((a, i) => a + D(i.vatTotal), 0));
    const diffs: { account: string; ledger: number; tables: number }[] = [];
    const check = (account: string, ledger: number, tables: number) => { if (Math.abs(ledger - tables) > 0.001) diffs.push({ account, ledger, tables }); };
    check("CASH_DRAWER", bal.CASH_DRAWER ?? 0, cash);
    check("CARD_CLEARING", bal.CARD_CLEARING ?? 0, card);
    check("RECEIVABLES", bal.RECEIVABLES ?? 0, receivables);
    check("REVENUE", -(bal.REVENUE ?? 0), revenue);
    check("VAT_PAYABLE", -(bal.VAT_PAYABLE ?? 0), vat);
    return { reconciled: diffs.length === 0, diffs, balances: bal };
  }

  // ---------------------------------------------------------------- cash close
  async cashClose(u: AuthUser, b: { labId?: string; businessDate: string; countedCash: number; note?: string }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    const day = new Date(`${b.businessDate}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) throw new BadRequestException({ code: "DATE_INVALID" });
    if (await this.prisma.cashClose.findUnique({ where: { labId_businessDate: { labId, businessDate: day } } })) throw new ConflictException({ code: "CASH_ALREADY_CLOSED" });
    const next = new Date(day.getTime() + 86_400_000);
    const pays = await this.prisma.payment.findMany({ where: { orgId: u.orgId, labId, method: "CASH", status: { in: ["SUCCEEDED", "REFUNDED"] }, createdAt: { gte: day, lt: next } } });
    const expected = round2(pays.filter((p) => p.status === "SUCCEEDED").reduce((a, p) => a + D(p.amount), 0));
    const row = await this.prisma.cashClose.create({ data: { orgId: u.orgId, labId, businessDate: day, expectedCash: expected, countedCash: b.countedCash, variance: round2(b.countedCash - expected), closedBy: u.staffId, note: b.note } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "cash.close", entityType: "CashClose", entityId: row.id, meta: { variance: D(row.variance) } });
    return { ...row, expectedCash: D(row.expectedCash), countedCash: D(row.countedCash), variance: D(row.variance) };
  }
  async listCashCloses(orgId: string) {
    const rows = await this.prisma.cashClose.findMany({ where: { orgId }, orderBy: { businessDate: "desc" }, take: 60 });
    return rows.map((r) => ({ ...r, expectedCash: D(r.expectedCash), countedCash: D(r.countedCash), variance: D(r.variance) }));
  }
}
