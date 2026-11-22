import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { StaffRole } from "../generated/prisma/client";
import type { INestApplicationContext } from "@nestjs/common";
import { AppModule } from "../app.module";
import type { AuthUser } from "../auth/auth.types";
import { loadEnv } from "../config/env";
import { assertDemoSeedAllowed } from "../common/demo-seed-guard";
import { StarterCatalogueService } from "../modules/admin/starter-catalogue.service";
import { OrdersService } from "../modules/orders/orders.service";
import { QcService } from "../modules/analysis-qc/qc.service";
import { ResultsService } from "../modules/analysis-qc/results.service";
import { SpecimensService } from "../modules/specimens/specimens.service";
import { MobilePushService } from "../adapters/mobile-push.adapter";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Kiorly Team (mobile) DEMO seed — synthetic, DEV ONLY. Idempotent, guarded (DEMO_SEED_ALLOWED + non-production).
 *   npm run db:seed:mobile -w api          (run AFTER db:seed and db:seed:demo)
 * Tenants (dev-login {orgSlug, email}; every tenant has one login per role: <local>@<slug>.test):
 *   demo-lab   PRO         existing demo tenant, plan confirmed PRO (critical alerts, validation queue, QC block from the base demo)
 *   chain-lab  CHAIN       ENTERPRISE example ("Delta Diagnostics Group")
 *   basic-lab  LITE        BASIC plan: upgrade screen + safety-alert inbox only ("Starter Lab")
 * Roles/locals: owner, director, signatory, tech, phleb, reception, manager, supervisor, finance.
 */
const ROLES: [StaffRole, string, string, string | null][] = [
  ["OWNER", "owner", "Layla Owner", null], ["LAB_DIRECTOR", "director", "Dr. Karim Director", "DEMO-LIC-DIR-001"], ["AUTHORIZED_SIGNATORY", "signatory", "Dr. Salma Signatory", "DEMO-LIC-SIG-002"],
  ["TECHNOLOGIST", "tech", "Omar Technologist", null], ["PHLEBOTOMIST", "phleb", "Nour Phlebotomist", null], ["RECEPTION", "reception", "Mona Reception", null], ["BRANCH_MANAGER", "manager", "Hassan Manager", null],
  ["SUPERVISOR", "supervisor", "Rania Supervisor", null], ["FINANCE", "finance", "Fady Finance", null],
];
const NORMAL: Record<string, number> = { HB: 13.4, WBC: 7.1, PLT: 262, GLU: 88, CREA: 0.9, K: 4.3, NA: 140, ALT: 24, AST: 26, TSH: 2.1 };
const PEOPLE: [string, string, "M" | "F", string][] = [["Hana Kamel", "1991-04-12", "F", "+201000005101"], ["Adel Farouk", "1979-09-03", "M", "+201000005102"], ["Yasmin Nader", "1998-01-22", "F", "+201000005103"], ["Sherif Gaber", "1966-06-30", "M", "+201000005104"]];

async function seedTenant(app: INestApplicationContext, spec: { slug: string; name: string; edition: "LITE" | "PRO" | "CHAIN"; labName: string; code: string }) {
  const prisma = app.get(PrismaService);
  const existing = await prisma.tenant.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    if (existing.edition !== spec.edition) await prisma.tenant.update({ where: { id: existing.id }, data: { edition: spec.edition } });
    console.log(`  ${spec.slug}: exists (edition ${spec.edition})`);
    return existing.id;
  }
  const tenant = await prisma.tenant.create({ data: { name: spec.name, slug: spec.slug, edition: spec.edition, vatRatePercent: 14, defaultLocale: "ar", safetyContactName: "Demo safety contact (synthetic)", safetyContactPhone: "+201000000900" } });
  const lab = await prisma.lab.create({ data: { orgId: tenant.id, name: spec.labName, code: spec.code, address: "Demo address, Cairo (synthetic)" } });
  const users = {} as Record<StaffRole, AuthUser>;
  for (const [role, local, name, lic] of ROLES) {
    const s = await prisma.staffUser.create({ data: { orgId: tenant.id, email: `${local}@${spec.slug}.test`, displayName: name, role, signatoryLicenceNo: lic } });
    users[role] = { staffId: s.id, orgId: tenant.id, role, displayName: name, labIds: [], marketCode: "EG", edition: spec.edition, signatoryLicenceNo: lic };
  }
  await app.get(StarterCatalogueService).load(tenant.id);
  const bench = await prisma.instrument.create({ data: { orgId: tenant.id, labId: lab.id, name: "Manual bench", kind: "MANUAL_BENCH" } });
  const qc = app.get(QcService), results = app.get(ResultsService), orders = app.get(OrdersService), spec2 = app.get(SpecimensService);
  const tech = users.TECHNOLOGIST;
  for (const m of await prisma.qcMaterialLevel.findMany({ where: { orgId: tenant.id } })) await qc.submitRun({ orgId: tenant.id, staffId: tech.staffId }, { instrumentId: bench.id, materialId: m.id, value: Number(m.targetMean) });

  const mk = async (i: number, codes: string[], extra: Record<string, unknown> = {}) => {
    const [name, dob, sex, phone] = PEOPLE[i % PEOPLE.length];
    return (await orders.create(users.RECEPTION, { patient: { fullName: `${name} (DEMO)`, dateOfBirth: dob, sex, phone }, testCodes: codes, identifiersChecked: ["dateOfBirth", "phone"], consentChannels: ["PRINTED", "PATIENT_LINK_OTP"], referringDoctorName: "Dr. Demo Referrer", referringDoctorPhone: "+201000000900", ...extra } as never)).order;
  };
  const toProcessing = async (o: Awaited<ReturnType<typeof mk>>) => { for (const s of o.specimens) { await spec2.transition(users.RECEPTION, s.id, "collect", { scannedBarcode: s.barcode }); await spec2.transition(tech, s.id, "receive", { scannedBarcode: s.barcode }); await spec2.transition(tech, s.id, "process", { scannedBarcode: s.barcode }); } };
  const enter = async (o: Awaited<ReturnType<typeof mk>>, values: Record<string, number>, validate: boolean) => {
    const full = await orders.get(tenant.id, o.id);
    for (const it of full.items) {
      const t = await prisma.testDefinition.findUniqueOrThrow({ where: { id: it.testId }, include: { analytes: { include: { analyte: true } } } });
      for (const ta of t.analytes) {
        const r = await results.enterManual(tech, { orderItemId: it.id, analyteId: ta.analyteId, instrumentId: bench.id, value: values[ta.analyte.code] });
        await results.secondEntry(users.LAB_DIRECTOR, r.id, { value: values[ta.analyte.code] });
        if (validate) await results.techValidate(tech, r.id);
      }
    }
  };

  await mk(0, ["CBC", "GLU"], { priority: "STAT" }); // awaiting collection (phlebotomy / scan demo)
  const inLab = await mk(1, ["KFT"]); await toProcessing(inLab); // worklist
  const pending = await mk(2, ["CBC"]); await toProcessing(pending); await enter(pending, NORMAL, true); // awaiting medical validation (pathologist queue)
  const critical = await mk(3, ["CBC"]); await toProcessing(critical); // critical haemoglobin => open critical alert
  const item = (await orders.get(tenant.id, critical.id)).items[0];
  await results.enterManual(tech, { orderItemId: item.id, analyteId: (await prisma.analyte.findFirstOrThrow({ where: { orgId: tenant.id, code: "HB" } })).id, instrumentId: bench.id, value: 6.1 });
  console.log(`  ${spec.slug}: created (${spec.edition})`);
  return tenant.id;
}

async function main() {
  assertDemoSeedAllowed("Kiorly Lab mobile demo tenants (Kiorly Team)");
  loadEnv();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const prisma = app.get(PrismaService);
    console.log("Kiorly Team demo tenants:");
    const demo = await prisma.tenant.findUnique({ where: { slug: "demo-lab" } });
    if (!demo) throw new Error('base demo tenant "demo-lab" missing: run `npm run db:seed -w api` first');
    await prisma.tenant.update({ where: { id: demo.id }, data: { edition: "PRO" } });
    console.log("  demo-lab: PRO confirmed");
    const chain = await seedTenant(app, { slug: "chain-lab", name: "Delta Diagnostics Group (synthetic)", edition: "CHAIN", labName: "Delta Central Lab", code: "DLT" });
    const basic = await seedTenant(app, { slug: "basic-lab", name: "Starter Lab (synthetic)", edition: "LITE", labName: "Starter Lab Giza", code: "STR" });

    // Inbox: a few bilingual mock-push messages per tenant lead roles (once).
    const push = app.get(MobilePushService);
    for (const orgId of [demo.id, chain, basic]) {
      const staff = await prisma.staffUser.findMany({ where: { orgId, role: { in: ["LAB_DIRECTOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST", "OWNER"] } } });
      for (const s of staff) {
        if (await prisma.mobilePush.findFirst({ where: { orgId, staffId: s.id, templateId: "TEST" } })) continue;
        await push.send({ orgId, staffId: s.id, templateId: "TEST", data: { demo: true } });
        if (s.role === "AUTHORIZED_SIGNATORY") await push.send({ orgId, staffId: s.id, templateId: "RESULT_AWAITING_VALIDATION", params: { orderNumber: "DEMO" }, data: { demo: true } });
        if (s.role === "LAB_DIRECTOR") await push.send({ orgId, staffId: s.id, templateId: "CRITICAL_ALERT", params: { orderNumber: "DEMO" }, data: { demo: true } });
      }
    }
    console.log('logins: POST /api/v1/auth/dev-login {"orgSlug":"demo-lab|chain-lab|basic-lab","email":"<owner|director|signatory|tech|phleb|reception|manager|supervisor|finance>@<slug>.test"}');
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
