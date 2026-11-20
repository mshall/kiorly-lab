import PDFDocument from "pdfkit";
import { Typesetter, label, type ReportTemplateView } from "../release/report-pdf";

export interface CumulativeModel {
  labName: string;
  patient: { name: string; sex: string; dateOfBirth: string | null; mrn: string | null };
  generatedAt: string;
  groups: { analyte: { code: string; nameEn: string; nameAr: string | null; unit: string | null }; points: { at: string; value: number; flag: string; refLow: number | null; refHigh: number | null; orderNumber: string | null }[] }[];
  template?: ReportTemplateView;
}

const MAX_ROWS = 8;

/** Cumulative (trend) report: per analyte the latest results in a table plus a small trend chart with the reference band. */
export function renderCumulativePdf(m: CumulativeModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lang = m.template?.language ?? "EN";
    const accent = /^#[0-9a-fA-F]{6}$/.test(m.template?.accentColor ?? "") ? m.template!.accentColor : "#3730A3";
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true, info: { Title: `Cumulative report ${m.patient.name}`, Producer: "Kiorly Lab" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const ts = new Typesetter(doc);
    const L = doc.page.margins.left;
    const W = doc.page.width - L - doc.page.margins.right;
    const title = lang === "AR" ? "التقرير التراكمي للنتائج" : lang === "BILINGUAL" ? "Cumulative results report  /  التقرير التراكمي للنتائج" : "Cumulative results report";
    ts.line(m.template?.headerTitle || m.labName, L, doc.y, { width: W, size: 18, bold: true, color: accent });
    doc.y += 24;
    ts.line(title, L, doc.y, { width: W, size: 13, bold: true });
    doc.y += 20;
    ts.line(`${label("patient", lang)}: ${m.patient.name}${m.patient.mrn ? `   (${m.patient.mrn})` : ""}`, L, doc.y, { width: W, size: 10 });
    doc.y += 14;
    ts.line(`${label("sex", lang)}: ${m.patient.sex}    ${label("dob", lang)}: ${m.patient.dateOfBirth ?? "-"}`, L, doc.y, { width: W, size: 10 });
    doc.y += 14;
    doc.save().lineWidth(1.2).strokeColor(accent).moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).stroke().restore();
    doc.y += 14;

    for (const g of m.groups) {
      const pts = g.points.slice(-MAX_ROWS);
      const need = 40 + pts.length * 14;
      if (doc.y + need > doc.page.height - 70) doc.addPage();
      const top = doc.y;
      const name = lang === "AR" && g.analyte.nameAr ? g.analyte.nameAr : g.analyte.nameEn;
      ts.line(`${name} (${g.analyte.code})${g.analyte.unit ? `  -  ${g.analyte.unit}` : ""}`, L, top, { width: W, size: 11, bold: true });
      if (lang === "BILINGUAL" && g.analyte.nameAr) ts.line(g.analyte.nameAr, L, top + 13, { width: 250, size: 9, color: "#4B5563" });
      let y = top + 28;
      pts.forEach((p) => {
        const out = p.flag !== "NORMAL";
        ts.line(p.at.slice(0, 10), L, y, { width: 70, size: 9 });
        ts.line(String(p.value), L + 80, y, { width: 60, size: 9, bold: out });
        ts.line(p.flag === "NORMAL" ? "" : p.flag.replace("CRITICAL_", "C-"), L + 140, y, { width: 50, size: 8, bold: true, color: out ? "#B91C1C" : "#000000" });
        ts.line(p.refLow != null || p.refHigh != null ? `${p.refLow ?? ""} - ${p.refHigh ?? ""}` : "", L + 190, y, { width: 70, size: 8, color: "#6B7280" });
        y += 14;
      });
      // trend chart on the right: reference band + polyline + points
      const cx = L + 290, cy = top + 4, cw = W - 290, ch = Math.max(46, Math.min(pts.length * 14 + 14, 110));
      doc.save().rect(cx, cy, cw, ch).lineWidth(0.5).strokeColor("#D1D5DB").stroke().restore();
      const vals = pts.map((p) => p.value);
      const lo = Math.min(...vals, ...pts.map((p) => p.refLow ?? Infinity).filter(Number.isFinite));
      const hi = Math.max(...vals, ...pts.map((p) => p.refHigh ?? -Infinity).filter(Number.isFinite));
      const span = hi - lo || 1;
      const Y = (v: number) => cy + ch - 6 - ((v - lo) / span) * (ch - 12);
      const X = (i: number) => cx + 8 + (pts.length === 1 ? (cw - 16) / 2 : (i * (cw - 16)) / (pts.length - 1));
      const last = pts.at(-1);
      if (last && last.refLow != null && last.refHigh != null) doc.save().rect(cx + 1, Y(last.refHigh), cw - 2, Math.max(1, Y(last.refLow) - Y(last.refHigh))).fillOpacity(0.12).fill("#16A34A").restore();
      doc.save().lineWidth(1.2).strokeColor(accent);
      pts.forEach((p, i) => (i === 0 ? doc.moveTo(X(i), Y(p.value)) : doc.lineTo(X(i), Y(p.value))));
      doc.stroke().restore();
      pts.forEach((p, i) => doc.save().circle(X(i), Y(p.value), 2).fill(p.flag === "NORMAL" ? accent : "#B91C1C").restore());
      doc.y = Math.max(y, cy + ch) + 14;
    }
    if (!m.groups.length) ts.line("No validated results on file.", L, doc.y, { width: W, size: 10 });
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const prev = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      ts.line(`${m.template?.footerText ?? "Validated and released results only."}   -   ${m.generatedAt}   -   ${label("page", lang)} ${i + 1} ${label("of", lang)} ${range.count}`, L, doc.page.height - 36, { width: W, size: 7, color: "#6B7280" });
      doc.page.margins.bottom = prev;
    }
    doc.end();
  });
}
