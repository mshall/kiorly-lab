import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addDays, eqaStatus, eqaZ, lotState, qcStats } from "./quality-math";

describe("quality math", () => {
  it("EQA z-score and status thresholds", () => {
    assert.equal(eqaZ(105, 100, 2), 2.5);
    assert.equal(eqaStatus(2), "ACCEPTABLE");
    assert.equal(eqaStatus(-2.01), "WARNING");
    assert.equal(eqaStatus(2.999), "WARNING");
    assert.equal(eqaStatus(-3), "UNACCEPTABLE");
    assert.throws(() => eqaZ(1, 1, 0));
  });
  it("lot expiry state includes the whole expiry day and a 30 day warning", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    assert.equal(lotState(null, now), "OK");
    assert.equal(lotState(new Date("2026-06-15T00:00:00Z"), now), "EXPIRING_SOON", "still valid through the whole expiry day");
    assert.equal(lotState(new Date("2026-06-14T00:00:00Z"), now), "EXPIRED");
    assert.equal(lotState(new Date("2026-07-10T00:00:00Z"), now), "EXPIRING_SOON");
    assert.equal(lotState(new Date("2026-09-01T00:00:00Z"), now), "OK");
  });
  it("QC statistics (mean, sample SD, CV%)", () => {
    const s = qcStats([10, 12, 14]);
    assert.deepEqual([s.n, s.mean, s.sd, s.cv], [3, 12, 2, 16.67]);
    assert.deepEqual(qcStats([]), { n: 0, mean: null, sd: null, cv: null });
    assert.equal(qcStats([5]).sd, 0);
    assert.equal(addDays(new Date("2026-01-01T00:00:00Z"), 30).toISOString(), "2026-01-31T00:00:00.000Z");
  });
});
