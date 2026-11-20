import { BadRequestException, Inject, Injectable, UnprocessableEntityException } from "@nestjs/common";
import type { AnalyteValueType, LabSection } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { csvRecords } from "../../common/csv";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogueService } from "./catalogue.service";
import { FormulaError, formulaInputs } from "../analysis-qc/formula";

export type ImportKind = "analytes" | "tests";
export interface ImportIssue { row: number; field: string; message: string }
export interface ImportReport { kind: ImportKind; dryRun: boolean; rows: number; created: number; updated: number; errors: ImportIssue[]; applied: boolean }

const SECTIONS: LabSection[] = ["GENERAL", "HEMATOLOGY", "CHEMISTRY", "IMMUNOLOGY", "SEROLOGY", "COAGULATION", "URINALYSIS", "MICROBIOLOGY", "HISTOPATHOLOGY", "CYTOLOGY", "MOLECULAR"];
const VALUE_TYPES: AnalyteValueType[] = ["NUMERIC", "TEXT", "SEMI_QUANT", "CHOICE"];
export const TEMPLATES: Record<ImportKind, { header: string; example: string }> = {
  analytes: { header: "code,name_en,name_ar,unit,precision,value_type,allowed_values,normal_values,formula,ref_low,ref_high,ref_low_m,ref_high_m,ref_low_f,ref_high_f,critical_low,critical_high", example: "HB,Haemoglobin,الهيموجلوبين,g/dL,1,NUMERIC,,,,,,13,17,12,15.5,7,20" },
  tests: { header: "code,name_en,name_ar,section,specimen_type,container,volume_ml,fasting,tat_minutes,price,send_out,analytes,prep_en,prep_ar", example: "CBC,Complete blood count,صورة دم كاملة,HEMATOLOGY,Whole blood,EDTA (lavender),3,false,120,120,false,HB|WBC|PLT," },
};

const bool = (s: string) => ["true", "yes", "1", "y"].includes(s.toLowerCase());
const isBool = (s: string) => s === "" || ["true", "false", "yes", "no", "1", "0", "y", "n"].includes(s.toLowerCase());
const num = (s: string) => (s === "" ? undefined : Number(s));
const isNum = (s: string) => s === "" || Number.isFinite(Number(s));
const list = (s: string) => (s ? s.split("|").map((x) => x.trim()).filter(Boolean) : []);

/** M9: bulk import of the test catalogue from CSV (analytes with reference ranges / critical limits, and tests). Dry run validates every row first; applying is refused if any row is invalid. */
@Injectable()
export class CatalogueImportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
  ) {}

  template(kind: ImportKind): string { return `${TEMPLATES[kind].header}\r\n${TEMPLATES[kind].example}\r\n`; }

  async import(u: AuthUser, kind: ImportKind, csv: string, dryRun: boolean): Promise<ImportReport> {
    let parsed: ReturnType<typeof csvRecords>;
    try { parsed = csvRecords(csv); } catch (e) { throw new BadRequestException({ code: "CSV_INVALID", message: (e as Error).message }); }
    const required = TEMPLATES[kind].header.split(",").slice(0, kind === "analytes" ? 2 : 6);
    const missing = required.filter((h) => !parsed.headers.includes(h));
    if (missing.length) throw new BadRequestException({ code: "CSV_HEADERS_MISSING", missing });
    if (parsed.records.length > 2000) throw new BadRequestException({ code: "CSV_TOO_LARGE", max: 2000 });
    const errors: ImportIssue[] = [];
    const err = (row: number, field: string, message: string) => errors.push({ row, field, message });
    const existingAnalytes = new Map((await this.prisma.analyte.findMany({ where: { orgId: u.orgId } })).map((a) => [a.code, a]));
    const existingTests = new Set((await this.prisma.testDefinition.findMany({ where: { orgId: u.orgId }, select: { code: true } })).map((t) => t.code));
    const seen = new Set<string>();
    const fileAnalytes = new Set<string>();
    if (kind === "analytes") for (const r of parsed.records) fileAnalytes.add((r.code ?? "").toUpperCase());
    let created = 0;
    let updated = 0;
    parsed.records.forEach((r, i) => {
      const row = i + 2;
      const code = (r.code ?? "").toUpperCase();
      if (!/^[A-Z0-9_.-]{1,32}$/.test(code)) return err(row, "code", "1-32 letters, digits, _ . -");
      if (seen.has(code)) return err(row, "code", "duplicate code in the file");
      seen.add(code);
      if (!r.name_en) err(row, "name_en", "required");
      if (kind === "analytes") {
        if (r.value_type && !VALUE_TYPES.includes(r.value_type.toUpperCase() as AnalyteValueType)) err(row, "value_type", `one of ${VALUE_TYPES.join("/")}`);
        const vt = (r.value_type || "NUMERIC").toUpperCase();
        const allowed = list(r.allowed_values ?? "");
        if ((vt === "CHOICE" || vt === "SEMI_QUANT") && !allowed.length) err(row, "allowed_values", "required for CHOICE / SEMI_QUANT (separate with |)");
        if (list(r.normal_values ?? "").some((v) => !allowed.includes(v))) err(row, "normal_values", "must be a subset of allowed_values");
        for (const f of ["precision", "ref_low", "ref_high", "ref_low_m", "ref_high_m", "ref_low_f", "ref_high_f", "critical_low", "critical_high"]) if (!isNum(r[f] ?? "")) err(row, f, "not a number");
        for (const [lo, hi] of [["ref_low", "ref_high"], ["ref_low_m", "ref_high_m"], ["ref_low_f", "ref_high_f"], ["critical_low", "critical_high"]] as const) if (r[lo] && r[hi] && Number(r[lo]) > Number(r[hi])) err(row, lo, `${lo} is above ${hi}`);
        if (r.formula) {
          try {
            const ins = formulaInputs(r.formula);
            const bad = ins.filter((c) => !existingAnalytes.has(c) && !fileAnalytes.has(c));
            if (bad.length) err(row, "formula", `unknown analyte(s): ${bad.join(", ")}`);
            if (ins.includes(code)) err(row, "formula", "an analyte cannot use itself");
          } catch (e) { err(row, "formula", e instanceof FormulaError ? e.message : "invalid"); }
        }
        existingAnalytes.has(code) ? updated++ : created++;
      } else {
        if (!r.specimen_type) err(row, "specimen_type", "required");
        if (r.section && !SECTIONS.includes(r.section.toUpperCase() as LabSection)) err(row, "section", `one of ${SECTIONS.join("/")}`);
        for (const f of ["volume_ml", "tat_minutes"]) if (!isNum(r[f] ?? "")) err(row, f, "not a number");
        if (!isNum(r.price ?? "") || r.price === "") err(row, "price", "required number");
        for (const f of ["fasting", "send_out"]) if (!isBool(r[f] ?? "")) err(row, f, "true/false");
        const ac = list(r.analytes ?? "").map((a) => a.toUpperCase());
        if (!ac.length) err(row, "analytes", "at least one analyte code (separate with |)");
        const unknown = ac.filter((a) => !existingAnalytes.has(a));
        if (unknown.length) err(row, "analytes", `unknown analyte(s): ${unknown.join(", ")}`);
        existingTests.has(code) ? updated++ : created++;
      }
    });
    const report: ImportReport = { kind, dryRun, rows: parsed.records.length, created, updated, errors, applied: false };
    if (dryRun) return report;
    if (errors.length) throw new UnprocessableEntityException({ code: "IMPORT_INVALID", ...report });
    // analytes: inputs first, then calculated analytes (their formula may reference rows of the same file)
    const ordered = kind === "analytes" ? [...parsed.records.filter((r) => !r.formula), ...parsed.records.filter((r) => r.formula)] : parsed.records;
    for (const r of ordered) {
      const code = r.code!.toUpperCase();
      if (kind === "analytes") await this.applyAnalyte(u, code, r, existingAnalytes.has(code));
      else await this.applyTest(u, code, r, existingTests.has(code));
    }
    return { ...report, applied: true };
  }

  private async applyAnalyte(u: AuthUser, code: string, r: Record<string, string>, exists: boolean) {
    const spec = { nameEn: r.name_en!, nameAr: r.name_ar || undefined, unit: r.unit || undefined, precision: num(r.precision ?? "") ?? 1, valueType: ((r.value_type || "NUMERIC").toUpperCase()) as AnalyteValueType, allowedValues: list(r.allowed_values ?? ""), normalValues: list(r.normal_values ?? ""), formula: r.formula || undefined };
    // formula inputs may be created by the same file: analytes without a formula are applied first (see import order below)
    let id: string;
    if (exists) {
      const a = await this.prisma.analyte.findFirstOrThrow({ where: { orgId: u.orgId, code } });
      await this.catalogue.updateAnalyte(u, a.id, { ...spec, formula: r.formula || null });
      id = a.id;
    } else id = (await this.catalogue.createAnalyte(u, { code, ...spec })).id;
    const ranges: [("M" | "F" | null), number, string, string][] = [[null, 0, r.ref_low ?? "", r.ref_high ?? ""], ["M", 6570, r.ref_low_m ?? "", r.ref_high_m ?? ""], ["F", 6570, r.ref_low_f ?? "", r.ref_high_f ?? ""]];
    for (const [sex, ageMinDays, lo, hi] of ranges) {
      if (lo === "" && hi === "") continue;
      const cur = await this.prisma.referenceInterval.findFirst({ where: { orgId: u.orgId, analyteId: id, sex, ageMinDays, condition: null, effectiveTo: null }, orderBy: { version: "desc" } });
      const same = cur && (cur.low == null ? "" : String(Number(cur.low))) === (lo === "" ? "" : String(Number(lo))) && (cur.high == null ? "" : String(Number(cur.high))) === (hi === "" ? "" : String(Number(hi)));
      if (!same) await this.catalogue.addInterval(u, id, { sex, ageMinDays, low: num(lo) ?? null, high: num(hi) ?? null, source: "CSV_IMPORT" });
    }
    if (r.critical_low || r.critical_high) {
      const cur = await this.prisma.criticalRule.findFirst({ where: { orgId: u.orgId, analyteId: id, active: true } });
      const lo = num(r.critical_low ?? "") ?? null;
      const hi = num(r.critical_high ?? "") ?? null;
      if (!cur || (cur.criticalLow == null ? null : Number(cur.criticalLow)) !== lo || (cur.criticalHigh == null ? null : Number(cur.criticalHigh)) !== hi) await this.catalogue.setCriticalRule(u, id, { criticalLow: lo, criticalHigh: hi, ackWithinMinutes: cur?.ackWithinMinutes ?? 30 });
    }
  }

  private async applyTest(u: AuthUser, code: string, r: Record<string, string>, exists: boolean) {
    const body = {
      nameEn: r.name_en!, nameAr: r.name_ar || undefined, specimenType: r.specimen_type!, container: r.container || undefined, volumeMl: num(r.volume_ml ?? ""), fastingRequired: bool(r.fasting ?? ""),
      prepInstructionsEn: r.prep_en || undefined, prepInstructionsAr: r.prep_ar || undefined, tatMinutes: num(r.tat_minutes ?? ""), price: Number(r.price), sendOut: bool(r.send_out ?? ""), analyteCodes: list(r.analytes ?? "").map((a) => a.toUpperCase()), section: ((r.section || "GENERAL").toUpperCase()) as LabSection,
    };
    if (exists) {
      const t = await this.prisma.testDefinition.findFirstOrThrow({ where: { orgId: u.orgId, code } });
      await this.catalogue.updateTest(u, t.id, body as never);
    } else await this.catalogue.createTest(u, { code, ...body });
  }

  // ---------------------------------------------------------------- units
  /** Units of measure in use with the number of analytes using each (settings > units). */
  async units(orgId: string) {
    const g = await this.prisma.analyte.groupBy({ by: ["unit"], where: { orgId, unit: { not: null } }, _count: true, orderBy: { unit: "asc" } });
    return g.map((x) => ({ unit: x.unit, analytes: x._count }));
  }
  async renameUnit(u: AuthUser, from: string, to: string) {
    if (!to.trim() || to.length > 20) throw new BadRequestException({ code: "UNIT_INVALID" });
    const r = await this.prisma.analyte.updateMany({ where: { orgId: u.orgId, unit: from }, data: { unit: to.trim() } });
    return { from, to: to.trim(), analytes: r.count };
  }
}
