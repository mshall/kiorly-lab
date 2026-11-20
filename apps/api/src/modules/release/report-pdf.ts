import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { qrMatrix } from "../specimens/qr";

export interface ReportLine {
  test: string;
  /** Arabic names (templates with an Arabic or bilingual language mode). */
  testAr?: string | null;
  analyteAr?: string | null;
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
  /** Branding/layout. Absent = the built-in English layout (kept for backward compatibility). */
  template?: ReportTemplateView;
}

export interface ReportTemplateView {
  language: "AR" | "EN" | "BILINGUAL";
  headerTitle?: string | null;
  headerSubtitle?: string | null;
  footerText?: string | null;
  accentColor: string;
  showQr: boolean;
  showRanges: boolean;
  logo?: Buffer | null;
  /** Verification URL encoded in the QR code. */
  qrPayload?: string;
}

const LBL: Record<string, [string, string]> = {
  report: ["Laboratory report", "تقرير المختبر"], corrected: ["Laboratory report (CORRECTED, version {v})", "تقرير المختبر (معدّل، الإصدار {v})"], correction: ["Correction", "سبب التعديل"],
  order: ["Order", "رقم الطلب"], specimens: ["Specimen(s)", "العينات"], patient: ["Patient", "المريض"], sex: ["Sex", "الجنس"], dob: ["Date of birth", "تاريخ الميلاد"], collected: ["Collected", "تاريخ السحب"],
  test: ["Test", "الفحص"], analyte: ["Analyte", "المكوّن"], result: ["Result", "النتيجة"], unit: ["Unit", "الوحدة"], reference: ["Reference", "المدى المرجعي"], flag: ["Flag", "إشارة"],
  signed: ["Electronically signed by", "موقّع إلكترونيًا بواسطة"], licence: ["licence", "رخصة"], on: ["on", "بتاريخ"], reportId: ["Report ID", "رقم التقرير"], version: ["version", "الإصدار"],
  scan: ["Scan to verify this report", "امسح للتحقق من التقرير"], page: ["Page", "صفحة"], of: ["of", "من"],
};
/** Label in the template language ("Test" / "الفحص" / "Test  /  الفحص"). */
export function label(key: keyof typeof LBL, lang: "AR" | "EN" | "BILINGUAL", v?: number): string {
  const [en, ar] = LBL[key]!;
  const f = (x: string) => (v == null ? x : x.replace("{v}", String(v)));
  return lang === "AR" ? f(ar) : lang === "EN" ? f(en) : `${f(en)}  /  ${f(ar)}`;
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

export class Typesetter {
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
    const tpl = m.template;
    const lang = tpl?.language ?? "EN";
    const accent = /^#[0-9a-fA-F]{6}$/.test(tpl?.accentColor ?? "") ? tpl!.accentColor : "#000000";
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Lab report ${m.orderNumber} v${m.version}`, Producer: "Kiorly Lab" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ts = new Typesetter(doc);
    const L = doc.page.margins.left;
    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const t = (k: keyof typeof LBL, v?: number) => label(k, lang, v);
    // ---- header (branding)
    let headerTop = doc.y;
    if (tpl?.logo) { try { doc.image(tpl.logo, L + W - 64, headerTop, { fit: [64, 64] }); } catch { /* unreadable logo: header without it */ } }
    ts.line(tpl?.headerTitle || m.labName, L, doc.y, { width: W - (tpl?.logo ? 76 : 0), size: 18, bold: true, color: accent });
    doc.y += 24;
    if (tpl?.headerSubtitle) { ts.line(tpl.headerSubtitle, L, doc.y, { width: W - (tpl?.logo ? 76 : 0), size: 9 }); doc.y += 14; }
    if (m.licenceNo) { ts.line(`${tpl ? label("licence", lang) : "Licence"} ${m.licenceNo}`, L, doc.y, { width: W, size: 9 }); doc.y += 14; }
    headerTop = Math.max(doc.y, headerTop + (tpl?.logo ? 68 : 0));
    doc.y = headerTop;
    doc.save().lineWidth(1.5).strokeColor(accent).moveTo(L, doc.y).lineTo(L + W, doc.y).stroke().restore();
    doc.y += 10;
    ts.line(m.version > 1 ? (tpl ? t("corrected", m.version) : `Laboratory report (CORRECTED, version ${m.version})`) : tpl ? t("report") : "Laboratory report", L, doc.y, { width: W, size: 14, bold: true });
    doc.y += 22;
    if (m.version > 1 && m.correctionReason) { ts.line(`${tpl ? t("correction") : "Correction"}: ${m.correctionReason}`, L, doc.y, { width: W, size: 9, color: "#B91C1C" }); doc.y += 14; }
    doc.y += 4;
    ts.line(`${tpl ? t("order") : "Order"}: ${m.orderNumber}    ${tpl ? t("specimens") : "Specimen(s)"}: ${m.accessions.join(", ")}`, L, doc.y, { width: W, size: 10 }); doc.y += 15;
    // patient name on its own line so Arabic names are shaped and aligned correctly
    ts.line(`${tpl ? t("patient") : "Patient"}: ${m.patient.name}`, L, doc.y, { width: W, size: 10, bold: hasArabic(m.patient.name) }); doc.y += 15;
    ts.line(`${tpl ? t("sex") : "Sex"}: ${m.patient.sex}    ${tpl ? t("dob") : "Date of birth"}: ${m.patient.dateOfBirth ?? "-"}`, L, doc.y, { width: W, size: 10 }); doc.y += 15;
    ts.line(`${tpl ? t("collected") : "Collected"}: ${m.collectedAt ?? "-"}`, L, doc.y, { width: W, size: 10 }); doc.y += 15;
    doc.y += 8;

    // ---- table
    const showRanges = tpl?.showRanges ?? true;
    const cols = showRanges ? [150, 120, 70, 60, 90, 40] : [190, 150, 90, 70, 0, 40];
    const x0 = L;
    const heads: (keyof typeof LBL)[] = ["test", "analyte", "result", "unit", "reference", "flag"];
    const colX = (i: number) => x0 + cols.slice(0, i).reduce((a, b) => a + b, 0);
    let y = doc.y;
    const drawHead = () => {
      heads.forEach((h, i) => {
        if (!cols[i]) return;
        if (!tpl) { ts.line(["Test", "Analyte", "Result", "Unit", "Reference", "Flag"][i]!, colX(i), y, { width: cols[i]!, size: 10, bold: true }); return; }
        const [en, ar] = LBL[h]!;
        if (lang === "BILINGUAL") { ts.line(en, colX(i), y, { width: cols[i]!, size: 9, bold: true }); ts.line(ar, colX(i), y + 11, { width: cols[i]!, size: 8, bold: true }); } else ts.line(lang === "AR" ? ar : en, colX(i), y, { width: cols[i]!, size: 10, bold: true });
      });
      const hh = lang === "BILINGUAL" ? 26 : 14;
      doc.save().strokeColor(accent).moveTo(x0, y + hh).lineTo(x0 + cols.reduce((a, b) => a + b, 0), y + hh).stroke().restore();
      y += hh + 6;
    };
    drawHead();
    for (const l of m.lines) {
      if (y > doc.page.height - 130) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHead();
      }
      const testName = lang === "AR" ? (l.testAr || l.test) : l.test;
      const analyteName = lang === "AR" ? (l.analyteAr || l.analyte) : l.analyte;
      const row = [testName, analyteName, l.value, l.unit, l.range, l.flag];
      const abnormal = l.flag !== "" && l.flag !== "N";
      row.forEach((c, i) => { if (cols[i]) ts.line(c, colX(i), y, { width: cols[i]! - 4, size: 10, bold: abnormal }); });
      if (lang === "BILINGUAL" && (l.testAr || l.analyteAr)) { if (l.testAr) ts.line(l.testAr, colX(0), y + 11, { width: cols[0]! - 4, size: 8, color: "#4B5563" }); if (l.analyteAr) ts.line(l.analyteAr, colX(1), y + 11, { width: cols[1]! - 4, size: 8, color: "#4B5563" }); y += 12; }
      y += 16;
    }
    y += 16;
    if (y > doc.page.height - 150) { doc.addPage(); y = doc.page.margins.top; }
    if (!tpl) {
      ts.line(`Electronically signed by ${m.signedBy} (licence ${m.signatoryLicenceNo}) on ${m.signedAt}`, L, y, { width: W, size: 9 });
      ts.line(`Report ID ${m.reportId}  -  version ${m.version}`, L, y + 13, { width: W, size: 9 });
      // TODO_NEEDS_HUMAN (NH-LB-017): approved legal footer and signature policy wording.
      ts.line("TODO_NEEDS_HUMAN: legal footer pending approval. Results apply to the specimen as received.", L, y + 34, { width: W, size: 8, color: "#6B7280" });
    } else {
      ts.line(`${t("signed")} ${m.signedBy} (${label("licence", lang)} ${m.signatoryLicenceNo}) ${label("on", lang)} ${m.signedAt}`, L, y, { width: W - 100, size: 9 });
      ts.line(`${t("reportId")} ${m.reportId}  -  ${label("version", lang)} ${m.version}`, L, y + 13, { width: W - 100, size: 9 });
      // TODO_NEEDS_HUMAN (NH-LB-017): approved legal footer wording; a template footer overrides this placeholder.
      ts.line(tpl.footerText || "TODO_NEEDS_HUMAN: legal footer pending approval. Results apply to the specimen as received.", L, y + 34, { width: W - 100, size: 8, color: "#6B7280" });
      if (tpl.showQr && tpl.qrPayload) {
        const g = qrMatrix(tpl.qrPayload);
        const px = 2.4;
        const qx = L + W - g.length * px;
        g.forEach((row, r) => row.forEach((on, c) => { if (on) doc.rect(qx + c * px, y + r * px, px, px).fill("#000000"); }));
        doc.fillColor("#000000");
        ts.line(label("scan", lang), qx - 30, y + g.length * px + 3, { width: g.length * px + 60, size: 6, color: "#6B7280" });
      }
    }
    // ---- footer + page numbers on every page
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const fy = doc.page.height - 36;
      const prev = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      ts.line(`${tpl ? label("page", lang) : "Page"} ${i + 1} ${tpl ? label("of", lang) : "of"} ${range.count}`, L, fy, { width: W, size: 7, color: "#6B7280" });
      doc.page.margins.bottom = prev;
    }
    doc.end();
  });
}
