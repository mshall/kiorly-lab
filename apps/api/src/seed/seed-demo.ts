import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { StaffRole } from "@prisma/client";
import { AppModule } from "../app.module";
import type { AuthUser } from "../auth/auth.types";
import { loadEnv } from "../config/env";
import { assertDemoSeedAllowed } from "../common/demo-seed-guard";
import nurseLabSpec from "./demo-nurse-lab.json";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BillingService } from "../modules/business/billing.service";
import { HomeCollectionService } from "../modules/orders/home-collection.service";
import { OrdersService } from "../modules/orders/orders.service";
import { QcService } from "../modules/analysis-qc/qc.service";
import { ResultsService } from "../modules/analysis-qc/results.service";
import { ReportsService } from "../modules/release/reports.service";
import { SpecimensService } from "../modules/specimens/specimens.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Kiorly Lab DEMO / QA dataset (synthetic, DEV ONLY — see /TEST_DATA.md). Extends the base demo tenant "demo-lab" (npm run db:seed)
 * with NEW records only: ~34 orders for demo patients in every workflow status (awaiting collection, collected, in lab, awaiting
 * validation, validated, signed+released with invoices/payments, cancelled, critical-value alert), home-collection stops, QC history
 * on the analyzers, and Kiorex bookings that mirror kx_lb_demo_* in the Kiorex demo seed. Order dates are spread over ~30 days.
 *
 *   npm run db:seed:demo -w api            idempotent (skips when "(DEMO)" patients already exist)
 *   npm run db:seed:demo -w api -- --reset NOT possible for released reports / QC runs / audit (append-only by design, DB triggers);
 *                                          this flag only reports that and re-runs idempotently. Full wipe: recreate the kiorly_lab DB.
 * Run AFTER `npm run db:seed -w api`. Logins: dev-login {orgSlug:"demo-lab", email:"<role>@demo-lab.test"}.
 */
const SLUG = "demo-lab";
const DAY = 86_400_000;
const NORMAL: Record<string, number> = { HB: 13.4, WBC: 7.1, PLT: 262, GLU: 88, CREA: 0.9, K: 4.3, NA: 140, ALT: 24, AST: 26, TSH: 2.1 };
const HIGH: Record<string, number> = { HB: 15.9, WBC: 11.8, PLT: 410, GLU: 164, CREA: 1.6, K: 5.4, NA: 146, ALT: 78, AST: 66, TSH: 6.8 };
const PEOPLE: [string, string, "M" | "F", string][] = [["Hoda Mahmoud", "1989-03-14", "F", "+201000001001"], ["Samir Ali Nassar", "1986-07-02", "M", "+201000001002"], ["Karim Mostafa", "1984-11-21", "M", "+201000001003"], ["Nourhan Fathy", "1995-01-30", "F", "+201000001004"], ["Mahmoud El-Sayed", "1972-05-09", "M", "+201000001005"], ["Mariam Adel", "1993-09-17", "F", "+201000001006"], ["Omar Hegazy", "1997-12-03", "M", "+201000001007"], ["Dalia Ibrahim", "1988-04-25", "F", "+201000001008"], ["Tarek Zaki", "1990-08-11", "M", "+201000001009"], ["Heba Salah", "1991-02-19", "F", "+201000001010"], ["Youssef Ramadan", "2000-06-06", "M", "+201000001011"], ["Rana Khaled", "1985-10-28", "F", "+201000001012"]];

async function main() {
  assertDemoSeedAllowed("Kiorly Lab (demo-lab tenant)");
  loadEnv();
  if (process.argv.includes("--reset")) console.log("lab demo: --reset cannot remove released reports / QC runs / audit (append-only by design); re-running idempotently. Full wipe = recreate the kiorly_lab database.");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const prisma = app.get(PrismaService);
    const tenant = await prisma.tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error('base demo tenant "demo-lab" missing: run `npm run db:seed -w api` first');
    const org = tenant.id;
    const staff = await prisma.staffUser.findMany({ where: { orgId: org } });
    const users = {} as Record<StaffRole, AuthUser>;
    for (const s of staff) users[s.role] = { staffId: s.id, orgId: org, role: s.role, displayName: s.displayName, labIds: [], marketCode: "EG", edition: "PRO", signatoryLicenceNo: s.signatoryLicenceNo } as AuthUser;
    const orders = app.get(OrdersService), spec = app.get(SpecimensService), results = app.get(ResultsService), reports = app.get(ReportsService), billing = app.get(BillingService), home = app.get(HomeCollectionService), qc = app.get(QcService);
    const tech = users.TECHNOLOGIST;
    const bench = await prisma.instrument.findFirstOrThrow({ where: { orgId: org, kind: "MANUAL_BENCH" } });
    const analytes = await prisma.analyte.findMany({ where: { orgId: org } });
    const tests = await prisma.testDefinition.findMany({ where: { orgId: org }, select: { code: true } });
    const has = (c: string) => tests.some((t) => t.code === c);

    const alreadySeeded = (await prisma.patientRef.count({ where: { orgId: org, fullName: { contains: "(DEMO)" } } })) > 0;

    // QC history on the analyzers: 20 more days, in control (no Westgard flag), so the Levey-Jennings charts are populated
    const analyzers = await prisma.instrument.findMany({ where: { orgId: org, kind: "ANALYZER" } });
    let t = 987654321; const rng = () => ((t = (t * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
    if (!alreadySeeded) for (let day = 20; day >= 2; day--) for (const inst of analyzers) for (const m of await prisma.qcMaterialLevel.findMany({ where: { orgId: org } })) {
      const z = (day % 2 ? 1 : -1) * Math.min(0.9, rng());
      await qc.submitRun({ orgId: org, staffId: tech.staffId }, { instrumentId: inst.id, materialId: m.id, value: Number(m.targetMean) + z * Number(m.targetSd), runAt: new Date(Date.now() - day * DAY - Math.floor(rng() * 3_600_000)) }).catch(() => {});
    }

    const consent = ["PRINTED", "PATIENT_LINK_OTP", "KIOREX_VAULT"] as const;
    const mkOrder = async (i: number, codes: string[], extra: Record<string, unknown> = {}) => {
      const [name, dob, sex, ph] = PEOPLE[i % PEOPLE.length];
      return (await orders.create(users.RECEPTION, { patient: { fullName: `${name} (DEMO)`, dateOfBirth: dob, sex, phone: ph }, testCodes: codes.filter(has), identifiersChecked: ["dateOfBirth", "phone"], consentChannels: [...consent], referringDoctorName: "Dr Tamer Shawky (DEMO)", referringDoctorPhone: "+201000003101", ...extra } as any)).order;
    };
    const advance = async (o: any, to: "collected" | "received" | "processing", preCollected = false) => { for (const s of o.specimens) { if (!preCollected) await spec.transition(users.RECEPTION, s.id, "collect", { scannedBarcode: s.barcode }); if (to === "collected") continue; await spec.transition(tech, s.id, "receive", { scannedBarcode: s.barcode }); if (to === "received") continue; await spec.transition(tech, s.id, "process", { scannedBarcode: s.barcode }); } };
    const enter = async (o: any, values: Record<string, number>, validate: "none" | "tech" | "medical") => {
      const full = await orders.get(org, o.id);
      for (const it of full.items) { const td = await prisma.testDefinition.findUniqueOrThrow({ where: { id: it.testId }, include: { analytes: { include: { analyte: true } } } });
        for (const ta of td.analytes) { const r = await results.enterManual(tech, { orderItemId: it.id, analyteId: ta.analyteId, instrumentId: bench.id, value: values[ta.analyte.code] }); await results.secondEntry(users.LAB_DIRECTOR, r.id, { value: values[ta.analyte.code] }); if (validate !== "none") await results.techValidate(tech, r.id); if (validate === "medical") await results.medicalValidate(users.AUTHORIZED_SIGNATORY, r.id); } }
    };
    const spread = (o: any, daysAgo: number) => prisma.labOrder.update({ where: { id: o.id }, data: { createdAt: new Date(Date.now() - daysAgo * DAY) } as any }).catch(() => {});
    const COMBOS = [["CBC"], ["GLU"], ["KFT"], ["LFT"], ["TSH"], ["CBC", "GLU"], ["LFT", "TSH"], ["KFT", "GLU"]];
    let k = 0; const done: Record<string, number> = {};
    const bump = (s: string) => { done[s] = (done[s] ?? 0) + 1; };
    const safe = async (label: string, f: () => Promise<void>) => { try { await f(); bump(label); } catch (e: any) { console.warn(`${label}:`, String(e.message ?? e).slice(0, 140)); } };

    // ── KNLAB01: samples collected by a Kiorly Nurse at a home visit and handed to this lab (source KIORLY_NURSE, sourceRef = the clinic order id) ──
    // The clinic seed created the matching ClinicalOrder + LabSampleCollection (same ids); the Kiorex seed relays and pushes this lab's status back.
    const nurseOrders = async () => {
      const nsys = { orgId: org, staffId: "system:kiorly_nurse", labIds: [], marketCode: "EG", system: true } as any;
      const day0 = new Date(); day0.setUTCHours(0, 0, 0, 0);
      const at = (o: { off: number; hour: number; min?: number }) => new Date(day0.getTime() + o.off * DAY + o.hour * 3_600_000 + (o.min ?? 0) * 60_000).toISOString();
      const handoff: Record<string, unknown> = {};
      for (const o of nurseLabSpec.orders) {
        if (o.labTarget === "REFUSED") { handoff[o.id] = { sourceRef: o.id, state: "REFUSED", refusalCode: (o as any).refusalCode }; bump("nurse-refused"); continue; }
        await safe(`nurse-${o.labTarget.toLowerCase()}`, async () => {
          const r = await orders.create(nsys, {
            source: "KIORLY_NURSE", sourceRef: o.id, patient: { fullName: `${o.patient.fullName} (DEMO)`, dateOfBirth: o.patient.dateOfBirth, sex: o.patient.sex as "M" | "F", phone: o.patient.phone, externalId: o.patient.ref },
            testCodes: o.tests.filter(has), identifiersChecked: o.identifiersChecked.map((k: string) => ({ FULL_NAME: "fullName", DATE_OF_BIRTH: "dateOfBirth", PHONE: "phone" } as Record<string, string>)[k]), consentChannels: ["KIORLY_NURSE_IMPORT", "KIOREX_VAULT"] as any,
            referringDoctorName: o.prescriber,
            nurseCollection: { visitRef: o.visitKey, collectorRef: `demo_nurse_${o.nurse}`, collectorName: o.collectorName, collectedAt: at(o.collected), handedOverAt: at(o.handedOver), temperatureC: o.temperatureC, consentToken: `${nurseLabSpec.consentTokenPrefix}${o.key}`, samples: o.tubes },
          } as any);
          const ord = r.order as any;
          let report: { reportId?: string; version?: number; secureLink?: string; signedAt?: string } = {};
          if (r.created && (o.labTarget === "RELEASED" || o.labTarget === "AWAITING_VALIDATION")) {
            await advance(ord, "processing", true);
            await enter(ord, NORMAL, o.labTarget === "RELEASED" ? "medical" : "tech");
            if (o.labTarget === "RELEASED") {
              const rep = await reports.sign(users.AUTHORIZED_SIGNATORY, ord.id); const rel = await reports.release(users.RECEPTION, rep.id, ["KIOREX_VAULT"]);
              report = { reportId: rel.reportId, version: rel.version, secureLink: rel.secureLink, signedAt: (rep as any).signedAt?.toISOString?.() ?? new Date().toISOString() };
            }
          }
          const full = await prisma.labOrder.findUniqueOrThrow({ where: { id: ord.id }, select: { id: true, orderNumber: true, status: true } });
          if (!r.created) { const rv = await prisma.reportVersion.findFirst({ where: { orderId: ord.id }, orderBy: { version: "desc" } }); if (rv) { report = { reportId: rv.id, version: rv.version, signedAt: rv.signedAt.toISOString() };
            // seed-all --reset / {"reset":true}: re-issue the secure link (the plaintext token is only known at creation) so the clinic mirror gets a working one
            if (process.env.DEMO_REISSUE_LINKS === "true" && o.labTarget === "RELEASED") report.secureLink = (await reports.release(users.RECEPTION, rv.id, ["KIOREX_VAULT"])).secureLink; } }
          handoff[o.id] = { sourceRef: o.id, state: o.labTarget, labOrderId: full.id, orderNumber: full.orderNumber, status: full.status, ...report };
        });
      }
      // hand-off for the Kiorex seed (local: a file; AWS: the Lambda response is passed to the Kiorex seed as DEMO_HANDOFF_JSON)
      const file = process.env.DEMO_HANDOFF_FILE;
      if (file) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), nurseLab: handoff }, null, 2)); }
      console.log(`DEMO_HANDOFF ${JSON.stringify({ nurseLab: handoff })}`);
    };
    // outbox events produced by the seed describe demo state Kiorex already holds (or the Kiorex seed relays itself): never push them
    const markSent = () => prisma.$executeRawUnsafe(`UPDATE "OutboxEvent" SET status='SENT', "sentAt"=now() WHERE "orgId"='${org}' AND status<>'SENT' AND "occurredAt" >= now() - interval '30 minutes'`).catch(() => {});
    if (alreadySeeded) { await nurseOrders(); await markSent(); console.log("Lab demo seed: demo patients already present; nurse-collected orders ensured."); return; }

    for (let i = 0; i < 6; i++) await safe("awaiting-collection", async () => { const o = await mkOrder(k++, COMBOS[i % COMBOS.length]); await spread(o, i % 3); });
    for (let i = 0; i < 3; i++) await safe("collected", async () => { const o = await mkOrder(k++, COMBOS[i]); await advance(o, "collected"); await spread(o, 1 + i); });
    for (let i = 0; i < 3; i++) await safe("in-lab", async () => { const o = await mkOrder(k++, COMBOS[i + 1]); await advance(o, "received"); await spread(o, 1 + i); });
    for (let i = 0; i < 3; i++) await safe("awaiting-validation", async () => { const o = await mkOrder(k++, COMBOS[i + 2]); await advance(o, "processing"); await enter(o, NORMAL, "tech"); await spread(o, 2 + i); });
    for (let i = 0; i < 2; i++) await safe("validated", async () => { const o = await mkOrder(k++, COMBOS[i + 3]); await advance(o, "processing"); await enter(o, i ? HIGH : NORMAL, "medical"); await spread(o, 3 + i); });
    for (let i = 0; i < 12; i++) await safe("released", async () => {
      const o = await mkOrder(k++, COMBOS[i % COMBOS.length]); await advance(o, "processing"); await enter(o, i % 3 === 0 ? HIGH : NORMAL, "medical");
      const rep = await reports.sign(users.AUTHORIZED_SIGNATORY, o.id); await reports.release(users.RECEPTION, rep.id, ["PATIENT_LINK_OTP", "PRINTED"]);
      const inv = await billing.invoiceOrder(users.RECEPTION, o.id);
      if (i % 4 !== 3) await billing.pay(users.RECEPTION, inv.id, { method: i % 2 ? "CARD" : "CASH", amount: inv.total }, `demo-pay-${o.id}`);
      await spread(o, 4 + i * 2);
    });
    await safe("critical-alert", async () => { const o = await mkOrder(k++, ["CBC"]); await advance(o, "processing"); const it = (await orders.get(org, o.id)).items[0]; await results.enterManual(tech, { orderItemId: it.id, analyteId: analytes.find((a) => a.code === "HB")!.id, instrumentId: bench.id, value: 5.9 }); await spread(o, 0); });
    await safe("critical-potassium", async () => { const o = await mkOrder(k++, ["KFT"]); await advance(o, "processing"); const it = (await orders.get(org, o.id)).items[0]; const kA = analytes.find((a) => a.code === "K"); if (kA) await results.enterManual(tech, { orderItemId: it.id, analyteId: kA.id, instrumentId: bench.id, value: 6.8 }); });
    // home collection route (today) for the phlebotomist
    await safe("home-collection", async () => {
      const today = new Date().toISOString().slice(0, 10); const slots = await home.slots(users.RECEPTION, today);
      const stops: [number, string, { lat: number; lng: number }][] = [[6, "7 Street 9, Maadi", { lat: 29.96, lng: 31.257 }], [7, "14 Mostafa El-Nahas, Nasr City", { lat: 30.06, lng: 31.33 }], [8, "3 Baghdad St, Heliopolis", { lat: 30.09, lng: 31.32 }], [9, "22 Tahrir St, Dokki", { lat: 30.038, lng: 31.211 }]];
      let n = 3; // base seed used the first slots
      for (const [pi, address, geo] of stops) { if (!slots[n]) break; const r = await mkOrder(pi, ["GLU"], { collectionType: "HOME", homeCollection: { slotId: slots[n++].id, address, geo } }); const hc = await prisma.homeCollection.findFirstOrThrow({ where: { orderId: r.id } }); await home.assign(users.RECEPTION, hc.id, users.PHLEBOTOMIST.staffId); }
    });
    // Kiorex bookings mirroring the Kiorex demo seed (sourceRef = Kiorex booking id)
    const sys = { orgId: org, staffId: "system:kiorex_booking", labIds: [], marketCode: "EG", system: true } as any;
    for (const [i, st] of [[3, "SUBMITTED"], [4, "COLLECTED"], [5, "RESULT_RELEASED"], [6, "RESULT_RELEASED"], [7, "REJECTED"]] as [number, string][]) await safe(`kiorex-${st.toLowerCase()}`, async () => {
      const [name, dob, sex, ph] = PEOPLE[(i + 3) % PEOPLE.length];
      const r = (await orders.create(sys, { source: "KIOREX_BOOKING", sourceRef: `kx_lb_demo_${i}`, patient: { fullName: `${name} (DEMO)`, dateOfBirth: dob, sex, phone: ph }, testCodes: ["CBC", "GLU"].filter(has), identifiersChecked: ["dateOfBirth", "phone"], consentChannels: ["KIOREX_VAULT"] } as any)).order;
      if (st === "COLLECTED" || st === "RESULT_RELEASED") await advance(r, st === "COLLECTED" ? "collected" : "processing");
      if (st === "RESULT_RELEASED") { await enter(r, NORMAL, "medical"); const rep = await reports.sign(users.AUTHORIZED_SIGNATORY, r.id); await reports.release(users.RECEPTION, rep.id, ["KIOREX_VAULT"]).catch((e: any) => console.warn("kiorex release:", e.message)); }
      if (st === "REJECTED") await orders.cancel?.(users.RECEPTION, r.id, "Slot unavailable (DEMO)").catch(() => {});
    });
    await nurseOrders();
    // outbox events produced above describe demo state Kiorex already holds: never push them
    await markSent();
    console.log(`Lab demo seed OK — ${JSON.stringify(done)}; orders total ${await prisma.labOrder.count({ where: { orgId: org } })}`);
  } finally { await app.close(); }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
