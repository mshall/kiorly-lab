import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { histoReportText, nextHistoStatus } from "./histopathology.service";

describe("histopathology helpers", () => {
  it("workflow order", () => {
    assert.equal(nextHistoStatus("RECEIVED"), "GROSSING");
    assert.equal(nextHistoStatus("REPORTING"), "SIGNED_OUT");
    assert.equal(nextHistoStatus("SIGNED_OUT"), null);
  });
  it("report text carries diagnosis, morphology code and synoptic items", () => {
    const t = histoReportText({ kind: "HISTOPATHOLOGY", site: "Colon", diagnosis: "Adenocarcinoma, moderately differentiated", morphologyCode: "8140/3", grossDescription: "5 cm polyp", synoptic: { grade: "G2", margins: "Free" } });
    assert.equal(t.split("\n")[0], "DIAGNOSIS: Adenocarcinoma, moderately differentiated [8140/3]");
    assert.match(t, /GRADE: G2/);
    assert.match(t, /MARGINS: Free/);
  });
});
