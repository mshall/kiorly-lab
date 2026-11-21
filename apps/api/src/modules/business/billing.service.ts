import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { InvoiceStatus, PaymentMethod } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { PspAdapter } from "../../adapters/psp.adapter";
import { D, type Db, nextSequence, pad, round2 } from "../../common/db";
import { IdempotencyService } from "../../common/idempotency";
import { page } from "../../common/pagination";
import { resolveLabId } from "../../common/lab-scope";
import { KERNEL_LEDGER, KERNEL_PRICE_BOOK, type LedgerPort, type PriceBookPort } from "../../kernel-adapter/ports";
import { hasPermission } from "../../auth/rbac";
import { OutboxService } from "../../outbox/outbox.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogueService } from "../catalogue/catalogue.service";
import { ReferrersService } from "../registry/referrers.service";

export interface AccountInput {
  name: string; priceListId?: string; paymentTermsDays?: number; creditLimit?: number; kind?: "CORPORATE" | "INSURANCE"; discountPercent?: number; coveragePercent?: number;
  contractRef?: string | null; contractStart?: string; contractEnd?: string; billingEmail?: string | null;
}
export interface InvoiceOptions { discountPercent?: number; discountAmount?: number; reason?: string }
/** Above this share of the list price a manual discount needs billing.pricing (manager / finance). */
export const DISCOUNT_APPROVAL_PERCENT = 20;

/** Allocates a discount across lines in proportion to their price; the last line absorbs rounding so the parts sum exactly (pure). */
export function allocateDiscount(prices: number[], discount: number): number[] {
  const gross = round2(prices.reduce((a, b) => a + b, 0));
  if (!(discount > 0) || gross <= 0) return prices.map(() => 0);
  const d = Math.min(discount, gross);
  let used = 0;
  return prices.map((p, i) => { if (i === prices.length - 1) return round2(d - used); const part = round2((p / gross) * d); used = round2(used + part); return part; });
}

/** Ledger account a payment method settles into. */
export const cashAccount = (m: PaymentMethod): "CASH_DRAWER" | "CARD_CLEARING" | "BANK" => (m === "CASH" ? "CASH_DRAWER" : m === "CARD" ? "CARD_CLEARING" : "BANK");

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
    @Inject(ReferrersService) private readonly referrers: ReferrersService,
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
  async listAccounts(orgId: string) {
    const rows = await this.prisma.b2bAccount.findMany({ where: { orgId }, include: { priceList: { select: { name: true } } }, orderBy: { name: "asc" } });
    return rows.map((a) => ({ ...a, creditLimit: a.creditLimit == null ? null : D(a.creditLimit), discountPercent: D(a.discountPercent), coveragePercent: D(a.coveragePercent) }));
  }
  async createAccount(u: AuthUser, b: AccountInput) {
    if (b.priceListId && !(await this.prisma.priceList.findFirst({ where: { id: b.priceListId, orgId: u.orgId } }))) throw new NotFoundException({ code: "PRICE_LIST_NOT_FOUND" });
    const a = await this.prisma.b2bAccount.create({ data: { orgId: u.orgId, name: b.name, priceListId: b.priceListId, paymentTermsDays: b.paymentTermsDays ?? 30, creditLimit: b.creditLimit, ...this.contract(b) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "b2b_account.create", entityType: "B2bAccount", entityId: a.id });
    return { ...a, creditLimit: a.creditLimit == null ? null : D(a.creditLimit), discountPercent: D(a.discountPercent), coveragePercent: D(a.coveragePercent) };
  }

  /** Insurance / corporate contract terms: discount on every invoice, payer coverage share, validity. */
  private contract(b: Partial<AccountInput>) {
    return {
      ...(b.kind ? { kind: b.kind } : {}), ...(b.discountPercent != null ? { discountPercent: b.discountPercent } : {}), ...(b.coveragePercent != null ? { coveragePercent: b.coveragePercent } : {}),
      ...(b.contractRef !== undefined ? { contractRef: b.contractRef } : {}), ...(b.billingEmail !== undefined ? { billingEmail: b.billingEmail } : {}),
      ...(b.contractStart ? { contractStart: new Date(b.contractStart) } : {}), ...(b.contractEnd ? { contractEnd: new Date(b.contractEnd) } : {}),
    };
  }

  async updateAccount(u: AuthUser, id: string, b: Partial<AccountInput> & { active?: boolean }) {
    if (!(await this.prisma.b2bAccount.findFirst({ where: { id, orgId: u.orgId } }))) throw new NotFoundException({ code: "B2B_ACCOUNT_NOT_FOUND" });
    if (b.priceListId && !(await this.prisma.priceList.findFirst({ where: { id: b.priceListId, orgId: u.orgId } }))) throw new NotFoundException({ code: "PRICE_LIST_NOT_FOUND" });
    const a = await this.prisma.b2bAccount.update({ where: { id }, data: { name: b.name, priceListId: b.priceListId, paymentTermsDays: b.paymentTermsDays, creditLimit: b.creditLimit, active: b.active, ...this.contract(b) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "b2b_account.update", entityType: "B2bAccount", entityId: id, meta: { fields: Object.keys(b) } });
    return { ...a, creditLimit: a.creditLimit == null ? null : D(a.creditLimit), discountPercent: D(a.discountPercent), coveragePercent: D(a.coveragePercent) };
  }

  // ----------------------------------------------------------------- invoices
  /**
   * KLBIZ01: one invoice per order. VAT is a display/export LINE only (market-pack rate); nothing is ever submitted to a tax authority (ADR-011).
   * Discounts (contract + manual) are allocated to lines before VAT. A payer coverage share (insurance) is recorded as payerAmount.
   */
  async invoiceOrder(u: AuthUser, orderId: string, opts: InvoiceOptions = {}) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, include: { b2bAccount: true, items: { where: { status: { not: "CANCELLED" } }, include: { test: true } } } });
      if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
      if (await tx.invoice.findFirst({ where: { orderId, status: { not: "VOID" } } })) throw new ConflictException({ code: "INVOICE_EXISTS" });
      if (!order.items.length) throw new ConflictException({ code: "NOTHING_TO_INVOICE" });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
      const rate = D(tenant.vatRatePercent);
      const prices = order.items.map((i) => D(i.price));
      const gross = round2(prices.reduce((a, b) => a + b, 0));
      const acc = order.b2bAccount;
      const contractPct = acc ? D(acc.discountPercent) : 0;
      const manualPct = opts.discountPercent ?? 0;
      if ((opts.discountPercent != null && opts.discountAmount != null) || manualPct < 0 || manualPct > 100 || (opts.discountAmount ?? 0) < 0) throw new BadRequestException({ code: "DISCOUNT_INVALID" });
      const manual = round2(opts.discountAmount ?? (gross * manualPct) / 100);
      if (manual > 0 && gross > 0 && (manual / gross) * 100 > DISCOUNT_APPROVAL_PERCENT && !hasPermission(u.role, "billing.pricing")) throw new ForbiddenException({ code: "DISCOUNT_NEEDS_APPROVAL", thresholdPercent: DISCOUNT_APPROVAL_PERCENT });
      if (manual > 0 && !(opts.reason ?? "").trim()) throw new BadRequestException({ code: "DISCOUNT_REASON_REQUIRED" });
      const contractDiscount = round2((gross * contractPct) / 100);
      const discountTotal = Math.min(gross, round2(contractDiscount + manual));
      const parts = allocateDiscount(prices, discountTotal);
      const lines = order.items.map((i, n) => {
        const unit = prices[n]!;
        const net = round2(unit - parts[n]!);
        const vat = round2((net * rate) / 100);
        return { description: i.packageCode ? `${i.test.nameEn} (${i.packageCode})` : i.test.nameEn, testId: i.testId, quantity: 1, unitPrice: unit, discountAmount: parts[n]!, vatRatePercent: rate, vatAmount: vat, lineTotal: round2(net + vat) };
      });
      const subtotal = round2(gross - discountTotal);
      const vatTotal = round2(lines.reduce((a, l) => a + l.vatAmount, 0));
      const total = round2(subtotal + vatTotal);
      const payerAmount = acc && D(acc.coveragePercent) > 0 ? round2((total * D(acc.coveragePercent)) / 100) : 0;
      const now = new Date();
      const reason = [contractDiscount > 0 ? `contract ${acc?.contractRef ?? acc?.name} ${contractPct}%` : null, manual > 0 ? `manual: ${opts.reason}` : null].filter(Boolean).join("; ") || null;
      const number = `INV-${new Date().getUTCFullYear()}-${pad(await nextSequence(tx, u.orgId, `inv:${new Date().getUTCFullYear()}`), 6)}`;
      const inv = await tx.invoice.create({
        data: {
          orgId: u.orgId, labId: order.labId, orderId, b2bAccountId: order.b2bAccountId, number, status: "ISSUED", currency: tenant.currency, subtotal, grossSubtotal: gross, discountTotal, discountReason: reason, payerAmount,
          dueAt: acc ? new Date(now.getTime() + acc.paymentTermsDays * 86_400_000) : now, vatRatePercent: rate, vatTotal, total, issuedAt: now, createdBy: u.staffId, lines: { create: lines },
        },
      });
      await this.ledger.post({ orgId: u.orgId, refType: "Invoice", refId: inv.id, debit: "RECEIVABLES", credit: "REVENUE", amount: subtotal, currency: tenant.currency, memo: number }, tx);
      if (vatTotal > 0) await this.ledger.post({ orgId: u.orgId, refType: "Invoice", refId: inv.id, debit: "RECEIVABLES", credit: "VAT_PAYABLE", amount: vatTotal, currency: tenant.currency, memo: `${number} VAT line` }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "invoice.issue", entityType: "Invoice", entityId: inv.id, meta: { total, discount: discountTotal, payerAmount } }, tx);
      await this.referrers.accrueForInvoice(tx, { id: inv.id, orgId: u.orgId, orderId, subtotal, number }, order.referrerId, u.staffId);
      if (order.source === "KIOREX_BOOKING") {
        await this.outbox.enqueue({ orgId: u.orgId, type: "LabInvoiceIssued", aggregateType: "Invoice", aggregateId: inv.id, data: { invoiceId: inv.id, orderId, sourceRef: order.sourceRef, currency: tenant.currency, total }, eventId: `evt_labinv_${inv.id}` }, tx);
      }
      return this.getInvoiceIn(tx, u.orgId, inv.id);
    });
  }

  private async getInvoiceIn(db: Db, orgId: string, id: string) {
    const inv = await db.invoice.findFirst({ where: { id, orgId }, include: { lines: true, payments: { orderBy: { createdAt: "asc" } }, order: { select: { orderNumber: true, patient: { select: { fullName: true } } } }, b2bAccount: { select: { name: true } } } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    const payerPaid = round2(inv.payments.filter((p) => p.status === "SUCCEEDED" && p.payer === "PAYER").reduce((a, p) => a + D(p.amount) - D(p.refundedAmount), 0));
    const patientPaid = round2(D(inv.paidTotal) - payerPaid);
    return {
      ...inv, subtotal: D(inv.subtotal), grossSubtotal: D(inv.grossSubtotal), discountTotal: D(inv.discountTotal), payerAmount: D(inv.payerAmount), vatTotal: D(inv.vatTotal), total: D(inv.total), paidTotal: D(inv.paidTotal), vatRatePercent: D(inv.vatRatePercent),
      patientShare: round2(D(inv.total) - D(inv.payerAmount)), patientOutstanding: inv.status === "VOID" ? 0 : round2(D(inv.total) - D(inv.payerAmount) - patientPaid), payerOutstanding: inv.status === "VOID" ? 0 : round2(D(inv.payerAmount) - payerPaid),
      lines: inv.lines.map((l) => ({ ...l, unitPrice: D(l.unitPrice), discountAmount: D(l.discountAmount), vatAmount: D(l.vatAmount), lineTotal: D(l.lineTotal), vatRatePercent: D(l.vatRatePercent) })), payments: inv.payments.map((p) => ({ ...p, amount: D(p.amount), refundedAmount: D(p.refundedAmount) })),
    };
  }
  getInvoice(orgId: string, id: string) {
    return this.getInvoiceIn(this.prisma, orgId, id);
  }

  async listInvoices(u: AuthUser, q: { status?: string; search?: string; limit?: string; offset?: string }) {
    const rows = await this.prisma.invoice.findMany({
      where: { orgId: u.orgId, ...(q.status ? { status: q.status as InvoiceStatus } : {}), ...(q.search ? { OR: [{ number: { contains: q.search, mode: "insensitive" } }, { order: { patient: { fullName: { contains: q.search, mode: "insensitive" } } } }] } : {}) },
      include: { order: { select: { orderNumber: true, patient: { select: { fullName: true } } } }, b2bAccount: { select: { name: true } } }, orderBy: { createdAt: "desc" }, ...page(q),
    });
    return rows.map((r) => ({ ...r, subtotal: D(r.subtotal), grossSubtotal: D(r.grossSubtotal), discountTotal: D(r.discountTotal), payerAmount: D(r.payerAmount), vatTotal: D(r.vatTotal), total: D(r.total), paidTotal: D(r.paidTotal), vatRatePercent: D(r.vatRatePercent) }));
  }

  async voidInvoice(u: AuthUser, id: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id, orgId: u.orgId } });
      if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
      if (inv.status === "VOID") return this.getInvoiceIn(tx, u.orgId, id);
      if (D(inv.paidTotal) > 0) throw new ConflictException({ code: "INVOICE_HAS_PAYMENTS", message: "refund payments before voiding" });
      await tx.invoice.update({ where: { id }, data: { status: "VOID" } });
      await this.referrers.reverseForInvoice(tx, { id, orgId: u.orgId }, u.staffId);
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
  async pay(u: AuthUser, invoiceId: string, b: { method: PaymentMethod; amount: number; cardToken?: string; payer?: "PATIENT" | "PAYER"; reference?: string }, idemKey: string | undefined) {
    if (!idemKey) throw new BadRequestException({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    const amount = round2(b.amount);
    if (!(amount > 0)) throw new BadRequestException({ code: "AMOUNT_INVALID" });
    const existing = await this.prisma.payment.findUnique({ where: { orgId_idempotencyKey: { orgId: u.orgId, idempotencyKey: idemKey } } });
    if (existing) {
      if (existing.invoiceId !== invoiceId || D(existing.amount) !== amount || existing.method !== b.method || existing.payer !== (b.payer ?? "PATIENT")) throw new ConflictException({ code: "IDEMPOTENCY_KEY_REUSED" });
      return { payment: { ...existing, amount: D(existing.amount) }, replayed: true };
    }
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId: u.orgId } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    if (inv.status === "VOID" || inv.status === "DRAFT") throw new ConflictException({ code: "INVOICE_NOT_PAYABLE", status: inv.status });
    const payer = b.payer ?? "PATIENT";
    if (payer === "PAYER" && (!inv.b2bAccountId || !(D(inv.payerAmount) > 0))) throw new UnprocessableEntityException({ code: "NO_PAYER_SHARE", message: "this invoice has no B2B/insurance share" });
    if ((b.method === "TRANSFER" || b.method === "CHEQUE") && payer !== "PAYER") throw new UnprocessableEntityException({ code: "METHOD_FOR_PAYER_ONLY", message: "transfers and cheques are settlements by the payer account" });
    const { patientOutstanding, payerOutstanding } = await this.shares(this.prisma, inv);
    const outstanding = payer === "PAYER" ? payerOutstanding : patientOutstanding;
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
        const sh = await this.shares(tx, fresh);
        if (amount > (payer === "PAYER" ? sh.payerOutstanding : sh.patientOutstanding)) throw new UnprocessableEntityException({ code: "OVERPAYMENT" });
        const p = await tx.payment.create({ data: { orgId: u.orgId, labId: inv.labId, invoiceId, method: b.method, status: "SUCCEEDED", amount, idempotencyKey: idemKey, pspRef, receivedBy: u.staffId, payer, reference: b.reference } });
        const paid = round2(D(fresh.paidTotal) + amount);
        await tx.invoice.update({ where: { id: invoiceId }, data: { paidTotal: paid, status: paid >= D(fresh.total) ? "PAID" : "PARTIALLY_PAID" } });
        await this.ledger.post({ orgId: u.orgId, refType: "Payment", refId: p.id, debit: cashAccount(b.method), credit: "RECEIVABLES", amount, currency: inv.currency, memo: inv.number }, tx);
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "payment.record", entityType: "Payment", entityId: p.id, meta: { method: b.method, invoiceId, payer } }, tx);
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

  /** Outstanding per share (patient / payer) from the succeeded payments net of refunds. */
  async shares(db: Db, inv: { id: string; total: unknown; payerAmount: unknown }) {
    const pays = await db.payment.findMany({ where: { invoiceId: inv.id, status: "SUCCEEDED" } });
    const net = (who: string) => round2(pays.filter((p) => p.payer === who).reduce((a, p) => a + D(p.amount) - D(p.refundedAmount), 0));
    return { patientOutstanding: round2(D(inv.total as never) - D(inv.payerAmount as never) - net("PATIENT")), payerOutstanding: round2(D(inv.payerAmount as never) - net("PAYER")) };
  }

  /** Full refund (legacy endpoint): refunds whatever is left of the payment. */
  async refund(u: AuthUser, paymentId: string, b: { amount?: number; reason?: string } = {}) {
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findFirst({ where: { id: paymentId, orgId: u.orgId }, include: { invoice: true } });
      if (!p) throw new NotFoundException({ code: "PAYMENT_NOT_FOUND" });
      if (p.status !== "SUCCEEDED") throw new ConflictException({ code: "PAYMENT_NOT_REFUNDABLE", status: p.status });
      const left = round2(D(p.amount) - D(p.refundedAmount));
      const amount = round2(b.amount ?? left);
      if (!(amount > 0)) throw new BadRequestException({ code: "AMOUNT_INVALID" });
      if (amount > left) throw new UnprocessableEntityException({ code: "REFUND_EXCEEDS_PAYMENT", refundable: left });
      const refunded = round2(D(p.refundedAmount) + amount);
      const full = refunded >= D(p.amount);
      await tx.payment.update({ where: { id: p.id }, data: { refundedAmount: refunded, status: full ? "REFUNDED" : "SUCCEEDED" } });
      const paid = round2(D(p.invoice.paidTotal) - amount);
      await tx.invoice.update({ where: { id: p.invoiceId }, data: { paidTotal: paid, status: paid <= 0 ? "ISSUED" : "PARTIALLY_PAID" } });
      const r = await tx.refund.create({ data: { orgId: u.orgId, labId: p.labId, paymentId: p.id, invoiceId: p.invoiceId, amount, reason: b.reason, createdBy: u.staffId } });
      await this.ledger.post({ orgId: u.orgId, refType: "PaymentRefund", refId: r.id, debit: "RECEIVABLES", credit: cashAccount(p.method), amount, currency: p.invoice.currency, memo: `refund ${p.invoice.number}` }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "payment.refund", entityType: "Payment", entityId: p.id, meta: { amount, full, reasonProvided: Boolean(b.reason) } }, tx);
      return { id: p.id, status: full ? "REFUNDED" : "SUCCEEDED", refunded: amount, refundedTotal: refunded, refundId: r.id };
    });
  }

  async refunds(orgId: string, q: { from?: string; to?: string }) {
    const rows = await this.prisma.refund.findMany({ where: { orgId, ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
    return rows.map((r) => ({ ...r, amount: D(r.amount) }));
  }

  /** Reconciliation: ledger balances must equal the payment and invoice tables. Returns the differences (empty => reconciled). */
  async reconcile(orgId: string) {
    const bal = await this.ledger.balances(orgId);
    const pays = await this.prisma.payment.findMany({ where: { orgId, status: "SUCCEEDED" } });
    const net = (p: { amount: unknown; refundedAmount: unknown }) => D(p.amount as never) - D(p.refundedAmount as never);
    const cash = round2(pays.filter((p) => p.method === "CASH").reduce((a, p) => a + net(p), 0));
    const card = round2(pays.filter((p) => p.method === "CARD").reduce((a, p) => a + net(p), 0));
    const bank = round2(pays.filter((p) => p.method === "TRANSFER" || p.method === "CHEQUE").reduce((a, p) => a + net(p), 0));
    const invs = await this.prisma.invoice.findMany({ where: { orgId, status: { not: "VOID" } } });
    const receivables = round2(invs.reduce((a, i) => a + D(i.total) - D(i.paidTotal), 0));
    const revenue = round2(invs.reduce((a, i) => a + D(i.subtotal), 0));
    const vat = round2(invs.reduce((a, i) => a + D(i.vatTotal), 0));
    const diffs: { account: string; ledger: number; tables: number }[] = [];
    const check = (account: string, ledger: number, tables: number) => { if (Math.abs(ledger - tables) > 0.001) diffs.push({ account, ledger, tables }); };
    check("CASH_DRAWER", bal.CASH_DRAWER ?? 0, cash);
    check("CARD_CLEARING", bal.CARD_CLEARING ?? 0, card);
    check("BANK", bal.BANK ?? 0, bank);
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
    // drawer view of the day: cash taken - cash refunded - expenses paid out of the drawer
    const pays = await this.prisma.payment.findMany({ where: { orgId: u.orgId, labId, method: "CASH", status: { in: ["SUCCEEDED", "REFUNDED"] }, createdAt: { gte: day, lt: next } } });
    const refunds = await this.prisma.refund.findMany({ where: { orgId: u.orgId, labId, createdAt: { gte: day, lt: next }, paymentId: { in: (await this.prisma.payment.findMany({ where: { orgId: u.orgId, labId, method: "CASH" }, select: { id: true } })).map((x) => x.id) } } });
    const drawer = await this.prisma.expense.findMany({ where: { orgId: u.orgId, labId, fromDrawer: true, voidedAt: null, date: day } });
    const expected = round2(pays.reduce((a, p) => a + D(p.amount), 0) - refunds.reduce((a, r) => a + D(r.amount), 0) - drawer.reduce((a, e) => a + D(e.amount), 0));
    const row = await this.prisma.cashClose.create({ data: { orgId: u.orgId, labId, businessDate: day, expectedCash: expected, countedCash: b.countedCash, variance: round2(b.countedCash - expected), closedBy: u.staffId, note: b.note } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "cash.close", entityType: "CashClose", entityId: row.id, meta: { variance: D(row.variance) } });
    return { ...row, expectedCash: D(row.expectedCash), countedCash: D(row.countedCash), variance: D(row.variance) };
  }
  async listCashCloses(orgId: string) {
    const rows = await this.prisma.cashClose.findMany({ where: { orgId }, orderBy: { businessDate: "desc" }, take: 60 });
    return rows.map((r) => ({ ...r, expectedCash: D(r.expectedCash), countedCash: D(r.countedCash), variance: D(r.variance) }));
  }
}
