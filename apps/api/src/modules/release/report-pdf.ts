import PDFDocument from "pdfkit";

export interface ReportLine {
  test: string;
  analyte: string;
  value: string;
  unit: string;
  range: string;
  flag: string;
}
export interface ReportModel {
  reportId: string;
  version: number;
  labName: string;
  licenceNo?: string | null;
  orderNumber: string;
  accessions: string[];
  patient: { name: string; sex: string; dateOfBirth: string | null };
  collectedAt: string | null;
  signedBy: string;
  signatoryLicenceNo: string;
  signedAt: string;
  correctionReason?: string | null;
  lines: ReportLine[];
}

/** Standard PDF fonts only (Latin). Arabic report template + font embedding is NEEDS_HUMAN (NH-LB-017/NH-LB-019). */
const latin = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");

export function renderReportPdf(m: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Lab report ${m.orderNumber} v${m.version}`, Producer: "Kiorly Lab" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).font("Helvetica-Bold").text(latin(m.labName));
    if (m.licenceNo) doc.fontSize(9).font("Helvetica").text(`Licence ${latin(m.licenceNo)}`);
    doc.moveDown(0.5).fontSize(14).font("Helvetica-Bold").text(m.version > 1 ? `Laboratory report (CORRECTED, version ${m.version})` : "Laboratory report");
    if (m.version > 1 && m.correctionReason) doc.fontSize(9).font("Helvetica-Oblique").fillColor("#B91C1C").text(`Correction: ${latin(m.correctionReason)}`).fillColor("#000000");
    doc.moveDown(0.5).fontSize(10).font("Helvetica");
    doc.text(`Order: ${m.orderNumber}    Specimen(s): ${m.accessions.join(", ")}`);
    doc.text(`Patient: ${latin(m.patient.name)}    Sex: ${m.patient.sex}    Date of birth: ${m.patient.dateOfBirth ?? "-"}`);
    doc.text(`Collected: ${m.collectedAt ?? "-"}`);
    doc.moveDown();

    const cols = [150, 120, 70, 60, 90, 40];
    const x0 = doc.page.margins.left;
    const header = ["Test", "Analyte", "Result", "Unit", "Reference", "Flag"];
    let y = doc.y;
    doc.font("Helvetica-Bold");
    header.forEach((h, i) => doc.text(h, x0 + cols.slice(0, i).reduce((a, b) => a + b, 0), y, { width: cols[i] }));
    doc.moveTo(x0, y + 14).lineTo(x0 + cols.reduce((a, b) => a + b, 0), y + 14).stroke();
    doc.font("Helvetica");
    y += 20;
    for (const l of m.lines) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const row = [l.test, l.analyte, l.value, l.unit, l.range, l.flag];
      const abnormal = l.flag !== "" && l.flag !== "N";
      doc.font(abnormal ? "Helvetica-Bold" : "Helvetica");
      row.forEach((c, i) => doc.text(latin(c), x0 + cols.slice(0, i).reduce((a, b) => a + b, 0), y, { width: cols[i] - 4 }));
      y += 16;
    }
    doc.font("Helvetica").moveDown(2);
    doc.text("", x0, y + 16);
    doc.fontSize(9).text(`Electronically signed by ${latin(m.signedBy)} (licence ${latin(m.signatoryLicenceNo)}) on ${m.signedAt}`);
    doc.text(`Report ID ${m.reportId}  -  version ${m.version}`);
    // TODO_NEEDS_HUMAN (NH-LB-017): approved legal footer and signature policy wording.
    doc.moveDown().fontSize(8).fillColor("#6B7280").text("TODO_NEEDS_HUMAN: legal footer pending approval. Results apply to the specimen as received.");
    doc.end();
  });
}
