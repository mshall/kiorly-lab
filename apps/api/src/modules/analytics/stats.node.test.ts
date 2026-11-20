import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ageBand, dayKey, groupBy, median, pct, percentile } from "./stats";

describe("report statistics", () => {
  it("percentiles interpolate and handle empty input", () => {
    assert.equal(percentile([], 50), null);
    assert.equal(median([5, 1, 3]), 3);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(percentile([10, 20, 30, 40, 50], 90), 46);
  });
  it("percent, age bands, grouping, day keys", () => {
    assert.equal(pct(1, 3), 33.3);
    assert.equal(pct(1, 0), 0);
    assert.deepEqual([0.5, 3, 10, 20, 30, 50, 80, null].map(ageBand), ["<1", "1-4", "5-14", "15-24", "25-44", "45-64", "65+", "Unknown"]);
    assert.deepEqual([...groupBy([1, 2, 3, 4], (x) => (x % 2 ? "odd" : "even")).get("odd")!], [1, 3]);
    assert.equal(dayKey(new Date("2026-06-15T23:59:59Z")), "2026-06-15");
  });
});
