import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVENT_STATUS, MANIFEST_NEXT, firstFreeSlot, parseSlot, retentionEnd, slotLabel } from "./storage-grid";

describe("storage grid + manifest helpers", () => {
  it("labels and parses slots, rejects outside the grid", () => {
    assert.equal(slotLabel(0, 0), "A1");
    assert.equal(slotLabel(7, 11), "H12");
    assert.deepEqual(parseSlot("b7", 8, 12), { row: 1, col: 6 });
    assert.equal(parseSlot("I1", 8, 12), null);
    assert.equal(parseSlot("A13", 8, 12), null);
    assert.equal(parseSlot("A0", 8, 12), null);
    assert.equal(parseSlot("1A", 8, 12), null);
  });
  it("finds the first free slot row by row; null when full", () => {
    assert.equal(firstFreeSlot(2, 2, new Set()), "A1");
    assert.equal(firstFreeSlot(2, 2, new Set(["A1", "A2"])), "B1");
    assert.equal(firstFreeSlot(1, 2, new Set(["A1", "A2"])), null);
  });
  it("retention end and manifest state machine", () => {
    assert.equal(retentionEnd(new Date("2026-01-01T00:00:00Z"), 7).toISOString(), "2026-01-08T00:00:00.000Z");
    assert.ok(MANIFEST_NEXT.DRAFT!.includes("DISPATCHED") && !MANIFEST_NEXT.RECEIVED!.length);
    assert.equal(EVENT_STATUS.DELIVERED, "DELIVERED");
    assert.equal(EVENT_STATUS.DELAYED, null);
  });
});
