import type { OrderItemStatus, OrderStatus, SpecimenStatus } from "@prisma/client";

export const ITEM_RANK: Record<OrderItemStatus, number> = { PENDING: 0, IN_PROGRESS: 1, RESULTED: 2, VALIDATED: 3, RELEASED: 4, CANCELLED: -1 };

/** Derives the order status from its items and specimens (single source of truth; no manual status writes). */
export function deriveOrderStatus(input: { cancelled: boolean; items: OrderItemStatus[]; specimens: SpecimenStatus[]; current: OrderStatus }): OrderStatus {
  if (input.cancelled) return "CANCELLED";
  const active = input.items.filter((s) => s !== "CANCELLED");
  if (input.items.length > 0 && active.length === 0) return "CANCELLED";
  if (active.length > 0) {
    const ranks = active.map((s) => ITEM_RANK[s]);
    if (ranks.every((r) => r === 4)) return "RELEASED";
    if (ranks.every((r) => r >= 3)) return "VALIDATED";
    if (ranks.every((r) => r >= 2)) return "AWAITING_VALIDATION";
    if (ranks.some((r) => r >= 2)) return "PARTIALLY_RESULTED";
  }
  const live = input.specimens.filter((s) => s !== "REJECTED");
  if (live.some((s) => s === "RECEIVED" || s === "PROCESSING" || s === "STORED")) return "IN_LAB";
  if (live.length > 0 && live.every((s) => s !== "PENDING_COLLECTION")) return "COLLECTED";
  return input.current === "DRAFT" ? "DRAFT" : "AWAITING_COLLECTION";
}
