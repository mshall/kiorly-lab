import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * NH-LB-026: Arabic patient / test names. IBM Plex Sans Arabic (SIL OFL 1.1, bundled in apps/api/assets/fonts) is embedded for Arabic words;
 * fontkit shapes the letters, and word order is reversed for right-to-left lines (pdfkit has no bidi engine). Latin text keeps the standard fonts.
 * If the font files are missing the generator falls back to "?" for non-Latin characters instead of failing.
 */
const AR = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const latin = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
function fontDir(): string | null {
  for (const d of [join(process.cwd(), "assets/fonts"), join(__dirname, "../../../assets/fonts"), join(__dirname, "../../../../assets/fonts"), join(__dirname, "../../assets/fonts")]) if (existsSync(join(d, "ibm-plex-sans-arabic-arabic-400-normal.woff"))) return d;
  return null;
}
export const hasArabic = (s: string) => AR.test(s);

class Typesetter {
  private readonly ar: boolean;
  constructor(private readonly doc: PDFKit.PDFDocument) {
    const dir = fontDir();
    this.ar = Boolean(dir);
    if (dir) {
      doc.registerFont("Ar", readFileSync(join(dir, "ibm-plex-sans-arabic-arabic-400-normal.woff")));
      doc.registerFont("Ar-Bold", readFileSync(join(dir, "ibm-plex-sans-arabic-arabic-600-normal.woff")));
    }
  }
  private latinFont(bold: boolean) { return bold ? "Helvetica-Bold" : "Helvetica"; }
  private fontFor(word: string, bold: boolean) { return AR.test(word) && this.ar ? (bold ? "Ar-Bold" : "Ar") : this.latinFont(bold); }
  /** Draws one line at (x, y) inside `width`; right-to-left lines (first strong character Arabic) are right-aligned with reversed word order. */
  line(text: string, x: number, y: number, o: { width: number; size: number; bold?: boolean; color?: string }) {
    const { doc } = this;
    const bold = Boolean(o.bold);
    doc.fontSize(o.size);
    if (o.color) doc.fillColor(o.color);
    if (!AR.test(text) || !this.ar) { doc.font(this.latinFont(bold)).text(latin(text), x, y, { width: o.width, lineBreak: false, ellipsis: true }); if (o.color) doc.fillColor("#000000"); return; }
    const first = text.match(/[A-Za-z0-9\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/)?.[0] ?? "";
    const rtl = AR.test(first);
    const words = text.split(" ").filter(Boolean);
    // RTL line: reverse every word. LTR line: reverse each run of consecutive Arabic words in place (so "Patient: <arabic name>" reads correctly).
    const ordered: string[] = [];
    if (rtl) ordered.push(...[...words].reverse());
    else for (let i = 0; i < words.length;) {
      if (!AR.test(words[i]!)) { ordered.push(words[i++]!); continue; }
      let j = i;
      while (j < words.length && AR.test(words[j]!)) j++;
      ordered.push(...words.slice(i, j).reverse());
      i = j;
    }
    const widthOf = (w: string) => doc.font(this.fontFor(w, bold)).widthOfString(w);
    const space = doc.font(this.latinFont(bold)).widthOfString(" ");
    const total = ordered.reduce((a, w) => a + widthOf(w), 0) + space * Math.max(0, ordered.length - 1);
    let px = rtl ? x + Math.max(0, o.width - total) : x;
    for (const w of ordered) {
      doc.font(this.fontFor(w, bold)).text(w, px, y, { lineBreak: false });
      px += widthOf(w) + space;
    }
    if (o.color) doc.fillColor("#000000");
  }
}

export function renderReportPdf(m: ReportModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Lab report ${m.orderNumber} v${m.version}`, Producer: "Kiorly Lab" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ts = new Typesetter(doc);
    const L = doc.page.margins.left;
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    ts.line(m.labName, L, doc.y, { width: W, size: 18, bold: true });
    doc.y += 24;
    if (m.licenceNo) { ts.line(`Licence ${m.licenceNo}`, L, doc.y, { width: W, size: 9 }); doc.y += 14; }
    doc.y += 4;
    ts.line(m.version > 1 ? `Laboratory report (CORRECTED, version ${m.version})` : "Laboratory report", L, doc.y, { width: W, size: 14, bold: true });
    doc.y += 22;
    if (m.version > 1 && m.correctionReason) { ts.line(`Correction: ${m.correctionReason}`, L, doc.y, { width: W, size: 9, color: "#B91C1C" }); doc.y += 14; }
    doc.y += 4;
    ts.line(`Order: ${m.orderNumber}    Specimen(s): ${m.accessions.join(", ")}`, L, doc.y, { width: W, size: 10 }); doc.y += 15;
    // patient name on its own line so Arabic names are shaped and aligned correctly
    ts.line(`Patient: ${m.patient.name}`, L, doc.y, { width: W, size: 10, bold: hasArabic(m.patient.name) }); doc.y += 15;
    ts.line(`Sex: ${m.patient.sex}    Date of birth: ${m.patient.dateOfBirth ?? "-"}`, L, doc.y, { width: W, size: 10 }); doc.y += 15;
    ts.line(`Collected: ${m.collectedAt ?? "-"}`, L, doc.y, { width: W, size: 10 }); doc.y += 15;
    doc.y += 8;

    const cols = [150, 120, 70, 60, 90, 40];
    const x0 = L;
    const header = ["Test", "Analyte", "Result", "Unit", "Reference", "Flag"];
    const colX = (i: number) => x0 + cols.slice(0, i).reduce((a, b) => a + b, 0);
    let y = doc.y;
    header.forEach((h, i) => ts.line(h, colX(i), y, { width: cols[i]!, size: 10, bold: true }));
    doc.moveTo(x0, y + 14).lineTo(x0 + cols.reduce((a, b) => a + b, 0), y + 14).stroke();
    y += 20;
    for (const l of m.lines) {
      if (y > doc.page.height - 120) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      const row = [l.test, l.analyte, l.value, l.unit, l.range, l.flag];
      const abnormal = l.flag !== "" && l.flag !== "N";
      row.forEach((c, i) => ts.line(c, colX(i), y, { width: cols[i]! - 4, size: 10, bold: abnormal }));
      y += 16;
    }
    y += 16;
    ts.line(`Electronically signed by ${m.signedBy} (licence ${m.signatoryLicenceNo}) on ${m.signedAt}`, L, y, { width: W, size: 9 });
    ts.line(`Report ID ${m.reportId}  -  version ${m.version}`, L, y + 13, { width: W, size: 9 });
    // TODO_NEEDS_HUMAN (NH-LB-017): approved legal footer and signature policy wording.
    ts.line("TODO_NEEDS_HUMAN: legal footer pending approval. Results apply to the specimen as received.", L, y + 34, { width: W, size: 8, color: "#6B7280" });
    doc.end();
  });
}
