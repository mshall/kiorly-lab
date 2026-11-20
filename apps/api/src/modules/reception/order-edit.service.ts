import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, round2 } from "../../common/db";
import { OrderStatusService } from "../../common/order-status.service";
import { KERNEL_PRICE_BOOK, type PriceBookPort } from "../../kernel-adapter/ports";
import { PrismaService } from "../../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { SpecimensService } from "../specimens/specimens.service";
import { isIcdCode } from "./icd";

export interface OrderPatch {
  priority?: "ROUTINE" | "URGENT" | "STAT"; clinicalInfo?: string | null; icdCodes?: string[]; fastingConfirmed?: boolean | null;
  referringDoctorName?: string | null; referringDoctorPhone?: string | null; referrerId?: string | null; b2bAccountId?: string | null; reason?: string;
}

const EDITABLE = ["AWAITING_COLLECTION", "COLLECTED", "IN_LAB", "PARTIALLY_RESULTED", "AWAITING_VALIDATION", "VALIDATED"];
const LOCKED_AFTER_INVOICE = ["b2bAccountId"] as const;

/** M2: audited order edit (field-level revision history), add/remove tests before work starts, cancel with a reason. */
@Injectable()
export class OrderEditService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(SpecimensService) private readonly specimens: SpecimensService,
    @Inject(OrderStatusService) private readonly orderStatus: OrderStatusService,
    @Inject(KERNEL_PRICE_BOOK) private readonly prices: PriceBookPort,
  ) {}

  private async revise(tx: Prisma.TransactionClient, u: AuthUser, orderId: string, changes: Record<string, unknown>, reason?: string) {
    const o = await tx.labOrder.update({ where: { id: orderId }, data: { revision: { increment: 1 } } });
    await tx.orderRevision.create({ data: { orgId: u.orgId, orderId, revision: o.revision, changedBy: u.staffId, changes: changes as Prisma.InputJsonValue, reason } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "order.edit", entityType: "LabOrder", entityId: orderId, meta: { revision: o.revision, fields: Object.keys(changes) } }, tx);
    return o.revision;
  }

  async edit(u: AuthUser, orderId: string, p: OrderPatch) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, include: { invoices: { where: { status: { not: "VOID" } }, select: { id: true } } } });
      if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
      if (!EDITABLE.includes(o.status)) throw new ConflictException({ code: "ORDER_NOT_EDITABLE", status: o.status });
      if (p.icdCodes?.some((c) => !isIcdCode(c))) throw new BadRequestException({ code: "ICD_INVALID" });
      if (o.invoices.length) for (const k of LOCKED_AFTER_INVOICE) if (p[k] !== undefined && p[k] !== o[k]) throw new ConflictException({ code: "ORDER_INVOICED", message: "void the invoice before changing the payer" });
      const data: Prisma.LabOrderUncheckedUpdateInput = {};
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      const set = <K extends keyof OrderPatch & keyof typeof o>(k: K, v: unknown) => { if (v === undefined) return; const cur = o[k] as unknown; if (JSON.stringify(cur) === JSON.stringify(v)) return; (data as Record<string, unknown>)[k] = v; changes[k] = { from: cur ?? null, to: v }; };
      set("priority", p.priority);
      set("clinicalInfo", p.clinicalInfo === undefined ? undefined : p.clinicalInfo);
      set("icdCodes", p.icdCodes ? [...new Set(p.icdCodes)] : undefined);
      set("fastingConfirmed", p.fastingConfirmed);
      set("referringDoctorName", p.referringDoctorName);
      set("referringDoctorPhone", p.referringDoctorPhone);
      if (p.referrerId !== undefined) {
        if (p.referrerId && !(await tx.referrer.findFirst({ where: { id: p.referrerId, orgId: u.orgId, active: true } }))) throw new NotFoundException({ code: "REFERRER_NOT_FOUND" });
        set("referrerId", p.referrerId);
      }
      if (p.b2bAccountId !== undefined) {
        if (p.b2bAccountId && !(await tx.b2bAccount.findFirst({ where: { id: p.b2bAccountId, orgId: u.orgId, active: true } }))) throw new NotFoundException({ code: "B2B_ACCOUNT_NOT_FOUND" });
        set("b2bAccountId", p.b2bAccountId);
      }
      if (!Object.keys(changes).length) return;
      // PHI-bearing free text is stored in the revision but only the fact of change in the audit log
      await tx.labOrder.update({ where: { id: orderId }, data });
      await this.revise(tx, u, orderId, changes, p.reason);
    });
    return this.orders.get(u.orgId, orderId, u);
  }

  async revisions(u: AuthUser, orderId: string) {
    if (!(await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, select: { id: true } }))) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    return this.prisma.orderRevision.findMany({ where: { orgId: u.orgId, orderId }, orderBy: { revision: "desc" } });
  }

  /** Adds tests to an open order; new specimens are accessioned for them. Refused once invoiced (void the invoice first) or released. */
  async addTests(u: AuthUser, orderId: string, codes: string[]) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, include: { invoices: { where: { status: { not: "VOID" } }, select: { id: true } }, b2bAccount: true, items: { select: { testId: true, status: true } } } });
      if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
      if (!EDITABLE.includes(o.status) || o.status === "VALIDATED") throw new ConflictException({ code: "ORDER_NOT_EDITABLE", status: o.status });
      if (o.invoices.length) throw new ConflictException({ code: "ORDER_INVOICED", message: "void the invoice before adding tests" });
      const up = [...new Set(codes.map((c) => c.toUpperCase()))];
      const tests = await tx.testDefinition.findMany({ where: { orgId: u.orgId, code: { in: up }, active: true } });
      const unknown = up.filter((c) => !tests.some((t) => t.code === c));
      if (unknown.length) throw new UnprocessableEntityException({ code: "UNKNOWN_TESTS", codes: unknown });
      const dup = tests.filter((t) => o.items.some((i) => i.testId === t.id && i.status !== "CANCELLED"));
      if (dup.length) throw new ConflictException({ code: "TEST_ALREADY_ORDERED", codes: dup.map((d) => d.code) });
      for (const t of tests) {
        const price = await this.prices.resolve({ orgId: u.orgId, testId: t.id, priceListId: o.b2bAccount?.priceListId ?? null }, tx);
        await tx.orderItem.create({ data: { orderId, testId: t.id, price } });
      }
      await this.specimens.createForOrder(tx, { id: orderId, orgId: u.orgId, labId: o.labId });
      await this.revise(tx, u, orderId, { addedTests: { from: null, to: tests.map((t) => t.code) } });
      await this.orderStatus.refreshOrder(tx, orderId);
    });
    return this.orders.get(u.orgId, orderId, u);
  }

  /** Removes (cancels) a test that has no result yet. Packages cannot be split: the item must not belong to one. */
  async removeTest(u: AuthUser, orderId: string, itemId: string, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      const it = await tx.orderItem.findFirst({ where: { id: itemId, orderId, order: { orgId: u.orgId } }, include: { test: true, order: { include: { invoices: { where: { status: { not: "VOID" } }, select: { id: true } } } } } });
      if (!it) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
      if (it.order.invoices.length) throw new ConflictException({ code: "ORDER_INVOICED", message: "void the invoice before removing tests" });
      if (it.packageCode) throw new ConflictException({ code: "PACKAGE_ITEM_LOCKED", packageCode: it.packageCode });
      if (it.status !== "PENDING" || (await tx.result.count({ where: { orderItemId: itemId } }))) throw new ConflictException({ code: "ORDER_ITEM_STARTED" });
      await tx.orderItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });
      await this.revise(tx, u, orderId, { removedTest: { from: it.test.code, to: null }, price: { from: round2(D(it.price)), to: 0 } }, reason);
      await this.orderStatus.refreshOrder(tx, orderId);
    });
    return this.orders.get(u.orgId, orderId, u);
  }
}
