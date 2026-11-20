import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateFefo, perTest, suggestQty, usable, weightedAverage } from "./stock-math";

const lot = (id: string, qty: number, exp: string | null, status = "ACTIVE", cost = 1) => ({ id, qtyOnHand: qty, expiryDate: exp ? new Date(exp) : null, unitCost: cost, status });
const now = new Date("2026-06-15T12:00:00Z");

describe("inventory math", () => {
  it("FEFO draws from the earliest expiry first, no-expiry lots last, skipping expired/quarantined/empty", () => {
    const lots = [lot("late", 10, "2026-12-31"), lot("soon", 4, "2026-07-01"), lot("none", 100, null), lot("expired", 50, "2026-06-01"), lot("q", 50, "2026-06-30", "QUARANTINE"), lot("empty", 0, "2026-06-20")];
    const a = allocateFefo(lots, 12, now);
    assert.deepEqual(a.draws.map((d) => [d.lotId, d.qty]), [["soon", 4], ["late", 8]]);
    assert.equal(a.shortfall, 0);
    const b = allocateFefo(lots.slice(0, 2), 20, now);
    assert.deepEqual([b.draws.map((d) => d.qty), b.shortfall], [[4, 10], 6]);
  });
  it("a lot is usable through the whole expiry day", () => {
    assert.equal(usable(lot("a", 1, "2026-06-15"), now), true);
    assert.equal(usable(lot("a", 1, "2026-06-14"), now), false);
  });
  it("weighted average cost, wastage and reorder suggestions", () => {
    assert.equal(weightedAverage(100, 2, 100, 4), 3);
    assert.equal(weightedAverage(0, 0, 10, 5), 5);
    assert.equal(perTest(0.5, 10), 0.55);
    assert.equal(suggestQty(5, 10, 40), 40);
    assert.equal(suggestQty(5, 10, 0), 15);
    assert.equal(suggestQty(50, 10, 40), 0);
  });
});
