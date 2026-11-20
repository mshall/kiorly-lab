import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasArabic, renderReportPdf, type ReportModel } from "./report-pdf";

const model = (name: string): ReportModel => ({
  reportId: "r1", version: 1, labName: "معمل كيورلي", orderNumber: "ORD-1", accessions: ["A1"],
  patient: { name, sex: "F", dateOfBirth: "1990-05-10" }, collectedAt: null, signedBy: "Dr. Salma", signatoryLicenceNo: "L-1", signedAt: "2026-11-20",
  lines: [{ test: "CBC", analyte: "Haemoglobin", value: "13.4", unit: "g/dL", range: "12-16", flag: "" }],
});

describe("report PDF (NH-LB-026)", () => {
  it("detects Arabic", () => { assert.equal(hasArabic("أميرة سامي"), true); assert.equal(hasArabic("Amira"), false); });
  it("renders an Arabic patient name with an embedded Arabic font", async () => {
    const buf = await renderReportPdf(model("أميرة سامي"));
    assert.equal(buf.subarray(0, 4).toString(), "%PDF");
    assert.ok(buf.toString("latin1").includes("IBMPlexSansArabic"), "Arabic font must be embedded");
  });
  it("Latin-only reports stay on the standard fonts", async () => {
    const buf = await renderReportPdf({ ...model("Amira Samy"), labName: "Kiorly Lab" });
    assert.ok(!buf.toString("latin1").includes("IBMPlexSansArabic"));
  });
});
