import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import PDFDocument from "pdfkit";
import { D } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { InsightsService } from "./insights.service";

/** CSV cell with RFC4180 quoting and spreadsheet-formula neutralisation (a leading = + - @ becomes text). */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]): string => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

const range = (from?: string, to?: string) => ({ gte: from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000), lte: to ? new Date(to) : new Date() });

export type ExportKind = "invoices" | "payments" | "orders" | "qc-runs" | "tat" | "results-summary";
export const EXPORT_KINDS: readonly ExportKind[] = ["invoices", "payments", "orders", "qc-runs", "tat", "results-summary"];

/**
 * Accountant/lab exports (CSV). VAT appears as plain columns (rate, amount, total). Businesses hand these files to their own accountant
 * (ADR-011); nothing here talks to any government system.
 */
@Injectable()
export class ExportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InsightsService) private readonly insights: InsightsService,
  ) {}

  async csv(orgId: string, kind: ExportKind, q: { from?: string; to?: string }): Promise<string> {
    const r = range(q.from, q.to);
    switch (kind) {
      case "invoices": {
        const rows = await this.prisma.invoice.findMany({ where: { orgId, createdAt: r }, include: { order: { select: { orderNumber: true } }, b2bAccount: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
        return toCsv(["number", "issued_at", "order", "account", "status", "currency", "subtotal", "vat_rate_percent", "vat_total", "total", "paid_total"], rows.map((i) => [i.number, i.issuedAt, i.order?.orderNumber, i.b2bAccount?.name, i.status, i.currency, D(i.subtotal), D(i.vatRatePercent), D(i.vatTotal), D(i.total), D(i.paidTotal)]));
      }
      case "payments": {
        const rows = await this.prisma.payment.findMany({ where: { orgId, createdAt: r }, include: { invoice: { select: { number: true, currency: true } } }, orderBy: { createdAt: "asc" } });
        return toCsv(["created_at", "invoice", "method", "status", "amount", "currency", "reference"], rows.map((p) => [p.createdAt, p.invoice.number, p.method, p.status, D(p.amount), p.invoice.currency, p.pspRef]));
      }
      case "orders": {
        const rows = await this.prisma.labOrder.findMany({ where: { orgId, createdAt: r }, include: { items: true }, orderBy: { createdAt: "asc" } });
        return toCsv(["order_number", "created_at", "source", "status", "priority", "collection", "tests"], rows.map((o) => [o.orderNumber, o.createdAt, o.source, o.status, o.priority, o.collectionType, o.items.length]));
      }
      case "qc-runs": {
        const rows = await this.prisma.qcRun.findMany({ where: { orgId, runAt: r }, include: { material: { include: { analyte: true } }, instrument: true }, orderBy: { runAt: "asc" } });
        return toCsv(["run_at", "instrument", "analyte", "level", "lot", "value", "z_score", "status", "violated_rules"], rows.map((x) => [x.runAt, x.instrument.name, x.material.analyte.code, x.material.level, x.material.materialLot, D(x.value), D(x.zScore), x.status, x.violatedRules.join(" ")]));
      }
      case "tat": {
        const t = await this.insights.tat(orgId, q);
        return toCsv(["order", "test", "priority", "target_minutes", "elapsed_minutes", "percent", "status"], t.rows.map((x) => [x.orderNumber, x.test, x.priority, x.targetMinutes, x.elapsedMinutes, x.percent, x.status]));
      }
      case "results-summary": {
        const rows = await this.prisma.result.groupBy({ by: ["analyteId", "flag"], where: { orgId, enteredAt: r, status: { notIn: ["CORRECTED", "REJECTED"] } }, _count: true });
        const analytes = await this.prisma.analyte.findMany({ where: { orgId } });
        return toCsv(["analyte", "flag", "count"], rows.map((x) => [analytes.find((a) => a.id === x.analyteId)?.code, x.flag, x._count]));
      }
      default:
        throw new BadRequestException({ code: "UNKNOWN_EXPORT" });
    }
  }

  /** Printable invoice / payment record with VAT lines (PDF). */
  async invoicePdf(orgId: string, id: string): Promise<Buffer> {
    const inv = await this.prisma.invoice.findFirst({ where: { id, orgId }, include: { lines: true, payments: { where: { status: "SUCCEEDED" } }, order: { select: { orderNumber: true, patient: { select: { fullName: true } } } } } });
    if (!inv) throw new NotFoundException({ code: "INVOICE_NOT_FOUND" });
    const lab = await this.prisma.lab.findUniqueOrThrow({ where: { id: inv.labId } });
    const latin = (s: string) => s.replace(/[^\x20-\x7e]/g, "?");
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Invoice ${inv.number}` } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(16).font("Helvetica-Bold").text(latin(lab.name));
      doc.moveDown(0.5).fontSize(12).text(`Invoice ${inv.number}`);
      doc.fontSize(9).font("Helvetica").text(`Order ${inv.order?.orderNumber ?? "-"}   Patient ${latin(inv.order?.patient.fullName ?? "-")}   Issued ${inv.issuedAt?.toISOString().slice(0, 10) ?? "-"}`).moveDown();
      doc.font("Helvetica-Bold").text("Description", 48, doc.y, { continued: true, width: 250 }).text("   Net        VAT %      VAT        Total");
      doc.font("Helvetica");
      for (const l of inv.lines) doc.text(`${latin(l.description).slice(0, 40).padEnd(42)} ${D(l.unitPrice).toFixed(2).padStart(9)} ${D(l.vatRatePercent).toFixed(1).padStart(7)} ${D(l.vatAmount).toFixed(2).padStart(9)} ${D(l.lineTotal).toFixed(2).padStart(10)}`);
      doc.moveDown().font("Helvetica-Bold").text(`Subtotal ${D(inv.subtotal).toFixed(2)}   VAT ${D(inv.vatTotal).toFixed(2)}   Total ${D(inv.total).toFixed(2)} ${inv.currency}   Paid ${D(inv.paidTotal).toFixed(2)}`);
      doc.moveDown().font("Helvetica").fontSize(8).fillColor("#6B7280").text("Payment record for the customer. VAT lines are informational; this document is not submitted to any authority.");
      doc.end();
    });
  }
}
