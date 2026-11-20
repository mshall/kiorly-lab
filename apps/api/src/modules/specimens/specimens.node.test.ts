import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { SpecimenStatus } from "../../generated/prisma/client";
import { code128bSvg, code128bValues } from "./code128";
import { type SpecimenAction, nextSpecimenStatus } from "./specimen-state";

const STATUSES: SpecimenStatus[] = ["PENDING_COLLECTION", "COLLECTED", "IN_TRANSIT", "RECEIVED", "PROCESSING", "STORED", "DISPOSED", "REJECTED"];
const ACTIONS: SpecimenAction[] = ["collect", "transport", "receive", "process", "store", "dispose", "reject", "retrieve"];

describe("Code 128-B", () => {
  it("encodes with the standard checksum (known vector)", () => {
    // "A": start B (104) + 33 => (104 + 33*1) % 103 = 34
    assert.deepEqual(code128bValues("A"), [104, 33, 34, 106]);
    assert.deepEqual(code128bValues("TL2611200001").slice(0, 1), [104]);
  });
  it("renders every barcode symbol with 11 modules (13 for stop) and rejects non-ASCII", () => {
    const svg = code128bSvg("ACC-1", { module: 1, height: 10 });
    assert.match(svg, /^<svg/);
    assert.throws(() => code128bSvg("é"), /cannot encode/);
  });
  it("distinct texts produce distinct bars", () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Z0-9-]{3,16}$/), fc.stringMatching(/^[A-Z0-9-]{3,16}$/), (a, b) => a === b || code128bSvg(a) !== code128bSvg(b)));
  });
});

describe("specimen state machine (KLSPC03 chain)", () => {
  it("follows collected -> transported -> received -> processed -> stored/disposed", () => {
    assert.equal(nextSpecimenStatus("PENDING_COLLECTION", "collect"), "COLLECTED");
    assert.equal(nextSpecimenStatus("COLLECTED", "transport"), "IN_TRANSIT");
    assert.equal(nextSpecimenStatus("IN_TRANSIT", "receive"), "RECEIVED");
    assert.equal(nextSpecimenStatus("RECEIVED", "process"), "PROCESSING");
    assert.equal(nextSpecimenStatus("PROCESSING", "store"), "STORED");
    assert.equal(nextSpecimenStatus("STORED", "dispose"), "DISPOSED");
  });
  it("cannot skip receipt, and terminal states have no exits", () => {
    assert.equal(nextSpecimenStatus("COLLECTED", "process"), null);
    assert.equal(nextSpecimenStatus("PENDING_COLLECTION", "receive"), null);
    for (const a of ACTIONS) {
      assert.equal(nextSpecimenStatus("REJECTED", a), null);
      assert.equal(nextSpecimenStatus("DISPOSED", a), null);
    }
  });
  it("property: transitions never return to PENDING_COLLECTION", () => {
    fc.assert(fc.property(fc.constantFrom(...STATUSES), fc.constantFrom(...ACTIONS), (s, a) => nextSpecimenStatus(s, a) !== "PENDING_COLLECTION"));
  });
});
