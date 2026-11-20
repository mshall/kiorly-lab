import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ExpenseCategory } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, round2 } from "../../common/db";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { AGE_BUCKETS, ageBucket, daysOverdue, type AgeBucket } from "./aging";

const dayOf = (s: string) => { const d = new Date(`${s}T00:00:00.000Z`); if (Number.isNaN(d.getTime())) throw new BadRequestException({ code: "DATE_INVALID" }); return d; };
const period = (from?: string, to?: string) => ({ from: from ? dayOf(from) : new Date(Date.now() - 30 * 86_400_000), to: to ? new Date(`${to}T23:59:59.999Z`) : new Date() });

/** M8: receivables aging, expenses, financial summary (VAT shown as lines only; nothing is reported to any authority). */
@Injectable()
export class FinanceService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Outstanding invoices aged from their due date: payer share per B2B account, patient share per patient. */
  async aging(u: AuthUser, q: { asOf?: string }) {
    const asOf = q.asOf ? new Date(`${q.asOf}T23:59:59.999Z`) : new Date();
    const invs = await this.prisma.invoice.findMany({ where: { orgId: u.orgId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, issuedAt: { lte: asOf } }, include: { payments: { where: { status: "SUCCEEDED" } }, b2bAccount: { select: { id: true, name: true } }, order: { select: { orderNumber: true, patient: { select: { id: true, fullName: true } } } } } });
    type Row = { kind: "PAYER" | "PATIENT"; party: string; partyId: string; invoice: string; invoiceId: string; dueAt: Date; daysOverdue: number; bucket: AgeBucket; outstanding: number };
    const rows: Row[] = [];
    for (const i of invs) {
      const net = (who: string) => round2(i.payments.filter((p) => p.payer === who).reduce((a, p) => a + D(p.amount) - D(p.refundedAmount), 0));
      const payerOut = round2(D(i.payerAmount) - net("PAYER"));
      const patientOut = round2(D(i.total) - D(i.payerAmount) - net("PATIENT"));
      const due = i.dueAt ?? i.issuedAt ?? i.createdAt;
      const days = daysOverdue(due, asOf);
      if (payerOut > 0 && i.b2bAccount) rows.push({ kind: "PAYER", party: i.b2bAccount.name, partyId: i.b2bAccount.id, invoice: i.number, invoiceId: i.id, dueAt: due, daysOverdue: Math.max(days, 0), bucket: ageBucket(days), outstanding: payerOut });
      if (patientOut > 0) rows.push({ kind: "PATIENT", party: i.order?.patient.fullName ?? "Walk-in", partyId: i.order?.patient.id ?? "-", invoice: i.number, invoiceId: i.id, dueAt: due, daysOverdue: Math.max(days, 0), bucket: ageBucket(days), outstanding: patientOut });
    }
    const empty = () => Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0])) as Record<AgeBucket, number>;
    const totals = empty();
    const byParty = new Map<string, { kind: string; party: string; partyId: string; total: number } & Record<AgeBucket, number>>();
    for (const r of rows) {
      totals[r.bucket] = round2(totals[r.bucket] + r.outstanding);
      const k = `${r.kind}:${r.partyId}`;
      const e = byParty.get(k) ?? { kind: r.kind, party: r.party, partyId: r.partyId, total: 0, ...empty() };
      e[r.bucket] = round2(e[r.bucket] + r.outstanding);
      e.total = round2(e.total + r.outstanding);
      byParty.set(k, e);
    }
    return { asOf, totals: { ...totals, total: round2(AGE_BUCKETS.reduce((a, b) => a + totals[b], 0)) }, parties: [...byParty.values()].sort((a, b) => b.total - a.total), invoices: rows.sort((a, b) => b.daysOverdue - a.daysOverdue) };
  }

  // ------------------------------------------------------------- expenses
  async createExpense(u: AuthUser, b: { labId?: string; date: string; category: ExpenseCategory; amount: number; vendor?: string; paidVia?: string; fromDrawer?: boolean; reference?: string; note?: string }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    if (b.fromDrawer && (b.paidVia ?? "CASH") !== "CASH") throw new BadRequestException({ code: "DRAWER_NEEDS_CASH" });
    const date = dayOf(b.date);
    if (b.fromDrawer && (await this.prisma.cashClose.findUnique({ where: { labId_businessDate: { labId, businessDate: date } } }))) throw new ConflictException({ code: "CASH_ALREADY_CLOSED", message: "the drawer for that day is closed" });
    const row = await this.prisma.expense.create({ data: { orgId: u.orgId, labId, date, category: b.category, amount: b.amount, vendor: b.vendor, paidVia: b.paidVia ?? "CASH", fromDrawer: b.fromDrawer ?? false, reference: b.reference, note: b.note, createdBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "expense.create", entityType: "Expense", entityId: row.id, meta: { category: b.category, amount: b.amount } });
    return { ...row, amount: D(row.amount) };
  }

  async expenses(u: AuthUser, q: { from?: string; to?: string; category?: string }) {
    const p = period(q.from, q.to);
    const rows = await this.prisma.expense.findMany({ where: { orgId: u.orgId, date: { gte: p.from, lte: p.to }, ...(q.category ? { category: q.category as ExpenseCategory } : {}) }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 });
    return rows.map((r) => ({ ...r, amount: D(r.amount) }));
  }

  async voidExpense(u: AuthUser, id: string, reason: string) {
    const e = await this.prisma.expense.findFirst({ where: { id, orgId: u.orgId } });
    if (!e) throw new NotFoundException({ code: "EXPENSE_NOT_FOUND" });
    if (e.voidedAt) throw new ConflictException({ code: "EXPENSE_VOID" });
    if (e.fromDrawer && (await this.prisma.cashClose.findUnique({ where: { labId_businessDate: { labId: e.labId, businessDate: e.date } } }))) throw new ConflictException({ code: "CASH_ALREADY_CLOSED" });
    const row = await this.prisma.expense.update({ where: { id }, data: { voidedAt: new Date(), voidedBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "expense.void", entityType: "Expense", entityId: id, meta: { reasonProvided: Boolean(reason) } });
    return { ...row, amount: D(row.amount) };
  }

  // -------------------------------------------------------------- summary
  /** Income / expense statement for a period. Revenue is net of discounts and excludes VAT (shown separately as a line). */
  async summary(u: AuthUser, q: { from?: string; to?: string; labId?: string }) {
    const p = period(q.from, q.to);
    const labFilter = q.labId ? { labId: q.labId } : u.labIds.length ? { labId: { in: u.labIds } } : {};
    const [invs, refunds, sendOuts, expenses, commission, reagents, payments] = await Promise.all([
      this.prisma.invoice.findMany({ where: { orgId: u.orgId, status: { not: "VOID" }, issuedAt: { gte: p.from, lte: p.to }, ...labFilter } }),
      this.prisma.refund.findMany({ where: { orgId: u.orgId, createdAt: { gte: p.from, lte: p.to }, ...labFilter } }),
      this.prisma.sendOutCost.findMany({ where: { orgId: u.orgId, recordedAt: { gte: p.from, lte: p.to } } }),
      this.prisma.expense.findMany({ where: { orgId: u.orgId, voidedAt: null, date: { gte: p.from, lte: p.to }, ...labFilter } }),
      this.prisma.referrerLedgerEntry.findMany({ where: { orgId: u.orgId, account: "COMMISSION", type: { in: ["COMMISSION_ACCRUED", "COMMISSION_REVERSED"] }, createdAt: { gte: p.from, lte: p.to } } }),
      this.prisma.stockMovement.findMany({ where: { orgId: u.orgId, type: "CONSUMPTION", createdAt: { gte: p.from, lte: p.to }, ...labFilter } }),
      this.prisma.payment.findMany({ where: { orgId: u.orgId, status: { in: ["SUCCEEDED", "REFUNDED"] }, createdAt: { gte: p.from, lte: p.to }, ...labFilter } }),
    ]);
    const sum = <T,>(xs: T[], f: (x: T) => number) => round2(xs.reduce((a, x) => a + f(x), 0));
    const gross = sum(invs, (i) => D(i.grossSubtotal));
    const discounts = sum(invs, (i) => D(i.discountTotal));
    const revenue = sum(invs, (i) => D(i.subtotal));
    const vat = sum(invs, (i) => D(i.vatTotal));
    const refunded = sum(refunds, (r) => D(r.amount));
    const sendOut = sum(sendOuts, (s) => D(s.cost));
    const byCat = new Map<string, number>();
    for (const e of expenses) byCat.set(e.category, round2((byCat.get(e.category) ?? 0) + D(e.amount)));
    const opex = round2([...byCat.values()].reduce((a, b) => a + b, 0));
    const comm = sum(commission, (c) => D(c.amount));
    const reagentCost = sum(reagents, (m) => (D(m.qty) !== 0 ? -D(m.qty) : D(m.shortfall)) * D(m.unitCost ?? 0));
    const byMethod = new Map<string, number>();
    for (const x of payments) byMethod.set(x.method, round2((byMethod.get(x.method) ?? 0) + D(x.amount) - D(x.refundedAmount)));
    const net = round2(revenue - sendOut - opex - comm - reagentCost);
    return {
      period: { from: p.from, to: p.to }, currency: (await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } })).currency,
      invoices: invs.length, grossSales: gross, discounts, revenue, vatLines: vat, invoiced: round2(revenue + vat), refunds: refunded,
      collected: Object.fromEntries(byMethod), collectedTotal: round2([...byMethod.values()].reduce((a, b) => a + b, 0)),
      costs: { sendOut, referrerCommissions: comm, reagents: reagentCost, expenses: opex, expensesByCategory: Object.fromEntries(byCat) },
      netOperating: net, marginPercent: revenue > 0 ? round2((net / revenue) * 100) : null,
    };
  }
}
