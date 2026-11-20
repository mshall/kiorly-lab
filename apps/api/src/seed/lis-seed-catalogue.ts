import { SINGLES, PANELS, PACKAGES, SPECIMENS } from "./lis-catalogue";
import { QcService } from "../modules/analysis-qc/qc.service";
import { MicrobiologyService } from "../modules/microbiology/microbiology.service";
import { TemplatesService } from "../modules/release/templates.service";
import type { Ctx } from "./seed-lis";

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Phase 1: extended catalogue (analytes, intervals, critical limits, tests, panels, packages), QC materials + a fresh passing run per analyte, report template. */
export async function seedCatalogue(c: Ctx): Promise<void> {
  const { prisma, tenant, users } = c;
  const org = tenant.id;
  const pl = await prisma.priceList.findFirstOrThrow({ where: { orgId: org, isDefault: true } });
  const analytes = new Map((await prisma.analyte.findMany({ where: { orgId: org } })).map((a) => [a.code, a.id]));
  const tests = new Set((await prisma.testDefinition.findMany({ where: { orgId: org }, select: { code: true } })).map((t) => t.code));

  const mkTest = async (code: string, nameEn: string, nameAr: string | undefined, section: string, spec: string, price: number, tat: number, analyteCodes: string[]) => {
    if (tests.has(code)) return;
    const s = SPECIMENS[spec]!;
    const t = await prisma.testDefinition.create({ data: { orgId: org, code, nameEn, nameAr, specimenType: s.type, container: s.container, volumeMl: s.volumeMl || null, fastingRequired: Boolean(s.fasting), tatMinutes: tat, price, section: section as never } });
    let pos = 0;
    for (const a of analyteCodes) {
      const id = analytes.get(a);
      if (!id) throw new Error(`panel ${code}: unknown analyte ${a}`);
      await prisma.testAnalyte.create({ data: { testId: t.id, analyteId: id, position: pos++ } });
    }
    await prisma.priceListItem.create({ data: { orgId: org, priceListId: pl.id, testId: t.id, amount: price, version: 1 } });
    tests.add(code);
  };

  // ---- single-analyte tests (analyte + adult interval + test + price)
  for (const s of SINGLES) {
    if (!analytes.has(s.code)) {
      const a = await prisma.analyte.create({ data: { orgId: org, code: s.code, nameEn: s.nameEn, nameAr: s.nameAr, unit: s.unit, precision: s.high - s.low < 5 ? 2 : s.high - s.low < 50 ? 1 : 0, analyzerCodes: [s.code] } });
      analytes.set(s.code, a.id);
      await prisma.referenceInterval.create({ data: { orgId: org, analyteId: a.id, sex: null, ageMinDays: 0, low: s.low, high: s.high, effectiveFrom: new Date(), source: "SYNTHETIC_DEMO (NH-LB-013)" } });
    }
    if (s.price > 0) await mkTest(s.code, s.nameEn, s.nameAr, s.section, s.spec, s.price, 180, [s.code]);
  }
  // ---- special analytes: semi-quantitative dipstick protein, calculated eGFR (CKD-EPI 2021) and LDL (Friedewald) as formulas
  const special = async (code: string, data: Record<string, unknown>) => { if (!analytes.has(code)) analytes.set(code, (await prisma.analyte.create({ data: { orgId: org, code, analyzerCodes: [code], ...data } as never })).id); };
  await special("UPRO", { nameEn: "Urine protein (dipstick)", nameAr: "بروتين البول", valueType: "SEMI_QUANT", allowedValues: ["Negative", "Trace", "1+", "2+", "3+", "4+"], normalValues: ["Negative", "Trace"] });
  await special("UGLU", { nameEn: "Urine glucose (dipstick)", nameAr: "سكر البول", valueType: "SEMI_QUANT", allowedValues: ["Negative", "Trace", "1+", "2+", "3+", "4+"], normalValues: ["Negative"] });
  await special("EGFR", { nameEn: "eGFR (CKD-EPI 2021)", nameAr: "معدل الترشيح الكبيبي", unit: "mL/min/1.73m2", precision: 0, formula: "142 * MIN(CREA / IF(MALE, 0.9, 0.7), 1) ^ IF(MALE, -0.302, -0.241) * MAX(CREA / IF(MALE, 0.9, 0.7), 1) ^ -1.2 * 0.9938 ^ AGE * IF(MALE, 1, 1.012)" });
  await special("LDLC", { nameEn: "LDL cholesterol (calculated)", nameAr: "الكوليسترول الضار (محسوب)", unit: "mg/dL", precision: 0, formula: "IF(TRIG < 400, CHOL - HDLC - TRIG / 5, 0 / 0)" });
  await special("CULT", { nameEn: "Culture and sensitivity report", nameAr: "تقرير المزرعة والحساسية", valueType: "TEXT" });
  await special("HISTD", { nameEn: "Histopathology report", nameAr: "تقرير الأنسجة", valueType: "TEXT" });
  await special("CYTD", { nameEn: "Cytology report", nameAr: "تقرير الخلايا", valueType: "TEXT" });
  for (const [code, lo, hi] of [["EGFR", 90, 200], ["LDLC", 0, 130]] as const) { const id = analytes.get(code)!; if (!(await prisma.referenceInterval.findFirst({ where: { analyteId: id } }))) await prisma.referenceInterval.create({ data: { orgId: org, analyteId: id, sex: null, ageMinDays: 0, low: lo, high: hi, effectiveFrom: new Date(), source: "SYNTHETIC_DEMO (NH-LB-013)" } }); }

  // ---- panels and packages
  for (const p of PANELS) await mkTest(p.code, p.nameEn, p.nameAr, p.section, p.spec, p.price, p.tat, p.analytes);
  await mkTest("LIPIDC", "Lipid profile with calculated LDL", "الدهون مع LDL محسوب", "CHEMISTRY", "SERF", 230, 180, ["CHOL", "TRIG", "HDLC", "LDLC"]);
  await mkTest("UCULT", "Urine culture and sensitivity", "مزرعة بول وحساسية", "MICROBIOLOGY", "URN", 180, 2880, ["CULT"]);
  await mkTest("WCULT", "Wound swab culture and sensitivity", "مزرعة جرح وحساسية", "MICROBIOLOGY", "SWB", 190, 2880, ["CULT"]);
  await mkTest("SCULT", "Sputum culture and sensitivity", "مزرعة بصاق وحساسية", "MICROBIOLOGY", "SWB", 200, 2880, ["CULT"]);
  await mkTest("BCULT", "Blood culture", "مزرعة دم", "MICROBIOLOGY", "BC", 280, 5760, ["CULT"]);
  await mkTest("HISTO", "Histopathology (biopsy)", "فحص أنسجة (خزعة)", "HISTOPATHOLOGY", "TIS", 450, 4320, ["HISTD"]);
  await mkTest("CYTO", "Cytology (FNAC)", "فحص خلايا (FNAC)", "CYTOLOGY", "FLD", 350, 2880, ["CYTD"]);
  await mkTest("PAP", "Pap smear", "مسحة عنق الرحم", "CYTOLOGY", "SWB", 300, 4320, ["CYTD"]);
  await mkTest("URINEF", "Urine full analysis with protein/glucose", "تحليل بول شامل", "URINALYSIS", "URN", 70, 90, ["UPH", "USG", "UPRO", "UGLU"]);
  for (const p of PACKAGES) {
    if (await prisma.testPackage.findFirst({ where: { orgId: org, code: p.code } })) continue;
    const row = await prisma.testPackage.create({ data: { orgId: org, code: p.code, nameEn: p.nameEn, nameAr: p.nameAr, price: p.price } });
    for (const tc of p.tests) {
      const t = await prisma.testDefinition.findFirst({ where: { orgId: org, code: tc } });
      if (!t) throw new Error(`package ${p.code}: unknown test ${tc}`);
      await prisma.testPackageItem.create({ data: { packageId: row.id, testId: t.id } });
    }
    await prisma.priceListItem.create({ data: { orgId: org, priceListId: pl.id, packageId: row.id, amount: p.price, version: 1 } });
  }
  // section assignments for the base starter tests
  for (const [code, section] of [["CBC", "HEMATOLOGY"], ["GLU", "CHEMISTRY"], ["KFT", "CHEMISTRY"], ["LFT", "CHEMISTRY"], ["TSH", "IMMUNOLOGY"]] as const) await prisma.testDefinition.updateMany({ where: { orgId: org, code }, data: { section } });
  await prisma.instrument.update({ where: { id: c.astm.id }, data: { sections: ["HEMATOLOGY", "COAGULATION"] } });
  await prisma.instrument.update({ where: { id: c.hl7.id }, data: { sections: ["CHEMISTRY", "IMMUNOLOGY"] } });
  // reference ranges by condition (pregnancy) for TSH
  const tsh = analytes.get("TSH")!;
  if (!(await prisma.referenceInterval.findFirst({ where: { analyteId: tsh, condition: "PREGNANT_T1" } }))) await prisma.referenceInterval.create({ data: { orgId: org, analyteId: tsh, sex: "F", ageMinDays: 6570, condition: "PREGNANT_T1", low: 0.1, high: 2.5, effectiveFrom: new Date(), source: "SYNTHETIC_DEMO (NH-LB-013)" } });
  await prisma.autoVerificationRule.upsert({ where: { orgId_analyteId: { orgId: org, analyteId: analytes.get("CREA")! } }, create: { orgId: org, analyteId: analytes.get("CREA")!, enabled: false, maxDeltaPercent: 50, maxDeltaAbsolute: 0.5, deltaWindowDays: 120 }, update: {} });

  // ---- QC: materials for every analyte lacking them, then one fresh passing run per material on the bench
  const qc = c.app.get(QcService);
  const all = await prisma.analyte.findMany({ where: { orgId: org }, include: { referenceIntervals: { take: 1 }, qcMaterials: true } });
  for (const a of all) {
    if (a.formula) continue;
    if (!a.qcMaterials.length) {
      const iv = a.referenceIntervals[0];
      const lo = iv?.low != null ? Number(iv.low) : 0;
      const hi = iv?.high != null ? Number(iv.high) : 10;
      const mean = a.valueType === "NUMERIC" ? Math.max((lo + hi) / 2, 0.1) : 10;
      const sd = a.valueType === "NUMERIC" ? Math.max(r3((hi - lo) / 12), 0.01) : 1;
      for (const [level, f] of [["LEVEL_1", 1], ["LEVEL_2", 1.35]] as const) await prisma.qcMaterialLevel.create({ data: { orgId: org, analyteId: a.id, level, materialLot: `DEMO-${level === "LEVEL_1" ? "L1" : "L2"}`, targetMean: r3(mean * f), targetSd: r3(sd * f), manufacturer: "Synthetic QC Co", openedAt: new Date(Date.now() - 20 * 86_400_000), expiresAt: new Date(Date.now() + 180 * 86_400_000) } });
    }
  }
  const mats = await prisma.qcMaterialLevel.findMany({ where: { orgId: org } });
  for (const m of mats) {
    const has = await prisma.qcRun.findFirst({ where: { instrumentId: c.bench.id, materialId: m.id, runAt: { gte: new Date(Date.now() - 12 * 3_600_000) } } });
    if (!has) await qc.submitRun({ orgId: org, staffId: users.TECHNOLOGIST.staffId }, { instrumentId: c.bench.id, materialId: m.id, value: Number(m.targetMean) });
  }
  // expiring / retired lots for the lot-management demo
  const hbL2 = await prisma.qcMaterialLevel.findFirst({ where: { orgId: org, analyte: { code: "HB" }, level: "LEVEL_2" } });
  if (hbL2) await prisma.qcMaterialLevel.update({ where: { id: hbL2.id }, data: { expiresAt: new Date(Date.now() + 12 * 86_400_000) } });

  // ---- microbiology starter catalogue, report template
  await c.app.get(MicrobiologyService).loadStarter(org);
  const tpl = c.app.get(TemplatesService);
  if (!(await prisma.reportTemplate.findFirst({ where: { orgId: org } }))) await tpl.create(users.OWNER, { name: "Bilingual standard (demo)", language: "BILINGUAL", headerTitle: "Demo Diagnostics Laboratory", headerSubtitle: "Cairo Central Lab - Demo address, Cairo - +20 2 5555 0000", footerText: "Synthetic demo report. Results relate to the specimen as received. Not for clinical use.", accentColor: "#3730A3", showQr: true, showRanges: true });
  const n = await prisma.testDefinition.count({ where: { orgId: org } });
  c.log(`catalogue ready: ${n} tests, ${analytes.size} analytes, ${PACKAGES.length + 1} packages, ${mats.length} QC materials`);
}
