import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ageBucket, daysOverdue } from "./aging";
import { allocateDiscount } from "./billing.service";

describe("receivables aging + discount allocation", () => {
  it("buckets by days past due", () => {
    const asOf = new Date("2026-06-30T12:00:00Z");
    assert.equal(ageBucket(daysOverdue(new Date("2026-07-10T00:00:00Z"), asOf)), "current");
    assert.equal(ageBucket(daysOverdue(new Date("2026-06-29T12:00:00Z"), asOf)), "d1_30");
    assert.equal(ageBucket(daysOverdue(new Date("2026-05-31T12:00:00Z"), asOf)), "d1_30", "30 days overdue");
    assert.equal(ageBucket(daysOverdue(new Date("2026-05-30T12:00:00Z"), asOf)), "d31_60", "31 days overdue");
    assert.equal(ageBucket(61), "d61_90");
    assert.equal(ageBucket(91), "d90_plus");
  });
  it("discount allocation sums exactly and is proportional", () => {
    const a = allocateDiscount([120, 40, 130], 29);
    assert.equal(Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100, 29);
    assert.ok(a[0]! > a[1]! && a[2]! > a[1]!);
    assert.deepEqual(allocateDiscount([10, 10], 0), [0, 0]);
    assert.equal(allocateDiscount([10, 10], 500).reduce((x, y) => x + y, 0), 20, "capped at the gross");
    assert.deepEqual(allocateDiscount([33.33, 33.33, 33.34], 10), allocateDiscount([33.33, 33.33, 33.34], 10));
    const odd = allocateDiscount([0.01, 0.01, 0.01], 0.02);
    assert.equal(Math.round(odd.reduce((x, y) => x + y, 0) * 100) / 100, 0.02);
  });
});
