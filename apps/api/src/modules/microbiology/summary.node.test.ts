import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingSusceptibility, summarizeCase } from "./summary";

describe("microbiology report summary", () => {
  it("no growth", () => assert.equal(summarizeCase({ growth: false, hours: 48, isolates: [] }), "No growth after 48 h incubation."));
  it("groups reported susceptibilities by interpretation and hides unreported ones (selective reporting)", () => {
    const t = summarizeCase({
      growth: true, comment: "Correlate clinically.",
      isolates: [{ organism: "Escherichia coli", quantity: ">10^5 CFU/mL", susceptibilities: [
        { antibiotic: "Amikacin", interpretation: "S", reported: true }, { antibiotic: "Meropenem", interpretation: "S", reported: true },
        { antibiotic: "Ampicillin", interpretation: "R", reported: true }, { antibiotic: "Colistin", interpretation: "S", reported: false },
      ] }],
    });
    assert.equal(t, "Isolate: Escherichia coli (>10^5 CFU/mL)\n  Sensitive: Amikacin, Meropenem\n  Resistant: Ampicillin\nCorrelate clinically.");
    assert.ok(!t.includes("Colistin"));
  });
  it("sign-off needs susceptibilities for bacteria but not yeasts", () => {
    assert.deepEqual(missingSusceptibility([{ organism: "E. coli", gram: "NEG", reportedCount: 0 }, { organism: "Candida", gram: "YEAST", reportedCount: 0 }, { organism: "S. aureus", gram: "POS", reportedCount: 2 }]), ["E. coli"]);
  });
});
