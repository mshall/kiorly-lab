/** Pure inventory math. */
export interface LotLike { id: string; qtyOnHand: number; expiryDate: Date | null; unitCost: number; status: string }

/** True when the lot can be consumed today (ACTIVE, has stock, not past expiry; valid through the expiry day). */
export function usable(l: LotLike, now = new Date()): boolean {
  if (l.status !== "ACTIVE" || !(l.qtyOnHand > 0)) return false;
  return !l.expiryDate || l.expiryDate.getTime() + 86_400_000 > now.getTime();
}

/** First-expiry-first-out allocation: lots without an expiry date go last. Returns the draws and the unmet quantity. */
export function allocateFefo(lots: LotLike[], needed: number, now = new Date()): { draws: { lotId: string; qty: number; unitCost: number }[]; shortfall: number } {
  const order = lots.filter((l) => usable(l, now)).sort((a, b) => (a.expiryDate?.getTime() ?? Infinity) - (b.expiryDate?.getTime() ?? Infinity));
  const draws: { lotId: string; qty: number; unitCost: number }[] = [];
  let left = round3(needed);
  for (const l of order) {
    if (left <= 0) break;
    const take = Math.min(l.qtyOnHand, left);
    draws.push({ lotId: l.id, qty: round3(take), unitCost: l.unitCost });
    left = round3(left - take);
  }
  return { draws, shortfall: Math.max(0, left) };
}

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Weighted average unit cost after receiving `qty` at `cost` on top of `onHand` valued at `avg`. */
export function weightedAverage(onHand: number, avg: number, qty: number, cost: number): number {
  const total = onHand + qty;
  return total > 0 ? round4((Math.max(onHand, 0) * avg + qty * cost) / (Math.max(onHand, 0) + qty)) : cost;
}

/** Quantity per test including wastage. */
export const perTest = (qtyPerTest: number, wastagePercent: number) => round4(qtyPerTest * (1 + wastagePercent / 100));

/** Suggested reorder quantity: configured reorder qty, or top up to twice the reorder level. */
export function suggestQty(onHand: number, reorderLevel: number, reorderQty: number): number {
  if (onHand > reorderLevel) return 0;
  return reorderQty > 0 ? reorderQty : round3(Math.max(reorderLevel * 2 - onHand, 0));
}
