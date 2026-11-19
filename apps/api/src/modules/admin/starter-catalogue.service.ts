import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { STARTER_ANALYTES, STARTER_PACKAGES, STARTER_TESTS } from "./starter-catalogue";
import type { Db } from "../../common/db";

/** Idempotent loader of the synthetic starter catalogue (analytes, intervals, critical rules, QC materials, tests, packages, default price list). */
@Injectable()
export class StarterCatalogueService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async load(orgId: string, db: Db = this.prisma): Promise<{ analytes: number; tests: number; packages: number }> {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: orgId } });
    let pl = await db.priceList.findFirst({ where: { orgId, isDefault: true } });
    pl ??= await db.priceList.create({ data: { orgId, name: "Standard", isDefault: true, currency: tenant.currency } });
    const analyteIds = new Map<string, string>();
    for (const a of STARTER_ANALYTES) {
      const row = (await db.analyte.findFirst({ where: { orgId, code: a.code } })) ?? (await db.analyte.create({ data: { orgId, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, unit: a.unit, precision: a.precision, analyzerCodes: [a.code] } }));
      analyteIds.set(a.code, row.id);
      if (!(await db.referenceInterval.findFirst({ where: { orgId, analyteId: row.id } }))) {
        const mk = (sex: "M" | "F" | null, r: [number, number]) => db.referenceInterval.create({ data: { orgId, analyteId: row.id, sex, ageMinDays: 6570, low: r[0], high: r[1], effectiveFrom: new Date(), source: "SYNTHETIC_DEMO (NH-LB-013)" } });
        if (a.both) await mk(null, a.both);
        if (a.male) await mk("M", a.male);
        if (a.female) await mk("F", a.female);
        // children: use the adult range as a demo placeholder (age 0..6569 days)
        const r = a.both ?? a.male ?? a.female!;
        await db.referenceInterval.create({ data: { orgId, analyteId: row.id, sex: null, ageMinDays: 0, ageMaxDays: 6569, low: r[0], high: r[1], effectiveFrom: new Date(), source: "SYNTHETIC_DEMO (NH-LB-013)" } });
      }
      if (a.critical && !(await db.criticalRule.findFirst({ where: { orgId, analyteId: row.id } }))) {
        await db.criticalRule.create({ data: { orgId, analyteId: row.id, criticalLow: a.critical.low ?? null, criticalHigh: a.critical.high ?? null, ackWithinMinutes: a.critical.ack } });
      }
    }
    let tests = 0;
    for (const t of STARTER_TESTS) {
      if (await db.testDefinition.findFirst({ where: { orgId, code: t.code } })) continue;
      const row = await db.testDefinition.create({ data: { orgId, code: t.code, nameEn: t.nameEn, nameAr: t.nameAr, specimenType: t.specimenType, container: t.container, volumeMl: t.volumeMl, fastingRequired: t.fasting ?? false, prepInstructionsEn: t.prepEn, prepInstructionsAr: t.prepAr, tatMinutes: t.tatMinutes, price: t.price, sendOut: t.sendOut ?? false } });
      let pos = 0;
      for (const ac of t.analytes) await db.testAnalyte.create({ data: { testId: row.id, analyteId: analyteIds.get(ac)!, position: pos++ } });
      await db.priceListItem.create({ data: { orgId, priceListId: pl.id, testId: row.id, amount: t.price, version: 1 } });
      tests++;
    }
    let packages = 0;
    for (const p of STARTER_PACKAGES) {
      if (await db.testPackage.findFirst({ where: { orgId, code: p.code } })) continue;
      const row = await db.testPackage.create({ data: { orgId, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr, price: p.price } });
      for (const tc of p.tests) {
        const t = await db.testDefinition.findFirstOrThrow({ where: { orgId, code: tc } });
        await db.testPackageItem.create({ data: { packageId: row.id, testId: t.id } });
      }
      await db.priceListItem.create({ data: { orgId, priceListId: pl.id, packageId: row.id, amount: p.price, version: 1 } });
      packages++;
    }
    return { analytes: STARTER_ANALYTES.length, tests, packages };
  }
}
