import { BadGatewayException, ConflictException, Inject, Injectable, Logger, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NotificationChannel } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { PspAdapter } from "../../adapters/psp.adapter";
import { D, round2 } from "../../common/db";
import { KERNEL_LEDGER, type LedgerPort } from "../../kernel-adapter/ports";
import { ProviderError } from "../../providers/http";
import { PrismaService } from "../../prisma/prisma.service";
import { BillingService, cashAccount } from "./billing.service";

type SendVia = { channel: "SMS" | "EMAIL" | "WHATSAPP"; to?: string };
const SYSTEM = "system:paylink";

/**
 * Pay-by-link for invoices: PspAdapter.createPayLink -> optional SMS/email/WhatsApp with the link -> the PSP's signed webhook drives the status
 * (payment.succeeded books ONE Payment + ledger entry; payment.failed / payment.expired close the link; refund.* finish a refund).
 * Works identically in mock mode (the dev simulator posts the same signed webhooks).
 */
@Injectable()
export class PayLinksService {
  private readonly log = new Logger(PayLinksService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PspAdapter) private readonly psp: PspAdapter,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(KERNEL_LEDGER) private readonly ledger: LedgerPort,
  ) {}

  private view<T extends { amount: unknown; refundedAmount: unknown; refundAmount?: unknown }>(l: T) {
    return { ...l, amount: D(l.amount as never), refundedAmount: D(l.refundedAmount as never), refundAmount: l.refundAmount == null ? null : D(l.refundAmount as never) };
  }

  async create(u: AuthUser, invoiceId: string, b: { amount?: number; sendVia?: SendVia; expiresInHours?: number }, idemKey?: string) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId: u.orgId }, include: { order: { include: { patient: true } } } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    if (inv.status !== "ISSUED" && inv.status !== "PARTIALLY_PAID") throw new ConflictException({ code: "INVOICE_NOT_PAYABLE", status: inv.status });
    const { patientOutstanding } = await this.billing.shares(this.prisma, inv);
    const amount = round2(b.amount ?? patientOutstanding);
    if (!(amount > 0)) throw new UnprocessableEntityException({ code: "NOTHING_TO_PAY" });
    if (amount > patientOutstanding) throw new UnprocessableEntityException({ code: "OVERPAYMENT", outstanding: patientOutstanding });
    const key = idemKey ?? `paylink:${invoiceId}:${randomUUID()}`;
    const existing = await this.prisma.payLink.findUnique({ where: { orgId_idempotencyKey: { orgId: u.orgId, idempotencyKey: key } } });
    if (existing) return { link: this.view(existing), replayed: true };
    const expiresAt = new Date(Date.now() + (b.expiresInHours ?? 72) * 3_600_000);
    const link = await this.prisma.payLink.create({ data: { orgId: u.orgId, invoiceId, amount, currency: inv.currency, idempotencyKey: key, expiresAt, createdBy: u.staffId } });
    const patient = inv.order?.patient;
    try {
      const r = await this.psp.createPayLink({ amount: amount.toFixed(2), currency: inv.currency, reference: link.id, description: `Invoice ${inv.number}`, idempotencyKey: key, expiresAt: expiresAt.toISOString(), customer: { name: patient?.fullName, email: patient?.email ?? undefined, phone: patient?.phone ?? undefined } });
      const upd = await this.prisma.payLink.update({ where: { id: link.id }, data: { providerRef: r.providerRef, payUrl: r.payUrl } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "paylink.create", entityType: "Invoice", entityId: invoiceId, meta: { linkId: link.id, amount } });
      let notification: { id: string; status: string } | undefined;
      if (b.sendVia) {
        const to = b.sendVia.to ?? (b.sendVia.channel === "EMAIL" ? patient?.email : patient?.phone);
        if (!to) throw new UnprocessableEntityException({ code: b.sendVia.channel === "EMAIL" ? "NO_EMAIL" : "NO_PHONE" });
        notification = await this.messaging.send({ orgId: u.orgId, channel: b.sendVia.channel as NotificationChannel, purpose: "BILLING", recipientRef: to, templateId: "TODO_NEEDS_HUMAN_PAYMENT_LINK", params: { invoiceNumber: inv.number, amount: amount.toFixed(2), currency: inv.currency, link: r.payUrl, locale: patient?.preferredLocale ?? "ar" }, relatedType: "PayLink", relatedId: link.id });
      }
      return { link: this.view(upd), replayed: false, notification };
    } catch (e) {
      if (e instanceof ProviderError) {
        await this.prisma.payLink.update({ where: { id: link.id }, data: { status: "FAILED", failureReason: `${e.code}: ${e.message}`.slice(0, 200) } });
        throw new BadGatewayException({ code: "PSP_UNAVAILABLE", providerCode: e.code, message: e.message });
      }
      throw e;
    }
  }

  async list(orgId: string, invoiceId?: string) {
    const rows = await this.prisma.payLink.findMany({ where: { orgId, ...(invoiceId ? { invoiceId } : {}) }, orderBy: { createdAt: "desc" }, take: 100 });
    return rows.map((r) => this.view(r));
  }

  /** Sends the invoice (or its payment receipt) to the patient by email / SMS / WhatsApp. Template ids: TODO_NEEDS_HUMAN_INVOICE_EMAIL | _PAYMENT_RECEIPT. */
  async sendDocument(u: Pick<AuthUser, "orgId" | "staffId">, invoiceId: string, b: { kind: "INVOICE" | "RECEIPT"; channel: "SMS" | "EMAIL" | "WHATSAPP"; to?: string }) {
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, orgId: u.orgId }, include: { order: { include: { patient: true } } } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    if (b.kind === "RECEIPT" && D(inv.paidTotal) <= 0) throw new ConflictException({ code: "NOTHING_PAID" });
    const p = inv.order?.patient;
    const to = b.to ?? (b.channel === "EMAIL" ? p?.email : p?.phone);
    if (!to) throw new UnprocessableEntityException({ code: b.channel === "EMAIL" ? "NO_EMAIL" : "NO_PHONE" });
    const { patientOutstanding } = await this.billing.shares(this.prisma, inv);
    const r = await this.messaging.send({
      orgId: u.orgId, channel: b.channel as NotificationChannel, purpose: "BILLING", recipientRef: to,
      templateId: b.kind === "INVOICE" ? "TODO_NEEDS_HUMAN_INVOICE_EMAIL" : "TODO_NEEDS_HUMAN_PAYMENT_RECEIPT",
      params: { invoiceNumber: inv.number, total: D(inv.total).toFixed(2), outstanding: patientOutstanding.toFixed(2), amount: D(inv.paidTotal).toFixed(2), currency: inv.currency, locale: p?.preferredLocale ?? "ar" },
      relatedType: "Invoice", relatedId: inv.id,
    });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `invoice.${b.kind.toLowerCase()}_sent`, entityType: "Invoice", entityId: inv.id, meta: { channel: b.channel, status: r.status } });
    return r;
  }

  // ------------------------------------------------------------ webhook-driven transitions (called by ProviderEventsService)
  /** payment.succeeded: books ONE payment for the link (idempotent: only the PENDING/FAILED -> PAID winner books). Returns false when no link matches. */
  async onPaid(providerRef: string, amount?: string): Promise<boolean> {
    const link = await this.prisma.payLink.findFirst({ where: { providerRef } });
    if (!link) return false;
    if (link.status === "PAID" || link.status === "REFUND_PENDING" || link.status === "REFUNDED") return true;
    const won = await this.prisma.payLink.updateMany({ where: { id: link.id, status: { in: ["PENDING", "FAILED", "EXPIRED"] } }, data: { status: "PAID", failureReason: null } });
    if (won.count !== 1) return true;
    if (amount !== undefined && round2(Number(amount)) !== D(link.amount)) {
      await this.prisma.payLink.update({ where: { id: link.id }, data: { failureReason: "AMOUNT_MISMATCH_RECONCILE_MANUALLY" } });
      await this.audit.record({ orgId: link.orgId, actorId: SYSTEM, action: "paylink.amount_mismatch", entityType: "Invoice", entityId: link.invoiceId, meta: { linkId: link.id } });
      return true;
    }
    const amt = D(link.amount);
    const booked = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: link.invoiceId } });
      const sh = await this.billing.shares(tx, inv);
      if (amt > sh.patientOutstanding) return null;
      const p = await tx.payment.create({ data: { orgId: link.orgId, labId: inv.labId, invoiceId: inv.id, method: "CARD", status: "SUCCEEDED", amount: amt, idempotencyKey: `paylink:${link.id}`, pspRef: providerRef, receivedBy: SYSTEM, payer: "PATIENT", reference: `paylink:${link.id}` } });
      const paid = round2(D(inv.paidTotal) + amt);
      await tx.invoice.update({ where: { id: inv.id }, data: { paidTotal: paid, status: paid >= D(inv.total) ? "PAID" : "PARTIALLY_PAID" } });
      await this.ledger.post({ orgId: link.orgId, refType: "Payment", refId: p.id, debit: cashAccount("CARD"), credit: "RECEIVABLES", amount: amt, currency: inv.currency, memo: inv.number }, tx);
      await this.audit.record({ orgId: link.orgId, actorId: SYSTEM, action: "payment.record", entityType: "Payment", entityId: p.id, meta: { method: "CARD", invoiceId: inv.id, payer: "PATIENT", viaPayLink: link.id } }, tx);
      await tx.payLink.update({ where: { id: link.id }, data: { paymentId: p.id } });
      return { invoiceId: inv.id };
    });
    if (!booked) {
      await this.prisma.payLink.update({ where: { id: link.id }, data: { failureReason: "INVOICE_ALREADY_SETTLED_REFUND_REQUIRED" } });
      await this.audit.record({ orgId: link.orgId, actorId: SYSTEM, action: "paylink.paid_but_settled", entityType: "Invoice", entityId: link.invoiceId, meta: { linkId: link.id } });
      return true;
    }
    // receipt to the patient (email preferred); never fails the webhook
    try {
      const inv = await this.prisma.invoice.findUniqueOrThrow({ where: { id: link.invoiceId }, include: { order: { include: { patient: true } } } });
      const p = inv.order?.patient;
      const ch = p?.email ? "EMAIL" : p?.phone ? "SMS" : null;
      if (ch) await this.sendDocument({ orgId: link.orgId, staffId: SYSTEM }, link.invoiceId, { kind: "RECEIPT", channel: ch });
    } catch (e) { this.log.warn(`paylink receipt skipped: ${(e as Error).message}`); }
    return true;
  }

  /** payment.failed / payment.expired: the link can no longer be paid (a later success event still wins). */
  async onNotPaid(providerRef: string, status: "FAILED" | "EXPIRED", reason?: string): Promise<boolean> {
    const link = await this.prisma.payLink.findFirst({ where: { providerRef } });
    if (!link) return false;
    await this.prisma.payLink.updateMany({ where: { id: link.id, status: "PENDING" }, data: { status, failureReason: reason ?? (status === "EXPIRED" ? "EXPIRED" : "PAYMENT_FAILED") } });
    await this.audit.record({ orgId: link.orgId, actorId: SYSTEM, action: `paylink.${status.toLowerCase()}`, entityType: "Invoice", entityId: link.invoiceId, meta: { linkId: link.id } });
    return true;
  }

  /** Refund a paid link: asks the PSP first; a synchronous success books the refund now, otherwise refund.succeeded books it. */
  async refund(u: AuthUser, id: string, b: { amount?: number; reason?: string }) {
    const link = await this.prisma.payLink.findFirst({ where: { id, orgId: u.orgId } });
    if (!link) throw new NotFoundException({ code: "PAYLINK_NOT_FOUND" });
    if (link.status !== "PAID" || !link.paymentId || !link.providerRef) throw new ConflictException({ code: "PAYLINK_NOT_REFUNDABLE", status: link.status });
    const left = round2(D(link.amount) - D(link.refundedAmount));
    const amount = round2(b.amount ?? left);
    if (!(amount > 0) || amount > left) throw new UnprocessableEntityException({ code: "REFUND_EXCEEDS_PAYMENT", refundable: left });
    let r;
    try {
      r = await this.psp.refund({ providerRef: link.providerRef, amount: amount.toFixed(2), currency: link.currency, reason: b.reason, idempotencyKey: `refund:${link.id}:${round2(D(link.refundedAmount) + amount)}` });
    } catch (e) {
      if (e instanceof ProviderError) throw new BadGatewayException({ code: "PSP_UNAVAILABLE", providerCode: e.code, message: e.message });
      throw e;
    }
    if (r.status === "SUCCEEDED") return this.bookRefund(u, link.id, amount, b.reason);
    await this.prisma.payLink.update({ where: { id: link.id }, data: { status: "REFUND_PENDING", refundRef: r.providerRef, refundAmount: amount, failureReason: b.reason ? `refund:${b.reason}`.slice(0, 200) : null } });
    return { link: this.view((await this.prisma.payLink.findUniqueOrThrow({ where: { id: link.id } }))), pending: true };
  }

  private async bookRefund(u: Pick<AuthUser, "orgId" | "staffId">, linkId: string, amount: number, reason?: string) {
    const link = await this.prisma.payLink.findUniqueOrThrow({ where: { id: linkId } });
    const done = await this.billing.refund(u as AuthUser, link.paymentId!, { amount, reason });
    const refunded = round2(D(link.refundedAmount) + amount);
    const upd = await this.prisma.payLink.update({ where: { id: linkId }, data: { refundedAmount: refunded, status: refunded >= D(link.amount) ? "REFUNDED" : "PAID", refundRef: null, refundAmount: null, failureReason: null } });
    return { link: this.view(upd), refund: done, pending: false };
  }

  async onRefundSucceeded(refundRef: string): Promise<boolean> {
    const link = await this.prisma.payLink.findFirst({ where: { refundRef, status: "REFUND_PENDING" } });
    if (!link) return (await this.prisma.payLink.count({ where: { refundRef } })) > 0;
    await this.bookRefund({ orgId: link.orgId, staffId: SYSTEM }, link.id, D(link.refundAmount ?? link.amount), link.failureReason?.replace(/^refund:/, "") || undefined);
    return true;
  }

  async onRefundFailed(refundRef: string, reason?: string): Promise<boolean> {
    const link = await this.prisma.payLink.findFirst({ where: { refundRef, status: "REFUND_PENDING" } });
    if (!link) return false;
    await this.prisma.payLink.update({ where: { id: link.id }, data: { status: "PAID", refundRef: null, refundAmount: null, failureReason: `REFUND_FAILED${reason ? `: ${reason}` : ""}`.slice(0, 200) } });
    await this.audit.record({ orgId: link.orgId, actorId: SYSTEM, action: "paylink.refund_failed", entityType: "Invoice", entityId: link.invoiceId, meta: { linkId: link.id } });
    return true;
  }
}
