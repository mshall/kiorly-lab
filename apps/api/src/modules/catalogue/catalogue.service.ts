import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Sex } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, type Db } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { KERNEL_PRICE_BOOK, type PriceBookPort } from "../../kernel-adapter/ports";
import { pickInterval } from "../../common/clinical-flags";

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

  async createAnalyte(u: AuthUser, b: { code: string; nameEn: string; nameAr?: string; unit?: string; precision?: number; analyzerCodes?: string[] }) {
    const code = b.code.trim().toUpperCase();
    if (await this.prisma.analyte.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "ANALYTE_CODE_EXISTS" });
    const a = await this.prisma.analyte.create({ data: { orgId: u.orgId, code, nameEn: b.nameEn, nameAr: b.nameAr, unit: b.unit, precision: b.precision ?? 1, analyzerCodes: b.analyzerCodes ?? [code] } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "analyte.create", entityType: "Analyte", entityId: a.id });
    return a;
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
      prepInstructionsEn?: string; prepInstructionsAr?: string; tatMinutes?: number; price: number; sendOut?: boolean; analyteCodes?: string[];
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
          tatMinutes: b.tatMinutes, price: b.price, sendOut: b.sendOut ?? false,
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
  async addInterval(u: AuthUser, analyteId: string, b: { sex?: Sex | null; ageMinDays?: number; ageMaxDays?: number | null; low?: number | null; high?: number | null; source?: string }) {
    if (b.low != null && b.high != null && b.low > b.high) throw new BadRequestException({ code: "INTERVAL_INVALID" });
    const a = await this.prisma.analyte.findFirst({ where: { id: analyteId, orgId: u.orgId } });
    if (!a) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    const sex = b.sex ?? null;
    const ageMinDays = b.ageMinDays ?? 0;
    return this.prisma.$transaction(async (tx) => {
      const cur = await tx.referenceInterval.findFirst({ where: { orgId: u.orgId, analyteId, sex, ageMinDays, effectiveTo: null }, orderBy: { version: "desc" } });
      const now = new Date();
      if (cur) await tx.referenceInterval.update({ where: { id: cur.id }, data: { effectiveTo: now } });
      const latest = await tx.referenceInterval.findFirst({ where: { analyteId, sex, ageMinDays }, orderBy: { version: "desc" } });
      const row = await tx.referenceInterval.create({
        data: { orgId: u.orgId, analyteId, sex, ageMinDays, ageMaxDays: b.ageMaxDays ?? null, low: b.low ?? null, high: b.high ?? null, version: (latest?.version ?? 0) + 1, effectiveFrom: now, source: b.source, createdBy: u.staffId },
      });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "reference_interval.version", entityType: "ReferenceInterval", entityId: row.id, meta: { analyteId, version: row.version } }, tx);
      return row;
    });
  }

  async resolveInterval(db: Db, orgId: string, analyteId: string, sex: string, ageDays: number | null, at: Date) {
    const cands = await db.referenceInterval.findMany({ where: { orgId, analyteId } });
    return pickInterval(cands, sex, ageDays, at);
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
