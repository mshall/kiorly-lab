import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { CommissionType, NotificationChannel, Prisma, ReferrerAccount, ReferrerKind } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, type Db, round2 } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";

export interface ReferrerInput {
  kind?: ReferrerKind; name: string; specialty?: string; phone?: string; email?: string; address?: string; licenceNo?: string;
  deliveryChannels?: NotificationChannel[]; deliverOnRelease?: boolean; preferredLocale?: "ar" | "en";
  commissionType?: CommissionType; commissionValue?: number; creditLimit?: number | null; paymentTermsDays?: number; active?: boolean;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Commission = percent of the invoice subtotal (pre-VAT) or a fixed amount per invoice. Pure. */
export function commissionFor(type: CommissionType, value: number, subtotal: number): number {
  if (type === "PERCENT") return round2((subtotal * value) / 100);
  if (type === "FIXED") return round2(value);
  return 0;
}

/** M1: referring doctors/clinics directory, delivery preferences, commission + credit accounts (append-only ledger). */
@Injectable()
export class ReferrersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private view<T extends { commissionValue: unknown; creditLimit: unknown; portalTokenHash?: string | null }>(r: T) {
    const { portalTokenHash, ...rest } = r;
    return { ...rest, commissionValue: D(r.commissionValue as never), creditLimit: r.creditLimit == null ? null : D(r.creditLimit as never), portalEnabled: Boolean(portalTokenHash) };
  }

  async list(u: AuthUser, q: { search?: string; kind?: string; active?: string }) {
    const rows = await this.prisma.referrer.findMany({
      where: { orgId: u.orgId, ...(q.kind ? { kind: q.kind as ReferrerKind } : {}), ...(q.active ? { active: q.active === "true" } : {}), ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }, { specialty: { contains: q.search, mode: "insensitive" } }] } : {}) },
      orderBy: { name: "asc" }, include: { _count: { select: { orders: true } } },
    });
    const bal = await this.balances(u.orgId);
    return rows.map((r) => ({ ...this.view(r), orderCount: r._count.orders, balances: bal.get(r.id) ?? { COMMISSION: 0, CREDIT: 0 } }));
  }

  async balances(orgId: string, db: Db = this.prisma) {
    const g = await db.referrerLedgerEntry.groupBy({ by: ["referrerId", "account"], where: { orgId }, _sum: { amount: true } });
    const m = new Map<string, { COMMISSION: number; CREDIT: number }>();
    for (const r of g) { const e = m.get(r.referrerId) ?? { COMMISSION: 0, CREDIT: 0 }; e[r.account] = round2(D(r._sum.amount ?? 0)); m.set(r.referrerId, e); }
    return m;
  }

  async get(u: AuthUser, id: string) {
    const r = await this.prisma.referrer.findFirst({ where: { id, orgId: u.orgId }, include: { _count: { select: { orders: true } } } });
    if (!r) throw new NotFoundException({ code: "REFERRER_NOT_FOUND" });
    const bal = (await this.balances(u.orgId)).get(id) ?? { COMMISSION: 0, CREDIT: 0 };
    const recent = await this.prisma.labOrder.findMany({ where: { orgId: u.orgId, referrerId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, orderNumber: true, status: true, createdAt: true, patient: { select: { fullName: true } }, invoices: { select: { number: true, total: true, status: true } } } });
    return { ...this.view(r), orderCount: r._count.orders, balances: bal, recentOrders: recent.map((o) => ({ ...o, invoices: o.invoices.map((i) => ({ ...i, total: D(i.total) })) })) };
  }

  async create(u: AuthUser, b: ReferrerInput) {
    const row = await this.prisma.referrer.create({ data: { orgId: u.orgId, ...b, commissionValue: b.commissionValue ?? 0, creditLimit: b.creditLimit ?? undefined } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "referrer.create", entityType: "Referrer", entityId: row.id });
    return this.view(row);
  }

  async update(u: AuthUser, id: string, b: Partial<ReferrerInput>) {
    await this.mustGet(u.orgId, id);
    const row = await this.prisma.referrer.update({ where: { id }, data: b });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "referrer.update", entityType: "Referrer", entityId: id, meta: { fields: Object.keys(b) } });
    return this.view(row);
  }

  private async mustGet(orgId: string, id: string) {
    const r = await this.prisma.referrer.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException({ code: "REFERRER_NOT_FOUND" });
    return r;
  }

  /** Doctor-portal access: the token is shown once; only its hash is stored. Re-issuing revokes the previous link. */
  async issuePortalToken(u: AuthUser, id: string) {
    await this.mustGet(u.orgId, id);
    const token = randomBytes(24).toString("base64url");
    await this.prisma.referrer.update({ where: { id }, data: { portalTokenHash: sha256(token) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "referrer.portal_token", entityType: "Referrer", entityId: id });
    return { token, path: `/portal/${token}` };
  }
  async revokePortalToken(u: AuthUser, id: string) {
    await this.mustGet(u.orgId, id);
    await this.prisma.referrer.update({ where: { id }, data: { portalTokenHash: null } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "referrer.portal_revoke", entityType: "Referrer", entityId: id });
    return { revoked: true };
  }

  // -------------------------------------------------------------- ledger
  async ledger(u: AuthUser, id: string, q: { account?: string; limit?: string }) {
    await this.mustGet(u.orgId, id);
    const rows = await this.prisma.referrerLedgerEntry.findMany({ where: { orgId: u.orgId, referrerId: id, ...(q.account ? { account: q.account as ReferrerAccount } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(Number(q.limit ?? 100) || 100, 500) });
    return rows.map((r) => ({ ...r, amount: D(r.amount) }));
  }

  /** Called when an order's invoice is issued. Idempotent per (referrer, invoice). */
  async accrueForInvoice(tx: Prisma.TransactionClient, inv: { id: string; orgId: string; orderId: string | null; subtotal: unknown; number: string }, referrerId: string | null | undefined, actor: string) {
    if (!referrerId) return null;
    const r = await tx.referrer.findFirst({ where: { id: referrerId, orgId: inv.orgId } });
    if (!r || r.commissionType === "NONE") return null;
    const amount = commissionFor(r.commissionType, D(r.commissionValue), D(inv.subtotal as never));
    if (amount <= 0) return null;
    const row = await tx.referrerLedgerEntry.upsert({
      where: { referrerId_type_invoiceId: { referrerId: r.id, type: "COMMISSION_ACCRUED", invoiceId: inv.id } },
      create: { orgId: inv.orgId, referrerId: r.id, account: "COMMISSION", type: "COMMISSION_ACCRUED", amount, orderId: inv.orderId, invoiceId: inv.id, memo: inv.number, createdBy: actor }, update: {},
    });
    await this.audit.record({ orgId: inv.orgId, actorId: actor, action: "referrer.commission_accrued", entityType: "ReferrerLedgerEntry", entityId: row.id, meta: { referrerId: r.id } }, tx);
    return row;
  }

  /** Voiding an invoice reverses its commission. */
  async reverseForInvoice(tx: Prisma.TransactionClient, inv: { id: string; orgId: string }, actor: string) {
    const acc = await tx.referrerLedgerEntry.findFirst({ where: { orgId: inv.orgId, invoiceId: inv.id, type: "COMMISSION_ACCRUED" } });
    if (!acc) return;
    await tx.referrerLedgerEntry.upsert({
      where: { referrerId_type_invoiceId: { referrerId: acc.referrerId, type: "COMMISSION_REVERSED", invoiceId: inv.id } },
      create: { orgId: inv.orgId, referrerId: acc.referrerId, account: "COMMISSION", type: "COMMISSION_REVERSED", amount: D(acc.amount).toString().startsWith("-") ? acc.amount : -D(acc.amount), invoiceId: inv.id, orderId: acc.orderId, memo: "invoice voided", createdBy: actor }, update: {},
    });
  }

  /** Pays out accrued commission (cannot exceed the balance). Returns the new balance. */
  async payout(u: AuthUser, id: string, amount: number, memo?: string) {
    return this.post(u, id, "COMMISSION", "COMMISSION_PAYOUT", -round2(amount), memo, (bal) => { if (round2(amount) > bal) throw new UnprocessableEntityException({ code: "PAYOUT_EXCEEDS_BALANCE", balance: bal }); });
  }
  /** Credit sale to a referrer account: enforces the credit limit (no limit configured => credit disabled). */
  async creditCharge(u: AuthUser, id: string, amount: number, memo?: string, orderId?: string) {
    const r = await this.mustGet(u.orgId, id);
    if (r.creditLimit == null) throw new UnprocessableEntityException({ code: "CREDIT_NOT_ENABLED" });
    return this.post(u, id, "CREDIT", "CREDIT_CHARGE", round2(amount), memo, (bal) => { if (bal + round2(amount) > D(r.creditLimit!)) throw new UnprocessableEntityException({ code: "CREDIT_LIMIT_EXCEEDED", balance: bal, limit: D(r.creditLimit!) }); }, orderId);
  }
  async creditPayment(u: AuthUser, id: string, amount: number, memo?: string) {
    return this.post(u, id, "CREDIT", "CREDIT_PAYMENT", -round2(amount), memo, (bal) => { if (round2(amount) > bal) throw new UnprocessableEntityException({ code: "PAYMENT_EXCEEDS_BALANCE", balance: bal }); });
  }
  async adjust(u: AuthUser, id: string, account: ReferrerAccount, amount: number, memo: string) {
    if (!amount) throw new BadRequestException({ code: "AMOUNT_INVALID" });
    return this.post(u, id, account, "ADJUSTMENT", round2(amount), memo, () => undefined);
  }

  private async post(u: AuthUser, id: string, account: ReferrerAccount, type: string, amount: number, memo: string | undefined, check: (balance: number) => void, orderId?: string) {
    if (!Number.isFinite(amount) || amount === 0) throw new BadRequestException({ code: "AMOUNT_INVALID" });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Referrer" WHERE id = ${id} AND "orgId" = ${u.orgId} FOR UPDATE`;
      if (!(await tx.referrer.findFirst({ where: { id, orgId: u.orgId } }))) throw new NotFoundException({ code: "REFERRER_NOT_FOUND" });
      const sum = await tx.referrerLedgerEntry.aggregate({ where: { orgId: u.orgId, referrerId: id, account }, _sum: { amount: true } });
      const bal = round2(D(sum._sum.amount ?? 0));
      check(bal);
      const row = await tx.referrerLedgerEntry.create({ data: { orgId: u.orgId, referrerId: id, account, type, amount, memo, orderId, createdBy: u.staffId } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `referrer.${type.toLowerCase()}`, entityType: "ReferrerLedgerEntry", entityId: row.id, meta: { referrerId: id } }, tx);
      return { entry: { ...row, amount: D(row.amount) }, balance: round2(bal + amount) };
    });
  }

  /** Commission statement (CSV-friendly rows) per referrer for a period. */
  async statement(u: AuthUser, q: { from?: string; to?: string }) {
    const rows = await this.prisma.referrerLedgerEntry.findMany({ where: { orgId: u.orgId, account: "COMMISSION", ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}) }, include: { referrer: { select: { name: true } } } });
    const by = new Map<string, { referrerId: string; referrer: string; accrued: number; reversed: number; paid: number }>();
    for (const r of rows) {
      const e = by.get(r.referrerId) ?? { referrerId: r.referrerId, referrer: r.referrer.name, accrued: 0, reversed: 0, paid: 0 };
      const a = D(r.amount);
      if (r.type === "COMMISSION_ACCRUED" || (r.type === "ADJUSTMENT" && a > 0)) e.accrued = round2(e.accrued + a);
      else if (r.type === "COMMISSION_REVERSED" || (r.type === "ADJUSTMENT" && a < 0)) e.reversed = round2(e.reversed + a);
      else if (r.type === "COMMISSION_PAYOUT") e.paid = round2(e.paid + a);
      by.set(r.referrerId, e);
    }
    return [...by.values()].map((e) => ({ ...e, balance: round2(e.accrued + e.reversed + e.paid) })).sort((a, b) => b.balance - a.balance);
  }

  /** Doctor portal (public, token): released reports of the doctor's referred patients whose consent allows the portal. */
  async portalOrders(token: string) {
    const r = await this.prisma.referrer.findUnique({ where: { portalTokenHash: sha256(token) } });
    if (!r || !r.active) throw new NotFoundException({ code: "PORTAL_NOT_FOUND" });
    const orders = await this.prisma.labOrder.findMany({
      where: { orgId: r.orgId, referrerId: r.id, status: { in: ["RELEASED", "VALIDATED", "PARTIALLY_RESULTED", "AWAITING_VALIDATION", "IN_LAB", "COLLECTED", "AWAITING_COLLECTION"] } }, orderBy: { createdAt: "desc" }, take: 100,
      select: { id: true, orderNumber: true, status: true, priority: true, createdAt: true, consentShareChannels: true, patient: { select: { fullName: true, sex: true, dateOfBirth: true } }, items: { select: { test: { select: { code: true, nameEn: true, nameAr: true } } } }, reports: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, signedAt: true } } },
    });
    return {
      referrer: { name: r.name, kind: r.kind },
      orders: orders.map((o) => {
        const consented = o.consentShareChannels.includes("REFERRER_PORTAL");
        return { id: o.id, orderNumber: o.orderNumber, status: o.status, priority: o.priority, createdAt: o.createdAt, patient: o.patient.fullName, tests: o.items.map((i) => i.test.nameEn), consented, report: consented && o.status === "RELEASED" ? o.reports[0] ?? null : null };
      }),
    };
  }

  async portalReport(token: string, orderId: string) {
    const r = await this.prisma.referrer.findUnique({ where: { portalTokenHash: sha256(token) } });
    if (!r || !r.active) throw new NotFoundException({ code: "PORTAL_NOT_FOUND" });
    const o = await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId: r.orgId, referrerId: r.id } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    if (!o.consentShareChannels.includes("REFERRER_PORTAL")) throw new ConflictException({ code: "CONSENT_REQUIRED", channels: ["REFERRER_PORTAL"] });
    const rv = await this.prisma.reportVersion.findFirst({ where: { orderId, orgId: r.orgId, releases: { some: {} } }, orderBy: { version: "desc" } });
    if (!rv) throw new NotFoundException({ code: "REPORT_NOT_RELEASED" });
    return { orgId: r.orgId, reportId: rv.id };
  }
}
