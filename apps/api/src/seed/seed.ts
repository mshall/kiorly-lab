import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { StaffRole } from "@prisma/client";
import { AppModule } from "../app.module";
import type { AuthUser } from "../auth/auth.types";
import { loadEnv } from "../config/env";
import { assertDemoSeedAllowed } from "../common/demo-seed-guard";
import { AdminService } from "../modules/admin/admin.service";
import { StarterCatalogueService } from "../modules/admin/starter-catalogue.service";
import { BillingService } from "../modules/business/billing.service";
import { HomeCollectionService } from "../modules/orders/home-collection.service";
import { OrdersService } from "../modules/orders/orders.service";
import { QcService } from "../modules/analysis-qc/qc.service";
import { ResultsService } from "../modules/analysis-qc/results.service";
import { ReportsService } from "../modules/release/reports.service";
import { SpecimensService } from "../modules/specimens/specimens.service";
import { PrismaService } from "../prisma/prisma.service";
import { STARTER_ANALYTES } from "../modules/admin/starter-catalogue";
import { seal } from "../common/secret-box";
import { PARTNER_DEV_DEFAULTS } from "@kiorex/contracts";
import { seedLis } from "./seed-lis";

/**
 * SYNTHETIC demo data (no real patients, labs or analyzers). Idempotent: skips when the demo tenant exists.
 * Run: npm run db:seed -w api   (refuses to run in production)
 * Login (dev auth): org slug "demo-lab", e.g. owner@demo-lab.test, tech@demo-lab.test, signatory@demo-lab.test, phleb@demo-lab.test, reception@demo-lab.test
 */
const SLUG = "demo-lab";
const ROLES: [StaffRole, string, string, string | null][] = [
  ["OWNER", "owner", "Layla Owner", null], ["LAB_DIRECTOR", "director", "Dr. Karim Director", "DEMO-LIC-DIR-001"], ["AUTHORIZED_SIGNATORY", "signatory", "Dr. Salma Signatory", "DEMO-LIC-SIG-002"],
  ["TECHNOLOGIST", "tech", "Omar Technologist", null], ["PHLEBOTOMIST", "phleb", "Nour Phlebotomist", null], ["RECEPTION", "reception", "Mona Reception", null], ["BRANCH_MANAGER", "manager", "Hassan Manager", null],
  ["SUPERVISOR", "supervisor", "Rania Supervisor", null], ["FINANCE", "finance", "Fady Finance", null],
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());

/** DEV registration of Kiorex as a booking client of the demo tenant (kiorex-contracts PARTNER_DEV_DEFAULTS; local only, idempotent). */
async function ensureDevKiorexClient(prisma: PrismaService, orgId: string) {
  const d = PARTNER_DEV_DEFAULTS.lab;
  const data = { orgId, secretEnc: seal(d.clientSecret), webhookSecretEnc: seal(d.webhookSecret), kiorexBaseUrl: process.env.KIOREX_BASE_URL ?? "http://localhost:4000", source: "KIOREX_BOOKING", active: true };
  await prisma.integrationClient.upsert({ where: { key: d.clientKey }, create: { key: d.clientKey, ...data }, update: data });
}

/** DEV registration of the KIORLY_NURSE source Kiorex relays with (kiorex-contracts PARTNER_DEV_DEFAULTS.labNurse; local only, idempotent). KNLAB01. */
async function ensureDevNurseClient(prisma: PrismaService, orgId: string) {
  const d = PARTNER_DEV_DEFAULTS.labNurse;
  const data = { orgId, secretEnc: seal(d.clientSecret), source: "KIORLY_NURSE", active: true };
  await prisma.integrationClient.upsert({ where: { key: d.clientKey }, create: { key: d.clientKey, ...data }, update: data });
}

async function main() {
  assertDemoSeedAllowed("Kiorly Lab base demo tenant (demo-lab)");
  loadEnv();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  const prisma = app.get(PrismaService);
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (existing) {
    await ensureDevKiorexClient(prisma, existing.id);
    await ensureDevNurseClient(prisma, existing.id);
    // Tenants seeded before field safety (KLORD04) have no safety contact, which blocks starting any home collection (SAFETY_CONTACT_REQUIRED): backfill the synthetic dev one, never overwrite a real one.
    if (!existing.safetyContactPhone) await prisma.tenant.update({ where: { id: existing.id }, data: { safetyContactName: "Demo safety contact (synthetic)", safetyContactPhone: "+201000000900" } });
    console.log(`demo tenant "${SLUG}" already exists: dev Kiorex client ${PARTNER_DEV_DEFAULTS.lab.clientKey} ensured`);
    await app.close();
    return;
  }
  const tenant = await prisma.tenant.create({ data: { name: "Demo Diagnostics (synthetic)", slug: SLUG, edition: "PRO", vatRatePercent: 14, safetyContactName: "Demo safety contact (synthetic)", safetyContactPhone: "+201000000900" } });
  const lab = await prisma.lab.create({ data: { orgId: tenant.id, name: "Cairo Central Lab", code: "CAI", address: "Demo address, Cairo", licenceNo: "DEMO-LAB-001" } });
  const users = {} as Record<StaffRole, AuthUser>;
  for (const [role, local, name, lic] of ROLES) {
    const s = await prisma.staffUser.create({ data: { orgId: tenant.id, email: `${local}@${SLUG}.test`, displayName: name, role, signatoryLicenceNo: lic } });
    users[role] = { staffId: s.id, orgId: tenant.id, role, displayName: name, labIds: [], marketCode: "EG", edition: "PRO", signatoryLicenceNo: lic };
  }
  await app.get(StarterCatalogueService).load(tenant.id);
  const mk = (name: string, kind: "ANALYZER" | "MANUAL_BENCH", protocol?: "ASTM_E1394" | "HL7_V2") => prisma.instrument.create({ data: { orgId: tenant.id, labId: lab.id, name, kind, protocol, simulated: kind === "ANALYZER", model: kind === "ANALYZER" ? "Simulated analyzer" : undefined } });
  const astm = await mk("Sim Hematology (ASTM)", "ANALYZER", "ASTM_E1394");
  const hl7 = await mk("Sim Chemistry (HL7)", "ANALYZER", "HL7_V2");
  const bench = await mk("Manual bench", "MANUAL_BENCH");
  const qc = app.get(QcService);
  const results = app.get(ResultsService);
  const orders = app.get(OrdersService);
  const spec = app.get(SpecimensService);
  const reports = app.get(ReportsService);
  const billing = app.get(BillingService);
  const home = app.get(HomeCollectionService);
  const tech = users.TECHNOLOGIST;

  // 14 days of QC history on the bench for every analyte (small noise; one 2_2s-free warning near the end)
  const rand = rng(42);
  const analytes = await prisma.analyte.findMany({ where: { orgId: tenant.id } });
  for (let day = 14; day >= 1; day--) {
    for (const a of analytes) {
      const def = STARTER_ANALYTES.find((x) => x.code === a.code)!;
      if (!def.qc) continue;
      for (const m of await prisma.qcMaterialLevel.findMany({ where: { analyteId: a.id } })) {
        const z = (day % 2 === 0 ? 1 : -1) * Math.min(1.1, Math.abs(gauss(rand)) * 0.6); // alternating sides: in control, no Westgard rule fires
        await qc.submitRun({ orgId: tenant.id, staffId: tech.staffId }, { instrumentId: bench.id, materialId: m.id, value: Number(m.targetMean) + z * Number(m.targetSd), runAt: new Date(Date.now() - day * 86_400_000 - Math.floor(rand() * 3600_000)) });
      }
    }
  }
  // fresh QC today so release is possible on every instrument
  for (const inst of [bench, astm, hl7]) {
    for (const m of await prisma.qcMaterialLevel.findMany({ where: { orgId: tenant.id } })) await qc.submitRun({ orgId: tenant.id, staffId: tech.staffId }, { instrumentId: inst.id, materialId: m.id, value: Number(m.targetMean) + (rand() - 0.5) * 0.5 * Number(m.targetSd) });
  }
  // one deliberate QC rejection on the HL7 chemistry analyzer (TSH 1_3s): demonstrates a QC block without touching the demo orders
  const tshL1 = await prisma.qcMaterialLevel.findFirstOrThrow({ where: { orgId: tenant.id, level: "LEVEL_1", analyte: { code: "TSH" } } });
  await qc.submitRun({ orgId: tenant.id, staffId: tech.staffId }, { instrumentId: hl7.id, materialId: tshL1.id, value: Number(tshL1.targetMean) + 3.6 * Number(tshL1.targetSd) });
  await prisma.autoVerificationRule.create({ data: { orgId: tenant.id, analyteId: analytes.find((a) => a.code === "GLU")!.id, enabled: true, maxDeltaPercent: 50 } });

  const patients = [
    { fullName: "Amira Hassan", dateOfBirth: "1990-05-10", sex: "F" as const, phone: "+201000000101" }, { fullName: "Youssef Ali", dateOfBirth: "1984-11-02", sex: "M" as const, phone: "+201000000102" },
    { fullName: "Mariam Said", dateOfBirth: "2001-02-17", sex: "F" as const, phone: "+201000000103" }, { fullName: "Khaled Nabil", dateOfBirth: "1975-08-30", sex: "M" as const, phone: "+201000000104" },
    { fullName: "Salma Fathy", dateOfBirth: "1996-12-05", sex: "F" as const, phone: "+201000000105" }, { fullName: "Tamer Ezz", dateOfBirth: "1968-04-21", sex: "M" as const, phone: "+201000000106" },
  ];
  const consent = ["PRINTED", "PATIENT_LINK_OTP", "KIOREX_VAULT"] as const;
  const mkOrder = async (i: number, testCodes: string[], extra: Record<string, unknown> = {}) =>
    (await orders.create(users.RECEPTION, { patient: patients[i], testCodes, identifiersChecked: ["dateOfBirth", "phone"], consentChannels: [...consent], referringDoctorName: "Dr. Demo Referrer", referringDoctorPhone: "+201000000900", ...extra })).order;
  const advance = async (o: Awaited<ReturnType<typeof mkOrder>>, to: "collected" | "received" | "processing") => {
    for (const s of o.specimens) {
      await spec.transition(users.RECEPTION, s.id, "collect", { scannedBarcode: s.barcode });
      if (to === "collected") continue;
      await spec.transition(tech, s.id, "receive", { scannedBarcode: s.barcode });
      if (to === "received") continue;
      await spec.transition(tech, s.id, "process", { scannedBarcode: s.barcode });
    }
  };
  const enter = async (o: Awaited<ReturnType<typeof mkOrder>>, values: Record<string, number>, validate: "none" | "tech" | "medical") => {
    const full = await orders.get(tenant.id, o.id);
    for (const it of full.items) {
      const t = await prisma.testDefinition.findUniqueOrThrow({ where: { id: it.testId }, include: { analytes: { include: { analyte: true } } } });
      for (const ta of t.analytes) {
        const r = await results.enterManual(tech, { orderItemId: it.id, analyteId: ta.analyteId, instrumentId: bench.id, value: values[ta.analyte.code] });
        await results.secondEntry(users.LAB_DIRECTOR, r.id, { value: values[ta.analyte.code] });
        if (validate !== "none") await results.techValidate(tech, r.id);
        if (validate === "medical") await results.medicalValidate(users.AUTHORIZED_SIGNATORY, r.id);
      }
    }
  };
  const NORMAL = { HB: 13.4, WBC: 7.1, PLT: 262, GLU: 88, CREA: 0.9, K: 4.3, NA: 140, ALT: 24, AST: 26, TSH: 2.1 };

  await mkOrder(0, ["CBC", "GLU"]); // awaiting collection
  const o2 = await mkOrder(1, ["KFT"]); await advance(o2, "received"); // in lab, received
  const o3 = await mkOrder(2, ["CBC"]); await advance(o3, "processing"); await enter(o3, NORMAL, "tech"); // awaiting medical validation
  const o4 = await mkOrder(3, ["LFT", "TSH"]); await advance(o4, "processing"); await enter(o4, NORMAL, "medical"); // ready to sign
  const o5 = await mkOrder(4, ["GLU", "CBC"]); await advance(o5, "processing"); await enter(o5, NORMAL, "medical"); // signed + released
  const rep = await reports.sign(users.AUTHORIZED_SIGNATORY, o5.id);
  await reports.release(users.RECEPTION, rep.id, ["PATIENT_LINK_OTP", "PRINTED"]);
  const inv = await billing.invoiceOrder(users.RECEPTION, o5.id);
  await billing.pay(users.RECEPTION, inv.id, { method: "CASH", amount: inv.total }, `seed-pay-${o5.id}`);
  const o6 = await mkOrder(5, ["CBC"]); await advance(o6, "processing"); // critical haemoglobin => open alert
  const cbcItem = (await orders.get(tenant.id, o6.id)).items[0];
  await results.enterManual(tech, { orderItemId: cbcItem.id, analyteId: analytes.find((a) => a.code === "HB")!.id, instrumentId: bench.id, value: 6.2 });

  // home collection route for today (phlebotomist PWA demo)
  const today = new Date().toISOString().slice(0, 10);
  const slots = await home.slots(users.RECEPTION, today);
  const stops: [number, string, { lat: number; lng: number }][] = [[0, "12 Tahrir St, Dokki", { lat: 30.038, lng: 31.211 }], [1, "5 Road 9, Maadi", { lat: 29.96, lng: 31.257 }], [2, "30 Abbas El-Akkad, Nasr City", { lat: 30.056, lng: 31.33 }]];
  let n = 0; // every 2nd hourly slot: the same phlebotomist's consecutive stops need the 30/30 min travel buffers (canBook), adjacent slots are rejected as OVERLAP
  for (const [pi, address, geo] of stops) {
    const r = await orders.create(users.RECEPTION, { patient: { ...patients[pi], fullName: `${patients[pi].fullName} (home)`, phone: `+2010000002${pi}0` }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { slotId: slots[2 * n++].id, address, geo }, consentChannels: [...consent] });
    const hc = await prisma.homeCollection.findFirstOrThrow({ where: { orderId: r.order.id } });
    await home.assign(users.RECEPTION, hc.id, users.PHLEBOTOMIST.staffId);
  }
  await home.optimiseRoute(users.RECEPTION, today, users.PHLEBOTOMIST.staffId, { lat: 30.0444, lng: 31.2357 });

  // Kiorex booking (simulated inbound)
  await orders.create({ orgId: tenant.id, staffId: "system:kiorex_booking", labIds: [], marketCode: "EG", system: true }, { source: "KIOREX_BOOKING", sourceRef: "kx_demo_booking_1", patient: { fullName: "Hana Kiorex", phone: "+201000000700", dateOfBirth: "1993-09-09", externalId: "sub_demo_hana" }, testCodes: ["CBC"], consentChannels: ["KIOREX_VAULT"] });

  // B2B payer + dev integration clients (secrets printed once)
  const pl = await prisma.priceList.create({ data: { orgId: tenant.id, name: "Insurer demo", currency: "EGP" } });
  await prisma.b2bAccount.create({ data: { orgId: tenant.id, name: "Demo Insurance Co", priceListId: pl.id, paymentTermsDays: 45 } });
  const admin = app.get(AdminService);
  await ensureDevKiorexClient(prisma, tenant.id);
  await ensureDevNurseClient(prisma, tenant.id);
  const cl = await admin.createClient(users.OWNER, "KIORLY_CLINIC");
  await prisma.integrationClient.update({ where: { id: cl.id }, data: { key: "kl_dev_clinic", secretEnc: seal("dev_clinic_secret_change_me") } });

  await seedLis(app, tenant);
  console.log(`seeded demo tenant "${SLUG}" (org ${tenant.id}).`);
  console.log(`dev login: POST /api/v1/auth/dev-login {"orgSlug":"${SLUG}","email":"<role>@${SLUG}.test"} with owner|director|signatory|tech|phleb|reception|manager|supervisor|finance`);
  console.log("integration dev clients: kl_dev_kiorex / dev_kiorex_secret_change_me, kl_dev_clinic / dev_clinic_secret_change_me, kl_dev_nurse / dev_nurse_secret_change_me (KIORLY_NURSE, relayed by Kiorex; local only)");
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
