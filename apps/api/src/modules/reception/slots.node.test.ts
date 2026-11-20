import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { laneRank, slotFor, slotGrid, ticketPrefix } from "./slots";
import { isIcdCode, searchIcd } from "./icd";

const cfg = { openingHour: 8, closingHour: 10, slotMinutes: 30, capacity: 2 };
describe("reception pure logic", () => {
  it("builds the slot grid inside opening hours", () => {
    const g = slotGrid("2026-11-20", cfg);
    assert.equal(g.length, 4);
    assert.equal(g[0]!.startsAt.toISOString(), "2026-11-20T08:00:00.000Z");
    assert.equal(g.at(-1)!.endsAt.toISOString(), "2026-11-20T10:00:00.000Z");
  });
  it("finds the containing slot and rejects times outside opening hours", () => {
    assert.equal(slotFor(new Date("2026-11-20T08:45:00Z"), cfg)!.startsAt.toISOString(), "2026-11-20T08:30:00.000Z");
    assert.equal(slotFor(new Date("2026-11-20T10:00:00Z"), cfg), null);
    assert.equal(slotFor(new Date("2026-11-20T07:59:00Z"), cfg), null);
  });
  it("queue lanes: STAT before URGENT before routine; non-routine tickets use the S lane", () => {
    assert.ok(laneRank("STAT") < laneRank("URGENT") && laneRank("URGENT") < laneRank("ROUTINE"));
    assert.equal(ticketPrefix("STAT"), "S");
    assert.equal(ticketPrefix("ROUTINE"), "A");
  });
  it("ICD hints search by code, English and Arabic; validates code shape", () => {
    assert.equal(searchIcd("E11")[0]!.code, "E11");
    assert.ok(searchIcd("thyroid").length >= 2);
    assert.ok(searchIcd("السكري").length >= 2);
    assert.ok(isIcdCode("E11.9") && isIcdCode("I10") && !isIcdCode("diabetes"));
  });
});
