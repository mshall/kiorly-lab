import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ParseError, astmRecords, buildHl7Ack, hl7Segments, parseAnalyzerMessage, parseAstm, parseHl7Oru, parseTs } from "./parsers";

const fx = (n: string) => readFileSync(resolve(__dirname, "../../../test/fixtures/analyzer", n), "latin1");

describe("ASTM E1394 parser (fixtures)", () => {
  it("parses a CBC result message", () => {
    const m = parseAstm(fx("astm-cbc.txt"));
    assert.equal(m.protocol, "ASTM_E1394");
    assert.equal(m.sender, "SimAnalyzer");
    assert.equal(m.groups.length, 1);
    const g = m.groups[0];
    assert.equal(g.specimenId, "TL2611200001");
    assert.equal(g.patientId, "PID-77");
    assert.equal(g.isQc, false);
    assert.deepEqual(g.observations.map((o) => [o.testCode, o.value, o.unit]), [["HB", 13.5, "g/dL"], ["WBC", 7.2, "x10^9/L"], ["PLT", 412, "x10^9/L"]]);
    assert.equal(g.observations[0].testName, "Hemoglobin");
    assert.equal(g.observations[2].abnormalFlag, "H");
    assert.equal(g.observations[0].observedAt?.toISOString(), "2026-11-20T10:14:00.000Z");
    assert.deepEqual(m.warnings, []);
  });

  it("strips low-level framing (ENQ, STX, frame number, ETX, checksum, EOT)", () => {
    const recs = astmRecords(fx("astm-framed.txt"));
    assert.ok(recs[0].startsWith("H|"), recs[0]);
    const m = parseAstm(fx("astm-framed.txt"));
    assert.equal(m.groups[0].specimenId, "TL2611200002");
    assert.equal(m.groups[0].observations[0].value, 91);
  });

  it("recognises QC control records (specimen id QC^level^lot)", () => {
    const m = parseAstm(fx("astm-qc.txt"));
    assert.equal(m.groups[0].isQc, true);
    assert.deepEqual(m.groups[0].qc, { level: "LEVEL_1", lot: "DEMO-L1" });
    assert.equal(m.groups[0].observations[0].value, 14.1);
  });

  it("rejects messages without a header and tolerates malformed records with warnings", () => {
    assert.throws(() => parseAstm("R|1|^^^HB|1\r"), ParseError);
    const m = parseAstm(fx("astm-malformed.txt"));
    assert.ok(m.warnings.length >= 2);
    assert.equal(m.groups[0].observations.length, 0);
  });
});

describe("HL7 v2 ORU^R01 parser (fixtures)", () => {
  it("parses observations, units, ranges, flags and escapes", () => {
    const m = parseHl7Oru(fx("hl7-oru.txt"));
    assert.equal(m.messageId, "MSG0001");
    assert.equal(m.sender, "SimAnalyzer");
    const g = m.groups[0];
    assert.equal(g.specimenId, "TL2611200003");
    assert.equal(g.patientId, "PID-77");
    assert.deepEqual(g.observations.map((o) => [o.testCode, o.value ?? o.valueText]), [["HB", 13.5], ["WBC", 7.2], ["NOTE", "sample | ok"]]);
    assert.equal(g.observations[0].referenceRange, "12.0-15.5");
  });

  it("handles MLLP framing", () => {
    const m = parseHl7Oru(fx("hl7-mllp.txt"));
    assert.equal(m.groups[0].specimenId, "TL2611200004");
    assert.equal(m.groups[0].observations[0].value, 6.2);
    assert.equal(hl7Segments(fx("hl7-mllp.txt")).length, 3);
  });

  it("recognises QC and rejects other message types", () => {
    const m = parseHl7Oru(fx("hl7-qc.txt"));
    assert.equal(m.groups[0].isQc, true);
    assert.deepEqual(m.groups[0].qc, { level: "LEVEL_2", lot: "DEMO-L2" });
    assert.throws(() => parseHl7Oru(fx("hl7-wrong-type.txt")), /ORU/);
    assert.throws(() => parseHl7Oru("PID|1||X"), ParseError);
  });

  it("builds ACK messages echoing the control id", () => {
    const ack = buildHl7Ack(fx("hl7-oru.txt"), true);
    assert.match(ack, /MSA\|AA\|MSG0001/);
    assert.match(buildHl7Ack(fx("hl7-oru.txt"), false, "nope"), /MSA\|AE\|MSG0001\|nope/);
  });
});

describe("shared helpers", () => {
  it("dispatches by protocol and parses timestamps", () => {
    assert.equal(parseAnalyzerMessage("HL7_V2", fx("hl7-oru.txt")).protocol, "HL7_V2");
    assert.equal(parseTs("20261120")?.toISOString(), "2026-11-20T00:00:00.000Z");
    assert.equal(parseTs("garbage"), undefined);
  });
});
