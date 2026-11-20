import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FormulaError, evalFormula, formulaInputs, parseFormula } from "./formula";

describe("calculated-test formulas", () => {
  it("evaluates arithmetic with precedence, power right-associativity and unary minus", () => {
    assert.equal(evalFormula("2 + 3 * 4", {}), 14);
    assert.equal(evalFormula("(2 + 3) * 4", {}), 20);
    assert.equal(evalFormula("2 ^ 3 ^ 2", {}), 512);
    assert.equal(evalFormula("-2 ^ 2", {}), -4);
    assert.equal(evalFormula("10 - 4 - 3", {}), 3);
  });
  it("LDL (Friedewald) with a triglyceride guard via IF", () => {
    const f = "IF(TG < 400, TC - HDL - TG / 5, 0 / 0)";
    assert.equal(evalFormula(f, { TC: 200, HDL: 50, TG: 100 }), 130);
    assert.equal(evalFormula(f, { TC: 200, HDL: 50, TG: 450 }), null, "not computable above 400 mg/dL");
  });
  it("CKD-EPI 2021 eGFR with AGE and MALE built-ins matches published values", () => {
    const f = "142 * MIN(CREA / IF(MALE, 0.9, 0.7), 1) ^ IF(MALE, -0.302, -0.241) * MAX(CREA / IF(MALE, 0.9, 0.7), 1) ^ -1.2 * 0.9938 ^ AGE * IF(MALE, 1, 1.012)";
    const v = evalFormula(f, { CREA: 1, AGE: 50, MALE: 1 })!;
    assert.ok(Math.abs(v - 91.7) < 0.3, String(v));
    const w = evalFormula(f, { CREA: 0.6, AGE: 30, MALE: 0 })!;
    assert.ok(w > 110 && w < 130, String(w));
  });
  it("functions, comparisons, missing inputs and division by zero yield null, never throw", () => {
    assert.equal(evalFormula("ROUND(2.345, 2)", {}), 2.35);
    assert.equal(evalFormula("MAX(1, SQRT(16), ABS(-2))", {}), 4);
    assert.equal(evalFormula("A / B", { A: 1, B: 0 }), null);
    assert.equal(evalFormula("A + B", { A: 1 }), null);
    assert.equal(evalFormula("LN(-1)", {}), null);
  });
  it("lists input analytes, rejects bad syntax and unknown functions", () => {
    assert.deepEqual(formulaInputs("TC - HDL - TG/5 + AGE").sort(), ["HDL", "TC", "TG"]);
    assert.throws(() => parseFormula("1 +"), FormulaError);
    assert.throws(() => parseFormula("FOO(1)"), FormulaError);
    assert.throws(() => parseFormula("1 $ 2"), FormulaError);
    assert.throws(() => parseFormula("MIN()"), FormulaError);
    assert.throws(() => parseFormula("(1 + 2"), FormulaError);
  });
});
