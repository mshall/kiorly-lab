import { eventSource, isExternalSource } from "./order-source";
import { Inject, Injectable } from "@nestjs/common";
import type { OrderItemStatus } from "@prisma/client";
import { OutboxService } from "../outbox/outbox.service";
import { PrismaService } from "../prisma/prisma.service";
import type { Db } from "./db";
import { ITEM_RANK, deriveOrderStatus } from "./order-status";

@Injectable()
export class OrderStatusService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Recomputes one item's status from its current (non-superseded) results. */
  async refreshItem(db: Db, orderItemId: string): Promise<OrderItemStatus> {
    const item = await db.orderItem.findUniqueOrThrow({ where: { id: orderItemId }, include: { test: { include: { analytes: true } }, results: true } });
    if (item.status === "CANCELLED") return "CANCELLED";
    const expected = item.test.analytes.map((a) => a.analyteId);
    const current = new Map<string, OrderItemStatus>();
    for (const r of item.results.filter((x) => x.status !== "CORRECTED" && x.status !== "REJECTED")) {
      const st: OrderItemStatus = r.status === "RELEASED" ? "RELEASED" : r.status === "MEDICAL_VALIDATED" ? "VALIDATED" : "RESULTED";
      const prev = current.get(r.analyteId);
      if (!prev || ITEM_RANK[st] > ITEM_RANK[prev]) current.set(r.analyteId, st);
    }
    let next: OrderItemStatus;
    if (expected.length > 0 && expected.every((a) => current.has(a))) {
      next = expected.map((a) => current.get(a)!).reduce((min, s) => (ITEM_RANK[s] < ITEM_RANK[min] ? s : min));
    } else if (current.size > 0) {
      next = "IN_PROGRESS";
    } else {
      const sp = item.specimenId ? await db.specimen.findUnique({ where: { id: item.specimenId } }) : null;
      next = sp && (sp.status === "PROCESSING" || sp.status === "RECEIVED") ? "IN_PROGRESS" : "PENDING";
    }
    if (next !== item.status) await db.orderItem.update({ where: { id: orderItemId }, data: { status: next } });
    return next;
  }

  /** Recomputes the order status and, for externally sourced orders (Kiorex bookings), emits LabOrderStatusChanged via the outbox. */
  async refreshOrder(db: Db, orderId: string): Promise<string> {
    const order = await db.labOrder.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, specimens: true } });
    const next = deriveOrderStatus({ cancelled: order.status === "CANCELLED", items: order.items.map((i) => i.status), specimens: order.specimens.map((s) => s.status), current: order.status });
    if (next !== order.status) {
      await db.labOrder.update({ where: { id: orderId }, data: { status: next } });
      if (isExternalSource(order.source)) {
        await this.outbox.enqueue(
          {
            orgId: order.orgId, type: "LabOrderStatusChanged", aggregateType: "LabOrder", aggregateId: order.id,
            data: { orderId: order.id, orderNumber: order.orderNumber, ...eventSource(order.source), sourceRef: order.sourceRef, previousStatus: order.status, nextStatus: next },
            eventId: `evt_ordst_${order.id}_${next}`,
          },
          db,
        );
      }
    }
    return next;
  }
}
