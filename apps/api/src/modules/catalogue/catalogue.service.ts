import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AnalyteValueType, LabSection, Sex } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, type Db } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { KERNEL_PRICE_BOOK, type PriceBookPort } from "../../kernel-adapter/ports";
import { pickInterval } from "../../common/clinical-flags";
import { formulaInputs, FormulaError } from "../analysis-qc/formula";

@Injectable()
export class CatalogueService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(KERNEL_PRICE_BOOK) private readonly prices: PriceBookPort,
  ) {}

  // ------------------------------------------------------------ analytes
  listAnalytes(orgId: string) {
    return this.prisma.analyte.findMany({ where: { orgId }, orderBy: { code: "asc" } });
  }

  private async checkAnalyteSpec(orgId: string, selfCode: string | null, b: { valueType?: AnalyteValueType; allowedValues?: string[]; normalValues?: string[]; formula?: string | null }) {
    const type = b.valueType ?? "NUMERIC";
    if ((type === "CHOICE" || type === "SEMI_QUANT") && !(b.allowedValues?.length)) throw new BadRequestException({ code: "ALLOWED_VALUES_REQUIRED" });
    if (b.normalValues?.some((v) => !(b.allowedValues ?? []).includes(v))) throw new BadRequestException({ code: "NORMAL_VALUES_NOT_ALLOWED" });
    if (b.formula) {
      if (type !== "NUMERIC") throw new BadRequestException({ code: "FORMULA_NUMERIC_ONLY" });
      let inputs: string[];
      try { inputs = formulaInputs(b.formula); } catch (e) { if (e instanceof FormulaError) throw new BadRequestException({ code: "FORMULA_INVALID", message: e.message }); throw e; }
      if (!inputs.length) throw new BadRequestException({ code: "FORMULA_INVALID", message: "a calculated analyte needs at least one input analyte" });
      if (selfCode && inputs.includes(selfCode)) throw new BadRequestException({ code: "FORMULA_SELF_REFERENCE" });
      const found = await this.prisma.analyte.findMany({ where: { orgId, code: { in: inputs } } });
      const missing = inputs.filter((c) => !found.some((f) => f.code === c));
      if (missing.length) throw new BadRequestException({ code: "FORMULA_UNKNOWN_ANALYTE", analytes: missing });
      const chained = found.filter((f) => f.formula);
      if (chained.length) throw new BadRequestException({ code: "FORMULA_CHAINED", message: "calculated analytes cannot be inputs of other calculated analytes", analytes: chained.map((c) => c.code) });
    }
  }

  async createAnalyte(u: AuthUser, b: { code: string; nameEn: string; nameAr?: string; unit?: string; precision?: number; analyzerCodes?: string[]; valueType?: AnalyteValueType; allowedValues?: string[]; normalValues?: string[]; formula?: string }) {
    const code = b.code.trim().toUpperCase();
    if (await this.prisma.analyte.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "ANALYTE_CODE_EXISTS" });
    await this.checkAnalyteSpec(u.orgId, code, b);
    const a = await this.prisma.analyte.create({ data: { orgId: u.orgId, code, nameEn: b.nameEn, nameAr: b.nameAr, unit: b.unit, precision: b.precision ?? 1, analyzerCodes: b.analyzerCodes ?? [code], valueType: b.valueType ?? "NUMERIC", allowedValues: b.allowedValues ?? [], normalValues: b.normalValues ?? [], formula: b.formula ?? null } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "analyte.create", entityType: "Analyte", entityId: a.id });
    return a;
  }

  async updateAnalyte(u: AuthUser, id: string, b: Partial<{ nameEn: string; nameAr: string; unit: string; precision: number; analyzerCodes: string[]; valueType: AnalyteValueType; allowedValues: string[]; normalValues: string[]; formula: string | null; active: boolean }>) {
    const cur = await this.prisma.analyte.findFirst({ where: { id, orgId: u.orgId } });
    if (!cur) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    await this.checkAnalyteSpec(u.orgId, cur.code, { valueType: b.valueType ?? cur.valueType, allowedValues: b.allowedValues ?? cur.allowedValues, normalValues: b.normalValues ?? cur.normalValues, formula: b.formula === undefined ? cur.formula : b.formula });
    const row = await this.prisma.analyte.update({ where: { id }, data: b });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "analyte.update", entityType: "Analyte", entityId: id, meta: { fields: Object.keys(b) } });
    return row;
  }

  // --------------------------------------------------------------- tests
  async listTests(orgId: string, q: { active?: string; search?: string } = {}) {
    const rows = await this.prisma.testDefinition.findMany({
      where: {
        orgId,
        ...(q.active === "false" ? {} : { active: true }),
        ...(q.search ? { OR: [{ code: { contains: q.search, mode: "insensitive" } }, { nameEn: { contains: q.search, mode: "insensitive" } }, { nameAr: { contains: q.search } }] } : {}),
      },
      include: { analytes: { include: { analyte: true }, orderBy: { position: "asc" } } },
      orderBy: { code: "asc" },
    });
    return rows.map((t) => ({ ...t, price: D(t.price), volumeMl: t.volumeMl == null ? null : D(t.volumeMl) }));
  }

  async getTest(orgId: string, id: string) {
    const t = await this.prisma.testDefinition.findFirst({ where: { id, orgId }, include: { analytes: { include: { analyte: true }, orderBy: { position: "asc" } } } });
    if (!t) throw new NotFoundException({ code: "TEST_NOT_FOUND" });
    return t;
  }

  async createTest(
    u: AuthUser,
    b: {
      code: string; nameEn: string; nameAr?: string; specimenType: string; container?: string; volumeMl?: number; fastingRequired?: boolean;
      prepInstructionsEn?: string; prepInstructionsAr?: string; tatMinutes?: number; price: number; sendOut?: boolean; analyteCodes?: string[]; section?: LabSection;
    },
  ) {
    const code = b.code.trim().toUpperCase();
    if (!b.analyteCodes?.length) throw new BadRequestException({ code: "TEST_NEEDS_ANALYTE", message: "a test needs at least one analyte so results can be entered" });
    if (await this.prisma.testDefinition.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "TEST_CODE_EXISTS" });
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.testDefinition.create({
        data: {
          orgId: u.orgId, code, nameEn: b.nameEn, nameAr: b.nameAr, specimenType: b.specimenType, container: b.container, volumeMl: b.volumeMl,
          fastingRequired: b.fastingRequired ?? false, prepInstructionsEn: b.prepInstructionsEn, prepInstructionsAr: b.prepInstructionsAr,
          tatMinutes: b.tatMinutes, price: b.price, sendOut: b.sendOut ?? false, section: b.section ?? "GENERAL",
        },
      });
      await this.linkAnalytes(tx, u.orgId, t.id, b.analyteCodes ?? []);
      const list = await this.defaultPriceList(tx, u.orgId);
      await this.prices.set({ orgId: u.orgId, priceListId: list.id, testId: t.id, amount: b.price, actorId: u.staffId }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "test.create", entityType: "TestDefinition", entityId: t.id }, tx);
      return t;
    });
  }

  async updateTest(u: AuthUser, id: string, b: Partial<{ nameEn: string; nameAr: string; specimenType: string; container: string; volumeMl: number; fastingRequired: boolean; prepInstructionsEn: string; prepInstructionsAr: string; tatMinutes: number; active: boolean; sendOut: boolean; price: number; analyteCodes: string[] }>) {
    await this.getTest(u.orgId, id);
    const { price, analyteCodes, ...rest } = b;
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.testDefinition.update({ where: { id }, data: rest });
      if (analyteCodes) {
        await tx.testAnalyte.deleteMany({ where: { testId: id } });
        await this.linkAnalytes(tx, u.orgId, id, analyteCodes);
      }
      let priceVersion: number | undefined;
      if (price != null) {
        const list = await this.defaultPriceList(tx, u.orgId);
        priceVersion = (await this.prices.set({ orgId: u.orgId, priceListId: list.id, testId: id, amount: price, actorId: u.staffId }, tx)).version;
      }
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "test.update", entityType: "TestDefinition", entityId: id, meta: { fields: Object.keys(b), priceVersion } }, tx);
      return { ...t, priceVersion };
    });
  }

  private async linkAnalytes(tx: Db, orgId: string, testId: string, codes: string[]) {
    let pos = 0;
    for (const c of codes) {
      const a = await tx.analyte.findFirst({ where: { orgId, code: c.toUpperCase() } });
      if (!a) throw new BadRequestException({ code: "UNKNOWN_ANALYTE", analyte: c });
      await tx.testAnalyte.create({ data: { testId, analyteId: a.id, position: pos++ } });
    }
  }

  async defaultPriceList(db: Db, orgId: string) {
    const found = await db.priceList.findFirst({ where: { orgId, isDefault: true } });
    if (found) return found;
    const t = await db.tenant.findUniqueOrThrow({ where: { id: orgId } });
    return db.priceList.create({ data: { orgId, name: "Standard", isDefault: true, currency: t.currency } });
  }

  async priceHistory(orgId: string, testId: string) {
    return this.prisma.priceListItem.findMany({ where: { orgId, testId }, orderBy: [{ priceListId: "asc" }, { version: "desc" }] });
  }

  // ------------------------------------------------------------ packages
  async listPackages(orgId: string) {
    const rows = await this.prisma.testPackage.findMany({ where: { orgId }, include: { items: { include: { test: true } } }, orderBy: { code: "asc" } });
    return rows.map((p) => ({ ...p, price: D(p.price) }));
  }
  async createPackage(u: AuthUser, b: { code: string; nameEn: string; nameAr?: string; price: number; testCodes: string[] }) {
    const code = b.code.trim().toUpperCase();
    return this.prisma.$transaction(async (tx) => {
      if (await tx.testPackage.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "PACKAGE_CODE_EXISTS" });
      const p = await tx.testPackage.create({ data: { orgId: u.orgId, code, nameEn: b.nameEn, nameAr: b.nameAr, price: b.price } });
      for (const tc of b.testCodes) {
        const t = await tx.testDefinition.findFirst({ where: { orgId: u.orgId, code: tc.toUpperCase() } });
        if (!t) throw new BadRequestException({ code: "UNKNOWN_TEST", test: tc });
        await tx.testPackageItem.create({ data: { packageId: p.id, testId: t.id } });
      }
      const list = await this.defaultPriceList(tx, u.orgId);
      await this.prices.set({ orgId: u.orgId, priceListId: list.id, packageId: p.id, amount: b.price, actorId: u.staffId }, tx);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "package.create", entityType: "TestPackage", entityId: p.id }, tx);
      return p;
    });
  }

  // -------------------------------------------------- reference intervals
  listIntervals(orgId: string, analyteId: string) {
    return this.prisma.referenceInterval.findMany({ where: { orgId, analyteId }, orderBy: [{ sex: "asc" }, { ageMinDays: "asc" }, { version: "desc" }] });
  }

  /** KLQC03: versioned, never edited in place — closes the prior version and inserts version+1. */
  async addInterval(u: AuthUser, analyteId: string, b: { sex?: Sex | null; ageMinDays?: number; ageMaxDays?: number | null; low?: number | null; high?: number | null; source?: string; condition?: string | null }) {
    if (b.low != null && b.high != null && b.low > b.high) throw new BadRequestException({ code: "INTERVAL_INVALID" });
    const a = await this.prisma.analyte.findFirst({ where: { id: analyteId, orgId: u.orgId } });
    if (!a) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    const sex = b.sex ?? null;
    const ageMinDays = b.ageMinDays ?? 0;
    return this.prisma.$transaction(async (tx) => {
      const condition = b.condition ?? null;
      const cur = await tx.referenceInterval.findFirst({ where: { orgId: u.orgId, analyteId, sex, ageMinDays, condition, effectiveTo: null }, orderBy: { version: "desc" } });
      const now = new Date();
      if (cur) await tx.referenceInterval.update({ where: { id: cur.id }, data: { effectiveTo: now } });
      const latest = await tx.referenceInterval.findFirst({ where: { analyteId, sex, ageMinDays, condition }, orderBy: { version: "desc" } });
      const row = await tx.referenceInterval.create({
        data: { orgId: u.orgId, analyteId, sex, ageMinDays, condition, ageMaxDays: b.ageMaxDays ?? null, low: b.low ?? null, high: b.high ?? null, version: (latest?.version ?? 0) + 1, effectiveFrom: now, source: b.source, createdBy: u.staffId },
      });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "reference_interval.version", entityType: "ReferenceInterval", entityId: row.id, meta: { analyteId, version: row.version } }, tx);
      return row;
    });
  }

  async resolveInterval(db: Db, orgId: string, analyteId: string, sex: string, ageDays: number | null, at: Date, conditions: readonly string[] = []) {
    const cands = await db.referenceInterval.findMany({ where: { orgId, analyteId } });
    return pickInterval(cands, sex, ageDays, at, conditions);
  }

  // ----------------------------------------------------- critical rules
  listCriticalRules(orgId: string) {
    return this.prisma.criticalRule.findMany({ where: { orgId, active: true }, include: { analyte: true } });
  }

  /** KLCRIT01: one active rule per analyte; replacing deactivates the previous. The ack window is bounded 1..1440 min (DB CHECK too). */
  async setCriticalRule(u: AuthUser, analyteId: string, b: { criticalLow?: number | null; criticalHigh?: number | null; ackWithinMinutes: number }) {
    if (b.criticalLow == null && b.criticalHigh == null) throw new BadRequestException({ code: "CRITICAL_LIMIT_REQUIRED" });
    if (b.criticalLow != null && b.criticalHigh != null && b.criticalLow >= b.criticalHigh) throw new BadRequestException({ code: "CRITICAL_RANGE_INVALID" });
    if (!(await this.prisma.analyte.findFirst({ where: { id: analyteId, orgId: u.orgId } }))) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    return this.prisma.$transaction(async (tx) => {
      await tx.criticalRule.updateMany({ where: { orgId: u.orgId, analyteId, active: true }, data: { active: false } });
      const r = await tx.criticalRule.create({ data: { orgId: u.orgId, analyteId, criticalLow: b.criticalLow ?? null, criticalHigh: b.criticalHigh ?? null, ackWithinMinutes: b.ackWithinMinutes } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "critical_rule.set", entityType: "CriticalRule", entityId: r.id, meta: { analyteId, ackWithinMinutes: b.ackWithinMinutes } }, tx);
      return r;
    });
  }
}
