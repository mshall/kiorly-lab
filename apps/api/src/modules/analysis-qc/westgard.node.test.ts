import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { REJECTION_RULES, evaluateWestgard, zScore } from "./westgard";

const ev = (history: number[], others: number[] = []) => evaluateWestgard({ history, sameRunOthers: others });

describe("Westgard rules (examples)", () => {
  it("passes in-control data and flags 1_2s only as a warning", () => {
    assert.equal(ev([0.2, -0.5, 0.9]).status, "PASS");
    const w = ev([0.1, 2.4]);
    assert.equal(w.status, "WARNING");
    assert.deepEqual(w.warnings, ["1_2s"]);
  });
  it("1_3s: one observation beyond 3 SD rejects (either side)", () => {
    assert.deepEqual(ev([3.01]).violated, ["1_3s"]);
    assert.deepEqual(ev([-3.5]).violated, ["1_3s"]);
    assert.equal(ev([3]).status, "WARNING", "exactly 3.0 is not > 3");
  });
  it("2_2s: two consecutive beyond 2 SD on the same side, within level or across levels in one run", () => {
    assert.ok(ev([2.1, 2.5]).violated.includes("2_2s"));
    assert.ok(ev([-2.1, -2.2]).violated.includes("2_2s"));
    assert.ok(!ev([2.1, -2.5]).violated.includes("2_2s"));
    assert.ok(ev([2.3], [2.2]).violated.includes("2_2s"));
  });
  it("R_4s: one beyond +2 and another beyond -2 (range > 4 SD) within a run", () => {
    assert.ok(ev([-2.6], [2.5]).violated.includes("R_4s"));
    assert.ok(ev([2.4, -2.2]).violated.includes("R_4s"));
    assert.ok(!ev([-2.1], [2.0]).violated.includes("R_4s"));
  });
  it("4_1s: four consecutive beyond 1 SD on the same side", () => {
    assert.ok(ev([1.1, 1.5, 1.2, 1.3]).violated.includes("4_1s"));
    assert.ok(!ev([1.1, 1.5, 0.9, 1.3]).violated.includes("4_1s"));
    assert.ok(ev([-1.1, -1.5, -1.2, -1.3]).violated.includes("4_1s"));
  });
  it("10x: ten consecutive on the same side of the mean", () => {
    assert.ok(ev(Array(10).fill(0.3)).violated.includes("10x"));
    assert.ok(!ev(Array(9).fill(0.3)).violated.includes("10x"));
    assert.ok(!ev([...Array(9).fill(0.3), 0]).violated.includes("10x"), "a point on the mean breaks the run");
  });
  it("z-score", () => assert.equal(zScore(13.9, 13, 0.3), (13.9 - 13) / 0.3));
});

describe("Westgard rules (property-based)", () => {
  const z = fc.double({ min: -6, max: 6, noNaN: true });
  it("any |z| > 3 on the newest point always FAILS with 1_3s (a block opens)", () => {
    fc.assert(fc.property(fc.array(z, { maxLength: 12 }), fc.double({ min: 3.0001, max: 9, noNaN: true }), fc.boolean(), (hist, mag, neg) => {
      const r = ev([...hist, neg ? -mag : mag]);
      return r.status === "FAIL" && r.violated.includes("1_3s");
    }));
  });
  it("a series entirely within +-1 SD never violates or warns when signs alternate", () => {
    fc.assert(fc.property(fc.array(fc.double({ min: 0.001, max: 1, noNaN: true }), { minLength: 1, maxLength: 20 }), (mags) => {
      const hist = mags.map((m, i) => (i % 2 ? -m : m));
      return ev(hist).status === "PASS";
    }));
  });
  it("status is FAIL iff at least one rejection rule fired; WARNING never carries rejection rules", () => {
    fc.assert(fc.property(fc.array(z, { minLength: 1, maxLength: 14 }), fc.array(z, { maxLength: 2 }), (hist, others) => {
      const r = ev(hist, others);
      const anyRej = r.violated.some((v) => REJECTION_RULES.includes(v));
      return (r.status === "FAIL") === anyRej && (r.status !== "WARNING" || r.violated.length === 0);
    }));
  });
  it("evaluation is deterministic and ignores observations older than the rule windows", () => {
    fc.assert(fc.property(fc.array(z, { minLength: 10, maxLength: 30 }), (hist) => {
      const a = ev(hist);
      const b = ev(hist.slice(-10));
      return JSON.stringify(a) === JSON.stringify(b);
    }));
  });
});
