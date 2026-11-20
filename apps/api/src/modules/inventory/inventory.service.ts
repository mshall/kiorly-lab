import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, Optional, UnprocessableEntityException } from "@nestjs/common";
import { MobilePushService } from "../../adapters/mobile-push.adapter";
import type { InventoryCategory, InventoryLotStatus, Prisma } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, type Db, nextSequence, pad, round2 } from "../../common/db";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { allocateFefo, perTest, round3, round4, suggestQty, weightedAverage } from "./stock-math";

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
const yearSeq = async (db: Db, orgId: string, key: string, prefix: string) => { const y = new Date().getUTCFullYear(); return `${prefix}-${y}-${pad(await nextSequence(db, orgId, `${key}:${y}`), 6)}`; };

/** M6 inventory: reagents and consumables with lots/expiry, FEFO auto-deduction per test run, suppliers, POs, goods receipt, stock counts, cost per test. */
@Injectable()
export class InventoryService {
  private readonly log = new Logger(InventoryService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(MobilePushService) private readonly mobilePush?: MobilePushService,
  ) {}

  // ================================================================ suppliers
  suppliers(orgId: string) { return this.prisma.supplier.findMany({ where: { orgId, active: true }, orderBy: { name: "asc" } }); }
  async createSupplier(u: AuthUser, b: { name: string; contactName?: string; phone?: string; email?: string; address?: string; leadTimeDays?: number; paymentTermsDays?: number }) {
    if (await this.prisma.supplier.findFirst({ where: { orgId: u.orgId, name: b.name } })) throw new ConflictException({ code: "SUPPLIER_EXISTS" });
    const row = await this.prisma.supplier.create({ data: { orgId: u.orgId, ...b } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "supplier.create", entityType: "Supplier", entityId: row.id });
    return row;
  }
  async updateSupplier(u: AuthUser, id: string, b: Partial<{ name: string; contactName: string; phone: string; email: string; address: string; leadTimeDays: number; paymentTermsDays: number; active: boolean }>) {
    if (!(await this.prisma.supplier.findFirst({ where: { id, orgId: u.orgId } }))) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND" });
    const row = await this.prisma.supplier.update({ where: { id }, data: b });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "supplier.update", entityType: "Supplier", entityId: id });
    return row;
  }

  // ================================================================== items
  async createItem(u: AuthUser, b: { code: string; name: string; nameAr?: string; category?: InventoryCategory; unit?: string; reorderLevel?: number; reorderQty?: number; supplierId?: string; storageTemp?: string }) {
    const code = b.code.trim().toUpperCase();
    if (await this.prisma.inventoryItem.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "ITEM_CODE_EXISTS" });
    if (b.supplierId && !(await this.prisma.supplier.findFirst({ where: { id: b.supplierId, orgId: u.orgId } }))) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND" });
    const row = await this.prisma.inventoryItem.create({ data: { orgId: u.orgId, ...b, code } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "inventory.item_create", entityType: "InventoryItem", entityId: row.id });
    return this.itemView(row);
  }
  async updateItem(u: AuthUser, id: string, b: Partial<{ name: string; nameAr: string; category: InventoryCategory; unit: string; reorderLevel: number; reorderQty: number; supplierId: string | null; storageTemp: string; active: boolean }>) {
    if (!(await this.prisma.inventoryItem.findFirst({ where: { id, orgId: u.orgId } }))) throw new NotFoundException({ code: "ITEM_NOT_FOUND" });
    const row = await this.prisma.inventoryItem.update({ where: { id }, data: b });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "inventory.item_update", entityType: "InventoryItem", entityId: id, meta: { fields: Object.keys(b) } });
    return this.itemView(row);
  }
  private itemView<T extends { reorderLevel: unknown; reorderQty: unknown; avgUnitCost: unknown; lastUnitCost: unknown }>(i: T) {
    return { ...i, reorderLevel: D(i.reorderLevel as never), reorderQty: D(i.reorderQty as never), avgUnitCost: D(i.avgUnitCost as never), lastUnitCost: i.lastUnitCost == null ? null : D(i.lastUnitCost as never) };
  }

  /** Stock position per item (usable on-hand = ACTIVE lots not expired), below-reorder flag, expiry facts and value. */
  async stock(u: AuthUser, q: { labId?: string; search?: string; category?: string; low?: string }) {
    const items = await this.prisma.inventoryItem.findMany({ where: { orgId: u.orgId, active: true, ...(q.category ? { category: q.category as InventoryCategory } : {}), ...(q.search ? { OR: [{ code: { contains: q.search, mode: "insensitive" } }, { name: { contains: q.search, mode: "insensitive" } }] } : {}) }, include: { supplier: { select: { id: true, name: true } }, lots: { where: { ...(q.labId ? { labId: q.labId } : {}), qtyOnHand: { gt: 0 } } } }, orderBy: { code: "asc" } });
    const now = today();
    const rows = items.map((i) => {
      const usableLots = i.lots.filter((l) => l.status === "ACTIVE" && (!l.expiryDate || l.expiryDate.getTime() + 86_400_000 > Date.now()));
      const onHand = round3(usableLots.reduce((a, l) => a + D(l.qtyOnHand), 0));
      const expiredQty = round3(i.lots.filter((l) => l.expiryDate && l.expiryDate.getTime() + 86_400_000 <= Date.now()).reduce((a, l) => a + D(l.qtyOnHand), 0));
      const expiring = usableLots.filter((l) => l.expiryDate && l.expiryDate.getTime() - now.getTime() <= 30 * 86_400_000);
      const next = usableLots.map((l) => l.expiryDate).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      return { id: i.id, code: i.code, name: i.name, nameAr: i.nameAr, category: i.category, unit: i.unit, supplier: i.supplier, reorderLevel: D(i.reorderLevel), reorderQty: D(i.reorderQty), avgUnitCost: D(i.avgUnitCost), onHand, expiredQty, expiringLots: expiring.length, nextExpiry: next, lotCount: i.lots.length, value: round2(onHand * D(i.avgUnitCost)), low: onHand <= D(i.reorderLevel) };
    });
    return q.low === "true" ? rows.filter((r) => r.low) : rows;
  }

  async lots(u: AuthUser, itemId: string, labId?: string) {
    if (!(await this.prisma.inventoryItem.findFirst({ where: { id: itemId, orgId: u.orgId } }))) throw new NotFoundException({ code: "ITEM_NOT_FOUND" });
    const rows = await this.prisma.inventoryLot.findMany({ where: { orgId: u.orgId, itemId, ...(labId ? { labId } : {}) }, orderBy: [{ expiryDate: "asc" }, { receivedAt: "asc" }] });
    return rows.map((l) => ({ ...l, qtyReceived: D(l.qtyReceived), qtyOnHand: D(l.qtyOnHand), unitCost: D(l.unitCost), expired: Boolean(l.expiryDate && l.expiryDate.getTime() + 86_400_000 <= Date.now()) }));
  }

  async setLotStatus(u: AuthUser, lotId: string, status: "ACTIVE" | "QUARANTINE") {
    const l = await this.prisma.inventoryLot.findFirst({ where: { id: lotId, orgId: u.orgId } });
    if (!l) throw new NotFoundException({ code: "LOT_NOT_FOUND" });
    if (l.status === "DEPLETED") throw new ConflictException({ code: "LOT_DEPLETED" });
    const row = await this.prisma.inventoryLot.update({ where: { id: lotId }, data: { status } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `inventory.lot_${status.toLowerCase()}`, entityType: "InventoryLot", entityId: lotId });
    return row;
  }

  // ========================================================== stock movements
  private async move(tx: Prisma.TransactionClient, m: { orgId: string; labId: string; itemId: string; lotId?: string | null; type: "RECEIPT" | "CONSUMPTION" | "ADJUSTMENT" | "COUNT_VARIANCE" | "DISPOSAL"; qty: number; unitCost?: number; refType?: string; refId?: string; shortfall?: number; memo?: string; by: string }) {
    return tx.stockMovement.create({ data: { orgId: m.orgId, labId: m.labId, itemId: m.itemId, lotId: m.lotId ?? null, type: m.type, qty: m.qty, unitCost: m.unitCost, refType: m.refType, refId: m.refId, shortfall: m.shortfall ?? 0, memo: m.memo, createdBy: m.by } });
  }

  /** Manual adjustment (damage, found stock, correction): signed quantity on one lot, reason mandatory; never below zero. */
  async adjust(u: AuthUser, b: { lotId: string; qty: number; reason: string }) {
    if (!b.qty || b.reason.trim().length < 3) throw new BadRequestException({ code: "ADJUSTMENT_INVALID" });
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; itemId: string; labId: string; qtyOnHand: Prisma.Decimal }[]>`SELECT id, "itemId", "labId", "qtyOnHand" FROM "InventoryLot" WHERE id = ${b.lotId} AND "orgId" = ${u.orgId} FOR UPDATE`;
      const lot = rows[0];
      if (!lot) throw new NotFoundException({ code: "LOT_NOT_FOUND" });
      const next = round3(D(lot.qtyOnHand) + b.qty);
      if (next < 0) throw new UnprocessableEntityException({ code: "NEGATIVE_STOCK", onHand: D(lot.qtyOnHand) });
      await tx.inventoryLot.update({ where: { id: b.lotId }, data: { qtyOnHand: next, status: next === 0 ? "DEPLETED" : undefined } });
      const mv = await this.move(tx, { orgId: u.orgId, labId: lot.labId, itemId: lot.itemId, lotId: b.lotId, type: "ADJUSTMENT", qty: b.qty, memo: b.reason, by: u.staffId });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "inventory.adjust", entityType: "InventoryLot", entityId: b.lotId, meta: { qty: b.qty } }, tx);
      return { movementId: mv.id, qtyOnHand: next };
    });
  }

  /** Writes off all expired stock of the given lots (movement DISPOSAL). */
  async disposeExpired(u: AuthUser, labId?: string) {
    const lab = await resolveLabId(this.prisma, u, labId);
    return this.prisma.$transaction(async (tx) => {
      const lots = await tx.inventoryLot.findMany({ where: { orgId: u.orgId, labId: lab, qtyOnHand: { gt: 0 }, expiryDate: { lt: today() } } });
      for (const l of lots) {
        await tx.inventoryLot.update({ where: { id: l.id }, data: { qtyOnHand: 0, status: "EXPIRED" } });
        await this.move(tx, { orgId: u.orgId, labId: lab, itemId: l.itemId, lotId: l.id, type: "DISPOSAL", qty: -D(l.qtyOnHand), unitCost: D(l.unitCost), memo: "expired", by: u.staffId });
      }
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "inventory.dispose_expired", entityType: "InventoryLot", entityId: lots[0]?.id ?? "none", meta: { lots: lots.length } }, tx);
      return { disposed: lots.length, value: round2(lots.reduce((a, l) => a + D(l.qtyOnHand) * D(l.unitCost), 0)) };
    });
  }

  movements(u: AuthUser, q: { itemId?: string; type?: string; limit?: string }) {
    return this.prisma.stockMovement.findMany({ where: { orgId: u.orgId, ...(q.itemId ? { itemId: q.itemId } : {}), ...(q.type ? { type: q.type as never } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(Number(q.limit ?? 100) || 100, 500) })
      .then((rows) => rows.map((r) => ({ ...r, qty: D(r.qty), shortfall: D(r.shortfall), unitCost: r.unitCost == null ? null : D(r.unitCost) })));
  }

  // ==================================================== consumption (auto)
  async setRules(u: AuthUser, testId: string, rules: { itemId: string; qtyPerTest: number; wastagePercent?: number }[]) {
    if (!(await this.prisma.testDefinition.findFirst({ where: { id: testId, orgId: u.orgId } }))) throw new NotFoundException({ code: "TEST_NOT_FOUND" });
    const items = await this.prisma.inventoryItem.findMany({ where: { orgId: u.orgId, id: { in: rules.map((r) => r.itemId) } } });
    if (items.length !== new Set(rules.map((r) => r.itemId)).size) throw new NotFoundException({ code: "ITEM_NOT_FOUND" });
    await this.prisma.$transaction(async (tx) => {
      await tx.consumptionRule.deleteMany({ where: { orgId: u.orgId, testId } });
      for (const r of rules) await tx.consumptionRule.create({ data: { orgId: u.orgId, testId, itemId: r.itemId, qtyPerTest: r.qtyPerTest, wastagePercent: r.wastagePercent ?? 0 } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "inventory.rules_set", entityType: "TestDefinition", entityId: testId, meta: { rules: rules.length } }, tx);
    });
    return this.rules(u, testId);
  }
  async rules(u: AuthUser, testId?: string) {
    const rows = await this.prisma.consumptionRule.findMany({ where: { orgId: u.orgId, active: true, ...(testId ? { testId } : {}) }, include: { item: { select: { code: true, name: true, unit: true } } } });
    const tests = await this.prisma.testDefinition.findMany({ where: { id: { in: rows.map((r) => r.testId) } }, select: { id: true, code: true } });
    return rows.map((r) => ({ id: r.id, testId: r.testId, test: tests.find((t) => t.id === r.testId)?.code ?? null, item: r.item, itemId: r.itemId, qtyPerTest: D(r.qtyPerTest), wastagePercent: D(r.wastagePercent) }));
  }

  /**
   * Called by the results service when a test is run (first result of an order item, and for every rerun). Deducts the item quantities
   * first-expiry-first-out inside the caller's transaction. Idempotent per (refType, refId). Never blocks the bench: a shortfall is recorded
   * as a movement with `shortfall` > 0 and no lot, and audited, instead of refusing the result.
   */
  async consumeForRun(tx: Prisma.TransactionClient, r: { orgId: string; labId: string; testId: string; refType: string; refId: string; by: string }): Promise<{ cost: number; shortfalls: number }> {
    const rules = await tx.consumptionRule.findMany({ where: { orgId: r.orgId, testId: r.testId, active: true } });
    if (!rules.length) return { cost: 0, shortfalls: 0 };
    if (await tx.stockMovement.findFirst({ where: { orgId: r.orgId, type: "CONSUMPTION", refType: r.refType, refId: r.refId }, select: { id: true } })) return { cost: 0, shortfalls: 0 };
    let cost = 0;
    let shortfalls = 0;
    for (const rule of rules) {
      const needed = perTest(D(rule.qtyPerTest), D(rule.wastagePercent));
      const rows = await tx.$queryRaw<{ id: string; qtyOnHand: Prisma.Decimal; expiryDate: Date | null; unitCost: Prisma.Decimal; status: string }[]>`SELECT id, "qtyOnHand", "expiryDate", "unitCost", status FROM "InventoryLot" WHERE "orgId" = ${r.orgId} AND "itemId" = ${rule.itemId} AND "labId" = ${r.labId} AND "qtyOnHand" > 0 FOR UPDATE`;
      const { draws, shortfall } = allocateFefo(rows.map((x) => ({ id: x.id, qtyOnHand: D(x.qtyOnHand), expiryDate: x.expiryDate, unitCost: D(x.unitCost), status: x.status })), needed);
      for (const d of draws) {
        const lot = rows.find((x) => x.id === d.lotId)!;
        const left = round3(D(lot.qtyOnHand) - d.qty);
        await tx.inventoryLot.update({ where: { id: d.lotId }, data: { qtyOnHand: left, ...(left <= 0 ? { status: "DEPLETED" } : {}) } });
        await this.move(tx, { orgId: r.orgId, labId: r.labId, itemId: rule.itemId, lotId: d.lotId, type: "CONSUMPTION", qty: -d.qty, unitCost: d.unitCost, refType: r.refType, refId: r.refId, by: r.by });
        cost += d.qty * d.unitCost;
      }
      if (shortfall > 0) {
        const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: rule.itemId } });
        await this.move(tx, { orgId: r.orgId, labId: r.labId, itemId: rule.itemId, type: "CONSUMPTION", qty: 0, unitCost: D(item.avgUnitCost), refType: r.refType, refId: r.refId, shortfall, memo: "no usable stock", by: r.by });
        cost += shortfall * D(item.avgUnitCost);
        shortfalls++;
        await this.mobilePush?.notifyRoles(r.orgId, ["BRANCH_MANAGER", "SUPERVISOR", "OWNER"], "REAGENT_LOW_STOCK", { item: item.name }, { relatedType: "InventoryItem", relatedId: item.id, deepLink: "kiorlywork://lab/reagents" }, tx);
        await this.audit.record({ orgId: r.orgId, actorId: r.by, action: "inventory.shortfall", entityType: "InventoryItem", entityId: rule.itemId, meta: { shortfall, testId: r.testId } }, tx);
      }
    }
    return { cost: round4(cost), shortfalls };
  }

  // ======================================================== purchase orders
  async createPo(u: AuthUser, b: { labId?: string; supplierId: string; expectedAt?: string; notes?: string; lines: { itemId: string; qty: number; unitCost: number }[] }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    if (!(await this.prisma.supplier.findFirst({ where: { id: b.supplierId, orgId: u.orgId } }))) throw new NotFoundException({ code: "SUPPLIER_NOT_FOUND" });
    const items = await this.prisma.inventoryItem.findMany({ where: { orgId: u.orgId, id: { in: b.lines.map((l) => l.itemId) } } });
    if (items.length !== new Set(b.lines.map((l) => l.itemId)).size) throw new NotFoundException({ code: "ITEM_NOT_FOUND" });
    return this.prisma.$transaction(async (tx) => {
      const number = await yearSeq(tx, u.orgId, "po", "PO");
      const total = round2(b.lines.reduce((a, l) => a + l.qty * l.unitCost, 0));
      const po = await tx.purchaseOrder.create({ data: { orgId: u.orgId, labId, number, supplierId: b.supplierId, expectedAt: b.expectedAt ? new Date(b.expectedAt) : null, notes: b.notes, total, createdBy: u.staffId, lines: { create: b.lines.map((l) => ({ orgId: u.orgId, itemId: l.itemId, qtyOrdered: l.qty, unitCost: l.unitCost })) } } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "po.create", entityType: "PurchaseOrder", entityId: po.id, meta: { total } }, tx);
      return this.poView(tx, u.orgId, po.id);
    });
  }
  private async poView(db: Db, orgId: string, id: string) {
    const po = await db.purchaseOrder.findFirst({ where: { id, orgId }, include: { supplier: { select: { id: true, name: true } }, lines: { include: { item: { select: { code: true, name: true, unit: true } } } } } });
    if (!po) throw new NotFoundException({ code: "PO_NOT_FOUND" });
    return { ...po, total: D(po.total), lines: po.lines.map((l) => ({ ...l, qtyOrdered: D(l.qtyOrdered), qtyReceived: D(l.qtyReceived), unitCost: D(l.unitCost) })) };
  }
  getPo(u: AuthUser, id: string) { return this.poView(this.prisma, u.orgId, id); }
  async pos(u: AuthUser, q: { status?: string }) {
    const rows = await this.prisma.purchaseOrder.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as never } : {}) }, include: { supplier: { select: { name: true } }, _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((r) => ({ ...r, total: D(r.total), lineCount: r._count.lines }));
  }
  async setPoStatus(u: AuthUser, id: string, to: "SENT" | "CANCELLED") {
    const po = await this.prisma.purchaseOrder.findFirst({ where: { id, orgId: u.orgId } });
    if (!po) throw new NotFoundException({ code: "PO_NOT_FOUND" });
    const ok = to === "SENT" ? po.status === "DRAFT" : ["DRAFT", "SENT"].includes(po.status);
    if (!ok) throw new ConflictException({ code: "PO_ILLEGAL_TRANSITION", from: po.status, to });
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: to, ...(to === "SENT" ? { sentAt: new Date() } : {}) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `po.${to.toLowerCase()}`, entityType: "PurchaseOrder", entityId: id });
    return this.poView(this.prisma, u.orgId, id);
  }

  /** Items at/below their reorder level grouped by preferred supplier, with suggested quantities and estimated cost. */
  async reorderSuggestions(u: AuthUser, labId?: string) {
    const stock = await this.stock(u, { labId });
    const items = await this.prisma.inventoryItem.findMany({ where: { orgId: u.orgId, id: { in: stock.filter((s) => s.low).map((s) => s.id) } }, include: { supplier: true } });
    const open = await this.prisma.purchaseOrderLine.groupBy({ by: ["itemId"], where: { orgId: u.orgId, po: { status: { in: ["DRAFT", "SENT", "PARTIAL"] } } }, _sum: { qtyOrdered: true, qtyReceived: true } });
    return stock.filter((s) => s.low).map((s) => {
      const it = items.find((i) => i.id === s.id)!;
      const pending = open.find((o) => o.itemId === s.id);
      const onOrder = round3(D(pending?._sum.qtyOrdered ?? 0) - D(pending?._sum.qtyReceived ?? 0));
      const qty = suggestQty(s.onHand + onOrder, s.reorderLevel, s.reorderQty);
      return { itemId: s.id, code: s.code, name: s.name, unit: s.unit, onHand: s.onHand, onOrder, reorderLevel: s.reorderLevel, suggestedQty: qty, supplier: it.supplier ? { id: it.supplier.id, name: it.supplier.name, leadTimeDays: it.supplier.leadTimeDays } : null, estimatedCost: round2(qty * D(it.lastUnitCost ?? it.avgUnitCost)) };
    }).filter((r) => r.suggestedQty > 0);
  }

  // ============================================================ goods receipt
  async receive(u: AuthUser, b: { labId?: string; poId?: string; supplierId?: string; invoiceRef?: string; note?: string; lines: { itemId: string; lotNumber: string; expiryDate?: string; qty: number; unitCost: number; location?: string }[] }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    return this.prisma.$transaction(async (tx) => {
      let supplierId = b.supplierId;
      const po = b.poId ? await tx.purchaseOrder.findFirst({ where: { id: b.poId, orgId: u.orgId }, include: { lines: true } }) : null;
      if (b.poId) {
        if (!po) throw new NotFoundException({ code: "PO_NOT_FOUND" });
        if (!["SENT", "PARTIAL"].includes(po.status)) throw new ConflictException({ code: "PO_NOT_RECEIVABLE", status: po.status });
        supplierId = po.supplierId;
      }
      if (!supplierId) throw new BadRequestException({ code: "SUPPLIER_REQUIRED" });
      const number = await yearSeq(tx, u.orgId, "grn", "GRN");
      const gr = await tx.goodsReceipt.create({ data: { orgId: u.orgId, labId, number, poId: po?.id, supplierId, invoiceRef: b.invoiceRef, note: b.note, receivedBy: u.staffId } });
      for (const l of b.lines) {
        if (!(l.qty > 0) || l.unitCost < 0) throw new BadRequestException({ code: "RECEIPT_LINE_INVALID" });
        const item = await tx.inventoryItem.findFirst({ where: { id: l.itemId, orgId: u.orgId } });
        if (!item) throw new NotFoundException({ code: "ITEM_NOT_FOUND" });
        const exp = l.expiryDate ? new Date(l.expiryDate) : null;
        if (exp && exp.getTime() + 86_400_000 <= Date.now()) throw new UnprocessableEntityException({ code: "RECEIVING_EXPIRED_LOT", lotNumber: l.lotNumber });
        if (po && !po.lines.some((pl) => pl.itemId === l.itemId)) throw new UnprocessableEntityException({ code: "ITEM_NOT_ON_PO", itemId: l.itemId });
        const onHandRows = await tx.inventoryLot.aggregate({ where: { orgId: u.orgId, itemId: l.itemId, status: { in: ["ACTIVE", "QUARANTINE"] } }, _sum: { qtyOnHand: true } });
        const onHand = D(onHandRows._sum.qtyOnHand ?? 0);
        const existing = await tx.inventoryLot.findUnique({ where: { itemId_labId_lotNumber: { itemId: l.itemId, labId, lotNumber: l.lotNumber } } });
        if (existing && exp && existing.expiryDate && existing.expiryDate.getTime() !== exp.getTime()) throw new ConflictException({ code: "LOT_EXPIRY_MISMATCH", lotNumber: l.lotNumber });
        const lot = existing
          ? await tx.inventoryLot.update({ where: { id: existing.id }, data: { qtyOnHand: { increment: l.qty }, qtyReceived: { increment: l.qty }, unitCost: l.unitCost, status: existing.status === "DEPLETED" ? "ACTIVE" : existing.status } })
          : await tx.inventoryLot.create({ data: { orgId: u.orgId, itemId: l.itemId, labId, lotNumber: l.lotNumber, expiryDate: exp, qtyReceived: l.qty, qtyOnHand: l.qty, unitCost: l.unitCost, location: l.location } });
        await tx.goodsReceiptLine.create({ data: { orgId: u.orgId, receiptId: gr.id, itemId: l.itemId, lotId: lot.id, lotNumber: l.lotNumber, expiryDate: exp, qty: l.qty, unitCost: l.unitCost } });
        await this.move(tx, { orgId: u.orgId, labId, itemId: l.itemId, lotId: lot.id, type: "RECEIPT", qty: l.qty, unitCost: l.unitCost, refType: "GoodsReceipt", refId: gr.id, by: u.staffId });
        await tx.inventoryItem.update({ where: { id: l.itemId }, data: { lastUnitCost: l.unitCost, avgUnitCost: weightedAverage(onHand, D(item.avgUnitCost), l.qty, l.unitCost) } });
        if (po) await tx.purchaseOrderLine.updateMany({ where: { poId: po.id, itemId: l.itemId }, data: { qtyReceived: { increment: l.qty } } });
      }
      if (po) {
        const lines = await tx.purchaseOrderLine.findMany({ where: { poId: po.id } });
        const full = lines.every((x) => D(x.qtyReceived) >= D(x.qtyOrdered));
        await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: full ? "RECEIVED" : "PARTIAL" } });
      }
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "inventory.receive", entityType: "GoodsReceipt", entityId: gr.id, meta: { lines: b.lines.length } }, tx);
      return tx.goodsReceipt.findUniqueOrThrow({ where: { id: gr.id }, include: { lines: true } });
    });
  }

  receipts(u: AuthUser) { return this.prisma.goodsReceipt.findMany({ where: { orgId: u.orgId }, include: { _count: { select: { lines: true } } }, orderBy: { receivedAt: "desc" }, take: 100 }); }

  // ================================================================= counts
  async startCount(u: AuthUser, b: { labId?: string; note?: string }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    return this.prisma.$transaction(async (tx) => {
      if (await tx.stockCount.findFirst({ where: { orgId: u.orgId, labId, status: "OPEN" } })) throw new ConflictException({ code: "COUNT_ALREADY_OPEN" });
      const lots = await tx.inventoryLot.findMany({ where: { orgId: u.orgId, labId, status: { in: ["ACTIVE", "QUARANTINE"] } } });
      const number = await yearSeq(tx, u.orgId, "cnt", "CNT");
      const c = await tx.stockCount.create({ data: { orgId: u.orgId, labId, number, note: b.note, createdBy: u.staffId, lines: { create: lots.map((l) => ({ orgId: u.orgId, itemId: l.itemId, lotId: l.id, systemQty: l.qtyOnHand })) } } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "stock_count.start", entityType: "StockCount", entityId: c.id }, tx);
      return this.countView(tx, u.orgId, c.id);
    });
  }
  private async countView(db: Db, orgId: string, id: string) {
    const c = await db.stockCount.findFirst({ where: { id, orgId }, include: { lines: true } });
    if (!c) throw new NotFoundException({ code: "COUNT_NOT_FOUND" });
    const items = await db.inventoryItem.findMany({ where: { id: { in: c.lines.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, unit: true } });
    const lots = await db.inventoryLot.findMany({ where: { id: { in: c.lines.map((l) => l.lotId) } }, select: { id: true, lotNumber: true, expiryDate: true } });
    return { ...c, lines: c.lines.map((l) => ({ ...l, systemQty: D(l.systemQty), countedQty: l.countedQty == null ? null : D(l.countedQty), variance: l.variance == null ? null : D(l.variance), item: items.find((i) => i.id === l.itemId) ?? null, lot: lots.find((x) => x.id === l.lotId) ?? null })) };
  }
  getCount(u: AuthUser, id: string) { return this.countView(this.prisma, u.orgId, id); }
  counts(u: AuthUser) { return this.prisma.stockCount.findMany({ where: { orgId: u.orgId }, include: { _count: { select: { lines: true } } }, orderBy: { createdAt: "desc" }, take: 50 }); }
  async setCounted(u: AuthUser, id: string, lines: { lotId: string; countedQty: number }[]) {
    const c = await this.prisma.stockCount.findFirst({ where: { id, orgId: u.orgId } });
    if (!c) throw new NotFoundException({ code: "COUNT_NOT_FOUND" });
    if (c.status !== "OPEN") throw new ConflictException({ code: "COUNT_COMPLETED" });
    for (const l of lines) {
      if (!(l.countedQty >= 0)) throw new BadRequestException({ code: "COUNT_INVALID" });
      const n = await this.prisma.stockCountLine.updateMany({ where: { countId: id, lotId: l.lotId }, data: { countedQty: l.countedQty } });
      if (!n.count) throw new NotFoundException({ code: "COUNT_LINE_NOT_FOUND", lotId: l.lotId });
    }
    return this.getCount(u, id);
  }
  /** Completing posts COUNT_VARIANCE movements for every counted line whose count differs from the system quantity at completion time. */
  async completeCount(u: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.stockCount.findFirst({ where: { id, orgId: u.orgId }, include: { lines: true } });
      if (!c) throw new NotFoundException({ code: "COUNT_NOT_FOUND" });
      if (c.status !== "OPEN") throw new ConflictException({ code: "COUNT_COMPLETED" });
      let variances = 0;
      for (const l of c.lines) {
        if (l.countedQty == null) continue;
        const rows = await tx.$queryRaw<{ qtyOnHand: Prisma.Decimal; unitCost: Prisma.Decimal }[]>`SELECT "qtyOnHand", "unitCost" FROM "InventoryLot" WHERE id = ${l.lotId} FOR UPDATE`;
        const now = D(rows[0]!.qtyOnHand);
        const diff = round3(D(l.countedQty) - now);
        await tx.stockCountLine.update({ where: { id: l.id }, data: { variance: diff } });
        if (diff === 0) continue;
        await tx.inventoryLot.update({ where: { id: l.lotId }, data: { qtyOnHand: D(l.countedQty), status: D(l.countedQty) === 0 ? "DEPLETED" : undefined } });
        await this.move(tx, { orgId: u.orgId, labId: c.labId, itemId: l.itemId, lotId: l.lotId, type: "COUNT_VARIANCE", qty: diff, unitCost: D(rows[0]!.unitCost), refType: "StockCount", refId: c.id, memo: c.number, by: u.staffId });
        variances++;
      }
      await tx.stockCount.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date(), completedBy: u.staffId } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "stock_count.complete", entityType: "StockCount", entityId: id, meta: { variances } }, tx);
      return this.countView(tx, u.orgId, id);
    });
  }

  // ============================================================ cost per test
  /** Theoretical reagent cost per test from the consumption rules (average unit cost) against the list price, plus actual consumption cost per test from the ledger. */
  async costPerTest(u: AuthUser, q: { from?: string; to?: string }) {
    const rules = await this.prisma.consumptionRule.findMany({ where: { orgId: u.orgId, active: true }, include: { item: true } });
    const tests = await this.prisma.testDefinition.findMany({ where: { id: { in: [...new Set(rules.map((r) => r.testId))] } }, select: { id: true, code: true, nameEn: true, price: true } });
    const range = q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {};
    const moves = await this.prisma.stockMovement.findMany({ where: { orgId: u.orgId, type: "CONSUMPTION", refType: "RUN", ...range } });
    const actualByRun = new Map<string, number>();
    for (const m of moves) actualByRun.set(m.refId!, (actualByRun.get(m.refId!) ?? 0) + (D(m.qty) !== 0 ? -D(m.qty) : D(m.shortfall)) * D(m.unitCost ?? 0));
    const itemKeys = [...actualByRun.keys()].filter((k) => k.startsWith("item:")).map((k) => k.slice(5));
    const rerunKeys = [...actualByRun.keys()].filter((k) => k.startsWith("rerun:")).map((k) => k.slice(6));
    const reruns = rerunKeys.length ? await this.prisma.rerunRequest.findMany({ where: { id: { in: rerunKeys } }, select: { id: true, orderItemId: true } }) : [];
    const itemRows = await this.prisma.orderItem.findMany({ where: { id: { in: [...itemKeys, ...reruns.map((r) => r.orderItemId)] } }, select: { id: true, testId: true } });
    const testOfKey = (k: string) => (k.startsWith("item:") ? itemRows.find((i) => i.id === k.slice(5))?.testId : itemRows.find((i) => i.id === reruns.find((r) => r.id === k.slice(6))?.orderItemId)?.testId);
    return tests.map((t) => {
      const rs = rules.filter((r) => r.testId === t.id);
      const cost = round4(rs.reduce((a, r) => a + perTest(D(r.qtyPerTest), D(r.wastagePercent)) * D(r.item.avgUnitCost), 0));
      const price = D(t.price);
      const runKeys = [...actualByRun.keys()].filter((k) => testOfKey(k) === t.id);
      const actualTotal = round2(runKeys.reduce((a, k) => a + (actualByRun.get(k) ?? 0), 0));
      return { testId: t.id, code: t.code, name: t.nameEn, price, reagentCost: cost, margin: round2(price - cost), marginPercent: price > 0 ? round2(((price - cost) / price) * 100) : null, components: rs.map((r) => ({ item: r.item.code, qty: perTest(D(r.qtyPerTest), D(r.wastagePercent)), unitCost: D(r.item.avgUnitCost) })), runs: runKeys.length, actualCost: actualTotal };
    }).sort((a, b) => (a.marginPercent ?? 0) - (b.marginPercent ?? 0));
  }

  async summary(u: AuthUser) {
    const stock = await this.stock(u, {});
    const shortfalls = await this.prisma.stockMovement.count({ where: { orgId: u.orgId, shortfall: { gt: 0 }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
    return { items: stock.length, lowStock: stock.filter((s) => s.low).length, expiringLots: stock.reduce((a, s) => a + s.expiringLots, 0), expiredQty: stock.filter((s) => s.expiredQty > 0).length, stockValue: round2(stock.reduce((a, s) => a + s.value, 0)), shortfalls30d: shortfalls, openPos: await this.prisma.purchaseOrder.count({ where: { orgId: u.orgId, status: { in: ["DRAFT", "SENT", "PARTIAL"] } } }) };
  }

  /** Best-effort wrapper for callers that must never fail because of stock (result entry). */
  async consumeSafely(tx: Prisma.TransactionClient, r: Parameters<InventoryService["consumeForRun"]>[1]) {
    try { return await this.consumeForRun(tx, r); } catch (e) { this.log.error(`consumption failed for ${r.refType}:${r.refId}: ${(e as Error).message}`); throw e; }
  }
}
void (null as unknown as InventoryLotStatus);
