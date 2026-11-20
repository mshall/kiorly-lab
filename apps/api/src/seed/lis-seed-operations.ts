import type { Prisma } from "../generated/prisma/client";
import type { AuthUser } from "../auth/auth.types";
import { InventoryService } from "../modules/inventory/inventory.service";
import { OrdersService } from "../modules/orders/orders.service";
import { SpecimensService } from "../modules/specimens/specimens.service";
import { ResultsService } from "../modules/analysis-qc/results.service";
import { ReportsService } from "../modules/release/reports.service";
import { BillingService } from "../modules/business/billing.service";
import { ReferrersService } from "../modules/registry/referrers.service";
import { PatientsService } from "../modules/orders/patients.service";
import { StorageService } from "../modules/preanalytics/storage.service";
import { ManifestsService } from "../modules/preanalytics/manifests.service";
import { MicrobiologyService } from "../modules/microbiology/microbiology.service";
import { HistopathologyService } from "../modules/histopathology/histopathology.service";
import { AppointmentsService } from "../modules/reception/appointments.service";
import { QueueService } from "../modules/reception/queue.service";
import type { Ctx } from "./seed-lis";

const DAY = 86_400_000;
const FIRST = ["Ahmed", "Mohamed", "Mahmoud", "Omar", "Youssef", "Karim", "Tarek", "Hassan", "Khaled", "Ali", "Mariam", "Fatma", "Nour", "Salma", "Hana", "Dina", "Rana", "Laila", "Yasmin", "Aya"];
const LAST = ["El-Sayed", "Hassan", "Ibrahim", "Mostafa", "Nabil", "Fathy", "Adel", "Soliman", "Gamal", "Farouk", "Mansour", "Radwan", "Kamel", "Shawky", "Zaki"];
const AR_FIRST: Record<string, string> = { Ahmed: "أحمد", Mohamed: "محمد", Mahmoud: "محمود", Omar: "عمر", Youssef: "يوسف", Karim: "كريم", Tarek: "طارق", Hassan: "حسن", Khaled: "خالد", Ali: "علي", Mariam: "مريم", Fatma: "فاطمة", Nour: "نور", Salma: "سلمى", Hana: "هنا", Dina: "دينا", Rana: "رنا", Laila: "ليلى", Yasmin: "ياسمين", Aya: "آية" };

export async function seedOperations(c: Ctx): Promise<void> {
  const { prisma, app, tenant, users, lab, bench } = c;
  const org = tenant.id;
  const orders = app.get(OrdersService), spec = app.get(SpecimensService), results = app.get(ResultsService), reports = app.get(ReportsService), billing = app.get(BillingService);
  const inv = app.get(InventoryService), refs = app.get(ReferrersService), patientsSvc = app.get(PatientsService), storage = app.get(StorageService), manifests = app.get(ManifestsService);
  const micro = app.get(MicrobiologyService), histo = app.get(HistopathologyService), appts = app.get(AppointmentsService), queue = app.get(QueueService);
  const tech = users.TECHNOLOGIST, sig = users.AUTHORIZED_SIGNATORY, dir = users.LAB_DIRECTOR, rec = users.RECEPTION, sup = users.SUPERVISOR, mgr = users.BRANCH_MANAGER;
  const analytes = new Map((await prisma.analyte.findMany({ where: { orgId: org } })).map((a) => [a.code, a]));
  const testId = async (code: string) => (await prisma.testDefinition.findFirstOrThrow({ where: { orgId: org, code } })).id;
  const consent = ["PRINTED", "PATIENT_LINK_OTP", "KIOREX_VAULT", "REFERRER_PORTAL"] as const;

  // =================================================================== inventory (before any result so consumption is real)
  const sup1 = await inv.createSupplier(mgr, { name: "MedSupply (demo)", contactName: "Sherif Adel", phone: "+201000007001", email: "orders@medsupply.demo.test", leadTimeDays: 5, paymentTermsDays: 30 });
  const sup2 = await inv.createSupplier(mgr, { name: "LabChem Egypt (demo)", contactName: "Nadia Fouad", phone: "+201000007002", email: "sales@labchem.demo.test", leadTimeDays: 10, paymentTermsDays: 45 });
  const sup3 = await inv.createSupplier(mgr, { name: "SafeCare Disposables (demo)", phone: "+201000007003", leadTimeDays: 3 });
  const ITEMS: [string, string, string, "REAGENT" | "CONSUMABLE" | "CALIBRATOR" | "CONTROL", string, number, number, string, number, number][] = [
    ["RGT-GLU", "Glucose reagent", "كاشف الجلوكوز", "REAGENT", "mL", 40, 200, sup1.id, 0.9, 4000], ["RGT-CREA", "Creatinine reagent", "كاشف الكرياتينين", "REAGENT", "mL", 40, 200, sup1.id, 1.4, 3000],
    ["RGT-UREA", "Urea reagent", "كاشف اليوريا", "REAGENT", "mL", 30, 150, sup1.id, 1.1, 3000], ["RGT-ALT", "ALT reagent", "كاشف ALT", "REAGENT", "mL", 30, 150, sup1.id, 1.6, 2500],
    ["RGT-AST", "AST reagent", "كاشف AST", "REAGENT", "mL", 30, 150, sup1.id, 1.6, 2500], ["RGT-TSH", "TSH immunoassay kit", "كيت TSH", "REAGENT", "test", 50, 200, sup2.id, 14, 800],
    ["RGT-HBA1C", "HbA1c kit", "كيت السكر التراكمي", "REAGENT", "test", 40, 200, sup2.id, 18, 300], ["RGT-CBC", "CBC lyse + diluent set", "محلول صورة الدم", "REAGENT", "test", 100, 500, sup2.id, 4, 2000],
    ["RGT-LIPID", "Lipid reagent set", "كواشف الدهون", "REAGENT", "mL", 30, 150, sup1.id, 2.2, 2200], ["RGT-VITD", "Vitamin D kit", "كيت فيتامين د", "REAGENT", "test", 20, 100, sup2.id, 55, 150],
    ["CAL-CHEM", "Chemistry calibrator", "معايرة الكيمياء", "CALIBRATOR", "mL", 3, 6, sup1.id, 260, 20], ["CTRL-L1", "QC control level 1", "عينة ضبط 1", "CONTROL", "mL", 5, 10, sup1.id, 90, 30],
    ["TUBE-SST", "SST serum tube", "أنبوب سيرم", "CONSUMABLE", "pcs", 300, 2000, sup3.id, 1.2, 6000], ["TUBE-EDTA", "EDTA tube", "أنبوب EDTA", "CONSUMABLE", "pcs", 300, 2000, sup3.id, 1.1, 6000],
    ["TUBE-CIT", "Citrate tube", "أنبوب سيترات", "CONSUMABLE", "pcs", 100, 800, sup3.id, 1.6, 1500], ["CUP-URN", "Urine cup", "كوب بول", "CONSUMABLE", "pcs", 200, 1000, sup3.id, 0.7, 3000],
    ["SWAB", "Transport swab", "مسحة", "CONSUMABLE", "pcs", 100, 600, sup3.id, 2.5, 800], ["GLOVE-M", "Nitrile gloves (M, box)", "قفازات", "CONSUMABLE", "box", 20, 80, sup3.id, 85, 60],
    ["TIPS", "Pipette tips (rack)", "أطراف ماصة", "CONSUMABLE", "rack", 30, 100, sup3.id, 22, 200], ["LABEL", "Barcode label roll", "ورق ملصقات", "CONSUMABLE", "roll", 10, 40, sup3.id, 120, 30],
    ["NEEDLE", "Vacutainer needle 21G", "إبر سحب", "CONSUMABLE", "pcs", 300, 2000, sup3.id, 0.8, 4000], ["ALCW", "Alcohol swab", "قطن كحول", "CONSUMABLE", "pcs", 500, 3000, sup3.id, 0.2, 9000],
    ["CULT-MED", "Culture media plates", "أطباق مزارع", "REAGENT", "pcs", 60, 200, sup2.id, 9, 120], ["FORMALIN", "Formalin 10% (L)", "فورمالين", "REAGENT", "L", 5, 20, sup2.id, 70, 12],
    ["STAIN-HE", "H&E stain set", "صبغة H&E", "REAGENT", "set", 2, 6, sup2.id, 600, 3],
  ];
  const item: Record<string, { id: string }> = {};
  for (const [code, name, nameAr, category, unit, level, qty, supplierId] of ITEMS) item[code] = await inv.createItem(mgr, { code, name, nameAr, category, unit, reorderLevel: level, reorderQty: qty, supplierId });
  // goods receipt: one lot expiring soon, one expired (to dispose), a long-dated lot; two items deliberately low
  const day = (n: number) => new Date(Date.now() + n * DAY).toISOString().slice(0, 10);
  const lines = ITEMS.filter(([code]) => !["RGT-VITD", "CAL-CHEM"].includes(code)).flatMap(([code, , , , , , , , cost, onHand]) => [
    { itemId: item[code]!.id, lotNumber: `${code.replace(/[^A-Z]/g, "").slice(0, 4)}-2611A`, expiryDate: day(300), qty: Math.round(onHand * 0.7), unitCost: cost },
    { itemId: item[code]!.id, lotNumber: `${code.replace(/[^A-Z]/g, "").slice(0, 4)}-2605B`, expiryDate: day(code === "RGT-HBA1C" ? 18 : 120), qty: Math.round(onHand * 0.3), unitCost: cost * 0.95 },
  ]);
  const grn1 = await inv.receive(mgr, { supplierId: sup1.id, invoiceRef: "MS-INV-8841", lines: lines.slice(0, 20) });
  await inv.receive(mgr, { supplierId: sup2.id, invoiceRef: "LC-2291", lines: lines.slice(20) });
  void grn1;
  await inv.receive(mgr, { supplierId: sup1.id, lines: [{ itemId: item["RGT-VITD"]!.id, lotNumber: "VITD-2512X", expiryDate: day(200), qty: 12, unitCost: 55 }, { itemId: item["CAL-CHEM"]!.id, lotNumber: "CAL-2512", expiryDate: day(90), qty: 2, unitCost: 260 }] });
  const expiredLot = await prisma.inventoryLot.create({ data: { orgId: org, itemId: item["SWAB"]!.id, labId: lab.id, lotNumber: "SWAB-2503OLD", expiryDate: new Date(Date.now() - 20 * DAY), qtyReceived: 40, qtyOnHand: 40, unitCost: 2.5 } });
  void expiredLot;
  // consumption rules: reagent + tube per test run
  const rules: [string, [string, number, number?][]][] = [
    ["GLU", [["RGT-GLU", 0.5, 10], ["TUBE-SST", 1]]], ["KFT", [["RGT-CREA", 0.5, 10], ["RGT-UREA", 0.5, 10], ["TUBE-SST", 1]]], ["LFT", [["RGT-ALT", 0.5, 10], ["RGT-AST", 0.5, 10], ["TUBE-SST", 1]]],
    ["TSH", [["RGT-TSH", 1], ["TUBE-SST", 1]]], ["CBC", [["RGT-CBC", 1], ["TUBE-EDTA", 1]]], ["CBCD", [["RGT-CBC", 1], ["TUBE-EDTA", 1]]], ["HBA1C", [["RGT-HBA1C", 1], ["TUBE-EDTA", 1]]],
    ["LIPID", [["RGT-LIPID", 1.2, 10], ["TUBE-SST", 1]]], ["LIPIDC", [["RGT-LIPID", 1.2, 10], ["TUBE-SST", 1]]], ["VITD", [["RGT-VITD", 1], ["TUBE-SST", 1]]], ["URINE", [["CUP-URN", 1]]], ["UCULT", [["CULT-MED", 2], ["CUP-URN", 1]]],
    ["WCULT", [["CULT-MED", 3], ["SWAB", 1]]], ["HISTO", [["FORMALIN", 0.1], ["STAIN-HE", 0.01]]], ["COAG", [["TUBE-CIT", 1]]],
  ];
  for (const [code, rs] of rules) await inv.setRules(mgr, await testId(code), rs.map(([k, q, w]) => ({ itemId: item[k]!.id, qtyPerTest: q, wastagePercent: w ?? 0 })));
  // purchase orders: draft, sent, received
  await inv.createPo(mgr, { supplierId: sup2.id, expectedAt: day(14), notes: "Quarterly kits", lines: [{ itemId: item["RGT-TSH"]!.id, qty: 400, unitCost: 14 }, { itemId: item["RGT-HBA1C"]!.id, qty: 200, unitCost: 18 }] });
  const poSent = await inv.createPo(mgr, { supplierId: sup3.id, expectedAt: day(5), lines: [{ itemId: item["TUBE-SST"]!.id, qty: 2000, unitCost: 1.15 }, { itemId: item["NEEDLE"]!.id, qty: 1000, unitCost: 0.78 }] });
  await inv.setPoStatus(mgr, poSent.id, "SENT");
  const poRecv = await inv.createPo(mgr, { supplierId: sup1.id, lines: [{ itemId: item["RGT-GLU"]!.id, qty: 100, unitCost: 0.92 }] });
  await inv.setPoStatus(mgr, poRecv.id, "SENT");
  await inv.receive(mgr, { poId: poRecv.id, invoiceRef: "MS-INV-8902", lines: [{ itemId: item["RGT-GLU"]!.id, lotNumber: "GLU-2612C", expiryDate: day(365), qty: 100, unitCost: 0.92 }] });
  // quarantine one lot
  const q = await prisma.inventoryLot.findFirstOrThrow({ where: { orgId: org, itemId: item["CTRL-L1"]!.id } });
  await inv.setLotStatus(mgr, q.id, "QUARANTINE");
  c.log("inventory ready (3 suppliers, 25 items, lots incl. expiring/expired/quarantined, rules, POs)");

  // ================================================================== referrers
  const R = async (b: Parameters<ReferrersService["create"]>[1]) => refs.create(mgr, b);
  const drHana = await R({ name: "Dr. Hana Mostafa", kind: "DOCTOR", specialty: "Endocrinology", phone: "+201000006001", email: "hana@clinic.demo.test", deliveryChannels: ["WHATSAPP", "EMAIL"], deliverOnRelease: true, commissionType: "PERCENT", commissionValue: 10 });
  const drKarim = await R({ name: "Dr. Karim Adel", kind: "DOCTOR", specialty: "Internal medicine", phone: "+201000006002", commissionType: "PERCENT", commissionValue: 8 });
  const nile = await R({ name: "Nile Family Clinic", kind: "CLINIC", specialty: "Family medicine", phone: "+201000006003", email: "lab@nileclinic.demo.test", deliveryChannels: ["EMAIL"], deliverOnRelease: true, commissionType: "FIXED", commissionValue: 15, creditLimit: 20000, paymentTermsDays: 30 });
  const salam = await R({ name: "Al-Salam Hospital", kind: "HOSPITAL", phone: "+201000006004", commissionType: "PERCENT", commissionValue: 5, creditLimit: 50000, paymentTermsDays: 45 });
  const drRania = await R({ name: "Dr. Rania Fouad", kind: "DOCTOR", specialty: "Obstetrics & gynaecology", phone: "+201000006005", commissionType: "PERCENT", commissionValue: 12, deliveryChannels: ["WHATSAPP"], deliverOnRelease: true });
  const giza = await R({ name: "Giza Medical Center", kind: "CORPORATE", phone: "+201000006006", creditLimit: 15000 });
  await refs.creditCharge(mgr, nile.id, 4200, "October referrals invoice");
  await refs.creditPayment(mgr, nile.id, 1500, "Bank transfer 14 Nov");
  await refs.creditCharge(mgr, salam.id, 18250, "Inpatient lab services");
  await refs.issuePortalToken(mgr, drHana.id);

  // ============================================================ patients + multi-visit histories
  const patients: { id: string; name: string; dob: string; sex: "M" | "F"; phone: string }[] = [];
  const mkPatient = async (fullName: string, dob: string, sex: "M" | "F", phone: string, extra: Record<string, unknown> = {}) => {
    const p = await patientsSvc.create(rec, { fullName, dateOfBirth: dob, sex, phone, preferredLocale: "ar", ...extra });
    patients.push({ id: p.id, name: fullName, dob, sex, phone });
    return p;
  };
  const hist: Record<string, Awaited<ReturnType<typeof mkPatient>>> = {};
  hist.t2d = await mkPatient("Hala Fouad", "1967-04-02", "F", "+201001000001", { email: "hala@example.test", city: "Cairo", bloodGroup: "A+", notes: "T2DM, on metformin" });
  hist.ckd = await mkPatient("Omar Sherif", "1958-09-19", "M", "+201001000002", { city: "Giza", bloodGroup: "O+", notes: "CKD stage 3" });
  hist.anaemia = await mkPatient("Dina Magdy", "1992-01-25", "F", "+201001000003", { bloodGroup: "B+" });
  hist.lipid = await mkPatient("Tarek Nabil", "1971-06-11", "M", "+201001000004", { bloodGroup: "AB+" });
  hist.thyroid = await mkPatient("Mona Kamel", "1985-12-30", "F", "+201001000005", { conditions: [] });
  hist.preg = await mkPatient("Aya Hassan", "1996-03-08", "F", "+201001000006", { conditions: ["PREGNANT_T1"], bloodGroup: "O-" });
  for (let i = 0; i < 26; i++) {
    const f = FIRST[i % FIRST.length]!, l = LAST[(i * 7) % LAST.length]!;
    const female = ["Mariam", "Fatma", "Nour", "Salma", "Hana", "Dina", "Rana", "Laila", "Yasmin", "Aya"].includes(f);
    await mkPatient(i % 3 === 0 ? `${AR_FIRST[f]} ${l}` : `${f} ${l}`, `${1950 + ((i * 13) % 55)}-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + ((i * 5) % 27)).padStart(2, "0")}`, female ? "F" : "M", `+2010020${String(i).padStart(5, "0")}`);
  }
  // two duplicate registrations for the merge demo
  await mkPatient("Ahmed Samy", "1980-02-14", "M", "+201003000001");
  await mkPatient("ahmed  samy", "1980-02-14", "M", "+201003000002");
  c.log(`patients registered: ${patients.length}`);

  // helpers ------------------------------------------------------------------------------------------
  const mkOrder = async (p: { id: string }, testCodes: string[], extra: Record<string, unknown> = {}, who: AuthUser = rec) =>
    (await orders.create(who, { patientId: p.id, testCodes: testCodes.filter((x) => !x.startsWith("pkg:")), packageCodes: testCodes.filter((x) => x.startsWith("pkg:")).map((x) => x.slice(4)), identifiersChecked: ["dateOfBirth", "phone"], consentChannels: [...consent], ...extra } as never)).order;
  const advance = async (o: { specimens: { id: string; barcode: string }[] }, to: "collected" | "received" | "processing") => {
    for (const s of o.specimens) {
      await spec.transition(rec, s.id, "collect", { scannedBarcode: s.barcode });
      if (to === "collected") continue;
      await spec.transition(tech, s.id, "receive", { scannedBarcode: s.barcode });
      if (to === "received") continue;
      await spec.transition(tech, s.id, "process", { scannedBarcode: s.barcode });
    }
  };
  const midOf = (code: string, i = 0) => { const a = analytes.get(code); return a ? 0 : i; };
  void midOf;
  const intervalMid = new Map<string, number>();
  for (const iv of await prisma.referenceInterval.findMany({ where: { orgId: org, condition: null } })) { const code = [...analytes.entries()].find(([, a]) => a.id === iv.analyteId)?.[0]; if (code && !intervalMid.has(code) && iv.low != null && iv.high != null) intervalMid.set(code, (Number(iv.low) + Number(iv.high)) / 2); }
  /** Enters (dual control) every non-calculated analyte of an order's items using `values` (else the interval midpoint), then validates. */
  const run = async (o: { id: string }, values: Record<string, number>, level: "none" | "tech" | "medical" = "medical", only?: string[]) => {
    const full = await orders.get(org, o.id);
    for (const it of full.items) {
      if (only && !only.includes(it.test.code)) continue;
      const t = await prisma.testDefinition.findUniqueOrThrow({ where: { id: it.testId }, include: { analytes: { include: { analyte: true } } } });
      for (const ta of t.analytes) {
        if (ta.analyte.formula || ta.analyte.valueType !== "NUMERIC") {
          if (ta.analyte.valueType === "SEMI_QUANT" && !ta.analyte.formula) { const r = await results.enterManual(tech, { orderItemId: it.id, analyteId: ta.analyteId, instrumentId: bench.id, valueText: ta.analyte.normalValues[0] ?? ta.analyte.allowedValues[0]! }); await results.secondEntry(dir, r.id, { valueText: r.valueText! }); }
          continue;
        }
        const v = values[ta.analyte.code] ?? Math.round((intervalMid.get(ta.analyte.code) ?? 10) * 100) / 100;
        const r = await results.enterManual(tech, { orderItemId: it.id, analyteId: ta.analyteId, instrumentId: bench.id, value: v });
        await results.secondEntry(dir, r.id, { value: v });
      }
    }
    if (level === "none") return;
    for (const pass of [0, 1]) {
      const rs = await prisma.result.findMany({ where: { orgId: org, orderItem: { orderId: o.id }, status: { in: ["ENTERED", "TECH_VALIDATED"] } } });
      for (const r of rs) {
        try {
          if (r.status === "ENTERED") await results.techValidate(tech, r.id, { deltaAcknowledged: true, note: "demo: reviewed against history" });
          if (level === "medical" && (r.status === "TECH_VALIDATED" || pass === 0)) await results.medicalValidate(sig, r.id);
        } catch { /* a derived value may need the second pass */ }
      }
    }
  };
  const release = async (o: { id: string }, channels: ("PRINTED" | "PATIENT_LINK_OTP" | "KIOREX_VAULT" | "REFERRER_PORTAL")[] = ["PATIENT_LINK_OTP", "PRINTED"]) => {
    const rep = await reports.sign(sig, o.id);
    await reports.release(rec, rep.id, channels);
    return rep;
  };
  /** Moves every timestamp of an order into the past so history/trend/TAT/aging views have realistic dates (needs trigger bypass; skipped silently when not allowed). */
  const shift = async (orderId: string, days: number) => {
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        const iv = `${days} days`;
        await tx.$executeRawUnsafe(`UPDATE "LabOrder" SET "createdAt" = "createdAt" - interval '${iv}' WHERE id = '${orderId}'`);
        await tx.$executeRawUnsafe(`UPDATE "OrderItem" SET "createdAt" = "createdAt" - interval '${iv}' WHERE "orderId" = '${orderId}'`);
        await tx.$executeRawUnsafe(`UPDATE "Specimen" SET "createdAt" = "createdAt" - interval '${iv}', "collectedAt" = "collectedAt" - interval '${iv}' WHERE "orderId" = '${orderId}'`);
        await tx.$executeRawUnsafe(`UPDATE "CustodyEvent" SET "occurredAt" = "occurredAt" - interval '${iv}' WHERE "specimenId" IN (SELECT id FROM "Specimen" WHERE "orderId" = '${orderId}')`);
        await tx.$executeRawUnsafe(`UPDATE "Result" SET "enteredAt" = "enteredAt" - interval '${iv}', "techValidatedAt" = "techValidatedAt" - interval '${iv}', "medicalValidatedAt" = "medicalValidatedAt" - interval '${iv}', "releasedAt" = "releasedAt" - interval '${iv}' WHERE "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "orderId" = '${orderId}')`);
        await tx.$executeRawUnsafe(`UPDATE "ReleaseRecord" SET "releasedAt" = "releasedAt" - interval '${iv}' WHERE "reportVersionId" IN (SELECT id FROM "ReportVersion" WHERE "orderId" = '${orderId}')`);
        await tx.$executeRawUnsafe(`UPDATE "ReportVersion" SET "createdAt" = "createdAt" - interval '${iv}', "signedAt" = "signedAt" - interval '${iv}' WHERE "orderId" = '${orderId}'`);
        await tx.$executeRawUnsafe(`UPDATE "Invoice" SET "createdAt" = "createdAt" - interval '${iv}', "issuedAt" = "issuedAt" - interval '${iv}', "dueAt" = "dueAt" - interval '${iv}' WHERE "orderId" = '${orderId}'`);
        await tx.$executeRawUnsafe(`UPDATE "Payment" SET "createdAt" = "createdAt" - interval '${iv}' WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "orderId" = '${orderId}')`);
      });
    } catch (e) { c.log(`(date back-shifting skipped: ${(e as Error).message.split("\n")[0]})`); }
  };
  (globalThis as unknown as { __lisShift: typeof shift }).__lisShift = shift;

  const visits: [typeof hist.t2d, string[], { [k: string]: number }[], number[], Record<string, unknown>?][] = [
    [hist.t2d, ["GLU", "HBA1C", "KFT"], [{ GLU: 142, HBA1C: 8.1, CREA: 0.9 }, { GLU: 131, HBA1C: 7.6, CREA: 0.9 }, { GLU: 126, HBA1C: 7.2, CREA: 1 }, { GLU: 118, HBA1C: 6.9, CREA: 0.9 }, { GLU: 109, HBA1C: 6.6, CREA: 0.9 }], [150, 120, 90, 60, 30], { referrerId: drHana.id }],
    [hist.ckd, ["EGFR", "KFT"], [{ CREA: 1.3, K: 4.8, UREA: 44 }, { CREA: 1.5, K: 5.0, UREA: 52 }, { CREA: 1.7, K: 5.3, UREA: 61 }, { CREA: 1.9, K: 5.6, UREA: 70 }], [120, 80, 40, 12], { referrerId: salam.id }],
    [hist.anaemia, ["CBC", "FERR"], [{ HB: 9.1, FERR: 8 }, { HB: 9.9, FERR: 15 }, { HB: 10.8, FERR: 28 }, { HB: 11.9, FERR: 45 }, { HB: 12.6, FERR: 62 }], [140, 105, 70, 35, 7], { referrerId: drKarim.id }],
    [hist.lipid, ["LIPIDC"], [{ CHOL: 268, TRIG: 240, HDLC: 34 }, { CHOL: 241, TRIG: 205, HDLC: 38 }, { CHOL: 218, TRIG: 170, HDLC: 42 }, { CHOL: 196, TRIG: 140, HDLC: 47 }], [110, 75, 40, 10], { referrerId: nile.id }],
    [hist.thyroid, ["TSH", "THYR"], [{ TSH: 8.2, FT4: 0.7 }, { TSH: 6.1, FT4: 0.9 }, { TSH: 4.4, FT4: 1.1 }, { TSH: 2.8, FT4: 1.3 }], [130, 90, 50, 14], { referrerId: drHana.id }],
    [hist.preg, ["TSH", "CBC"], [{ TSH: 3.1, HB: 11.2 }, { TSH: 2.2, HB: 11.8 }], [45, 10], { referrerId: drRania.id }],
  ];
  const relOrders: { id: string; patient: string }[] = [];
  for (const [p, codes, values, ago, extra] of visits) {
    for (let i = 0; i < values.length; i++) {
      const o = await mkOrder(p, codes, extra ?? {});
      await advance(o, "processing");
      await run(o, values[i]!);
      await release(o);
      await shift(o.id, ago[i]!);
      relOrders.push({ id: o.id, patient: p.id });
    }
  }
  // routine single-visit history for the other registered patients (varied tests, mostly normal, some abnormal)
  const mixes = [["CBCD"], ["KFT", "LFT"], ["LIPID"], ["THYR"], ["VITD", "CBC"], ["HBA1C"], ["URINE", "GLU"], ["pkg:EXEC"], ["COAG"], ["IRONP"], ["BONE"], ["ELEC"]];
  for (let i = 0; i < 18; i++) {
    const p = patients[6 + i]!;
    const o = await mkOrder(p, mixes[i % mixes.length]!, i % 4 === 0 ? { referrerId: [drKarim.id, nile.id, drRania.id, salam.id][i % 4 === 0 ? (i / 4) % 4 : 0] } : {});
    await advance(o, "processing");
    await run(o, i % 5 === 0 ? { GLU: 168, HBA1C: 7.4, CHOL: 242, ALT: 71, TSH: 6.2 } : {});
    await release(o);
    await shift(o.id, 2 + ((i * 9) % 85));
    relOrders.push({ id: o.id, patient: p.id });
  }
  c.log(`released history orders: ${relOrders.length}`);

  // ============================================================ orders in every workflow state (today)
  const P = (i: number) => patients[(6 + i) % patients.length]!;
  await mkOrder(P(20), ["CBCD", "GLU"], { priority: "STAT", clinicalInfo: "Chest pain, rule out infection", icdCodes: ["R50"], referrerId: drKarim.id }); // awaiting collection (STAT)
  await mkOrder(P(21), ["GLU", "LIPID"], { clinicalInfo: "Annual check, fasting 12h", icdCodes: ["Z00"], fastingConfirmed: true }); // awaiting collection (fasting)
  await mkOrder(P(22), ["pkg:WOMEN"], { referrerId: drRania.id }); // package, awaiting collection
  const c1 = await mkOrder(P(0), ["TSH", "CBC"]); await advance(c1, "collected");
  const c2 = await mkOrder(P(1), ["KFT"], { priority: "URGENT" }); await advance(c2, "collected");
  const i1 = await mkOrder(P(2), ["LFT"]); await advance(i1, "received");
  const i2 = await mkOrder(P(3), ["CBCD", "CRP"].filter((x) => x !== "CRP")); await advance(i2, "processing");
  const i3 = await mkOrder(P(4), ["GLU", "CBC"]); await advance(i3, "processing"); await run(i3, { GLU: 99 }, "none", ["GLU"]); // partially resulted
  const v1 = await mkOrder(P(5), ["KFT", "CBC"], { referrerId: nile.id }); await advance(v1, "processing"); await run(v1, {}, "tech"); // awaiting medical validation
  const v2 = await mkOrder(P(6), ["LIPIDC"]); await advance(v2, "processing"); await run(v2, { CHOL: 232, TRIG: 188, HDLC: 39 }, "tech");
  const v3 = await mkOrder(P(7), ["THYR"]); await advance(v3, "processing"); await run(v3, { TSH: 7.4, FT4: 0.6 }, "medical"); // validated, ready to sign (abnormal)
  const v4 = await mkOrder(P(8), ["CBC", "GLU"]); await advance(v4, "processing"); await run(v4, {}, "medical"); // validated, ready to sign
  const crit = await mkOrder(P(9), ["CBC"], { priority: "STAT", referringDoctorPhone: "+201000006001" }); await advance(crit, "processing"); await run(crit, { HB: 6.1 }, "none"); // critical haemoglobin => open alert
  const canc1 = await mkOrder(P(10), ["VITD"]); await orders.cancel(rec, canc1.id, "patient postponed");
  const canc2 = await mkOrder(P(11), ["HBA1C"]); await orders.cancel(rec, canc2.id, "duplicate order entered");
  // a corrected (amended) report: version 2 with a reason
  const am = await mkOrder(P(12), ["GLU"]); await advance(am, "processing"); await run(am, { GLU: 94 }); await release(am);
  const amRes = await prisma.result.findFirstOrThrow({ where: { orgId: org, orderItem: { orderId: am.id }, status: "RELEASED" } });
  const fixed = await results.correct(tech, amRes.id, { value: 104, reason: "transcription error found on audit" });
  await results.secondEntry(dir, fixed.id, { value: 104 }); await results.techValidate(tech, fixed.id, {}); await results.medicalValidate(sig, fixed.id);
  await release(am);
  c.log("orders in every state created (awaiting, collected, in lab, partial, awaiting validation, validated, critical, cancelled, amended)");

  // ============================================================ pre-analytics: rejection, aliquots, storage, manifests
  const rj = await mkOrder(P(13), ["GLU"]); await spec.transition(rec, rj.specimens[0]!.id, "collect", { scannedBarcode: rj.specimens[0]!.barcode }); await spec.transition(tech, rj.specimens[0]!.id, "receive", { scannedBarcode: rj.specimens[0]!.barcode });
  await spec.reject(tech, rj.specimens[0]!.id, "HAEMOLYSED", "gross haemolysis, recollect");
  const rj2 = await mkOrder(P(14), ["CBC"]); await spec.transition(rec, rj2.specimens[0]!.id, "collect", { scannedBarcode: rj2.specimens[0]!.barcode }); await spec.transition(tech, rj2.specimens[0]!.id, "receive", { scannedBarcode: rj2.specimens[0]!.barcode });
  await spec.reject(tech, rj2.specimens[0]!.id, "INSUFFICIENT_VOLUME");
  const al = await mkOrder(P(15), ["LFT"]); await advance(al, "processing"); await spec.aliquot(tech, al.specimens[0]!.id, 2, 1);
  const fr = await storage.createUnit(sup, { name: "Fridge A (2-8 C)", kind: "FRIDGE", rows: 6, cols: 10, tempMinC: 2, tempMaxC: 8 });
  const fz = await storage.createUnit(sup, { name: "Freezer -20", kind: "FREEZER_MINUS20", rows: 4, cols: 8, tempMinC: -25, tempMaxC: -15 });
  await storage.createUnit(sup, { name: "Freezer -80 (archive)", kind: "FREEZER_MINUS80", rows: 5, cols: 9, tempMinC: -86, tempMaxC: -70 });
  await storage.setRule(sup, "Serum", 7); await storage.setRule(sup, "Whole blood", 5);
  // store the released history specimens' serum (older ones past retention => disposal list)
  const stored = await prisma.specimen.findMany({ where: { orgId: org, status: "PROCESSING", orderId: { in: relOrders.slice(0, 14).map((r) => r.id) } } });
  let k = 0;
  for (const s of stored) { await storage.assign(sup, s.id, { unitId: k++ % 3 === 2 ? fz.id : fr.id }); }
  for (const s of await prisma.specimen.findMany({ where: { orgId: org, status: "STORED" }, take: 6, orderBy: { createdAt: "asc" } })) await prisma.specimen.update({ where: { id: s.id }, data: { retentionUntil: new Date(Date.now() - 2 * DAY) } });
  // courier + manifests (inter-branch to a second branch, and a send-out in transit)
  const giz = await prisma.lab.upsert({ where: { orgId_code: { orgId: org, code: "GIZ" } }, create: { orgId: org, name: "Giza Branch", code: "GIZ", address: "Demo address, Giza" }, update: {} });
  await manifests.createCourier(sup, { name: "FastTrack Couriers", phone: "+201000005001", company: "FastTrack" });
  const shipSpec = await prisma.specimen.findMany({ where: { orgId: org, status: "STORED" }, take: 4, orderBy: { createdAt: "desc" } });
  if (shipSpec.length >= 4) {
    const m1 = await manifests.create(sup, { kind: "INTER_BRANCH", toLabId: giz.id, specimenIds: shipSpec.slice(0, 2).map((s) => s.id), courierName: "FastTrack Couriers", courierPhone: "+201000005001", temperatureC: 5, note: "Daily batch to Giza" });
    await manifests.dispatch(sup, m1.id, {}); await manifests.addEvent(sup, m1.id, { status: "IN_TRANSIT", location: "Ring Road" });
    const m2 = await manifests.create(sup, { kind: "SEND_OUT", destinationName: "Al-Borg Reference Laboratory", specimenIds: shipSpec.slice(2, 4).map((s) => s.id), courierName: "FastTrack Couriers" });
    void m2;
  }
  c.log("pre-analytics data created (rejections/recollections, aliquots, 3 storage units, retention rules, 2 manifests)");

  // ============================================================ microbiology + histopathology
  const orgs = await micro.organisms(org), abx = await micro.antibiotics(org);
  const og = (code: string) => orgs.find((o) => o.code === code)!.id, ab = (code: string) => abx.find((a) => a.code === code)!.id;
  const mcase = async (p: { id: string }, code: string, site: string, finalise: "none" | "growth" | "nogrowth" | "blood", orgCode = "ECOLI") => {
    const o = await mkOrder(p, [code]); await advance(o, "processing");
    const cs = await micro.open(tech, { orderItemId: o.items[0]!.id, site, gramStain: finalise === "blood" ? "Gram-positive cocci in clusters" : "Gram-negative bacilli", cultureMedia: ["Blood agar", "MacConkey"] });
    await micro.update(tech, cs.id, { status: "INCUBATING" });
    if (finalise === "none") return o;
    if (finalise === "nogrowth") await micro.update(tech, cs.id, { growth: false });
    else {
      const withIso = await micro.addIsolate(tech, cs.id, { organismId: og(orgCode), quantity: orgCode === "ECOLI" ? ">10^5 CFU/mL" : "heavy growth" });
      const panel = orgCode === "SAURE" ? ["FOX", "GEN", "CIP", "SXT", "CLI", "VAN", "LZD"] : ["AMP", "AMC", "CRO", "MEM", "GEN", "AMK", "CIP", "SXT", "NIT"];
      const rs: Record<string, "S" | "R" | "I"> = { AMP: "R", AMC: "S", CRO: "S", MEM: "S", GEN: "S", AMK: "S", CIP: "I", SXT: "R", NIT: "S", FOX: "S", CLI: "S", VAN: "S", LZD: "S" };
      await micro.setSusceptibilities(tech, cs.id, withIso.isolates[0]!.id, panel.map((a) => ({ antibioticId: ab(a), interpretation: rs[a] ?? "S", method: "DISK" as const, zoneMm: 18 + (a.length % 9), reported: a !== "MEM" })));
    }
    await micro.finalize(tech, cs.id, { instrumentId: bench.id, comment: finalise === "nogrowth" ? undefined : "Correlate clinically." });
    return o;
  };
  const mo1 = await mcase(P(0), "UCULT", "Midstream urine", "growth"); await run(mo1, {}, "medical").catch(() => undefined);
  const mo1r = await prisma.result.findFirst({ where: { orgId: org, orderItem: { orderId: mo1.id } } });
  if (mo1r) { try { await results.techValidate(tech, mo1r.id, {}); await results.medicalValidate(sig, mo1r.id); await release(mo1); } catch { /* left awaiting */ } }
  await mcase(P(1), "WCULT", "Wound swab", "growth", "SAURE");
  await mcase(P(2), "UCULT", "Midstream urine", "nogrowth");
  await mcase(P(3), "BCULT", "Blood (peripheral)", "blood", "SAURE"); // positive blood culture => critical alert
  await mcase(P(4), "UCULT", "Catheter urine", "none");
  const hcase = async (p: { id: string }, code: string, site: string, stage: number, dx?: string) => {
    const o = await mkOrder(p, [code], { clinicalInfo: "Lesion excision", icdCodes: ["C80"] }); await advance(o, "processing");
    const hc = await histo.open(sig, { orderItemId: o.items[0]!.id, site });
    if (stage >= 1) { await histo.advance(sig, hc.id); await histo.update(sig, hc.id, { grossDescription: "Received in formalin: one tissue fragment, 0.8 x 0.6 x 0.4 cm, entirely submitted in cassette A.", blocks: 1, slides: 3 }); }
    if (stage >= 2) await histo.advance(sig, hc.id);
    if (stage >= 3) await histo.advance(sig, hc.id);
    if (dx) await histo.update(sig, hc.id, { diagnosis: dx, microscopicDescription: "Sections show benign tissue with preserved architecture.", morphologyCode: "8211/0", synoptic: { margins: "Clear", grade: "Low" } });
    if (stage >= 4) await histo.signOut(sig, hc.id, { instrumentId: bench.id });
    return { o, hc };
  };
  const h1 = await hcase(P(5), "HISTO", "Sigmoid colon polyp", 4, "Tubular adenoma with low-grade dysplasia");
  await histo.addAddendum(sig, h1.hc.id, "Immunostains: MLH1 and MSH2 expression retained.");
  await hcase(P(6), "HISTO", "Skin lesion, left forearm", 3, "Seborrhoeic keratosis");
  await hcase(P(7), "HISTO", "Breast core biopsy", 1);
  await hcase(P(8), "CYTO", "Thyroid FNAC", 0);
  c.log("microbiology (5 cases incl. positive blood culture) and histopathology (4 cases) created");

  // ============================================================ reception: appointments + queue
  const tomorrow = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  const slotsAt = ["08:00", "08:30", "09:00", "09:00", "10:30", "11:00", "13:00", "15:30"];
  for (let i = 0; i < slotsAt.length; i++) {
    const p = patients[(i * 3) % patients.length]!;
    await appts.book(rec, { patientId: p.id, patientName: p.name, phone: p.phone, startsAt: `${tomorrow}T${slotsAt[i]}:00.000Z`, testCodes: i % 2 ? ["GLU", "HBA1C"] : ["CBCD"], fasting: i % 2 === 1, kind: i === 7 ? "PACKAGE" : "WALK_IN", packageCode: i === 7 ? "EXEC" : undefined });
  }
  const tk = [] as { id: string }[];
  for (const [name, pr] of [["Walk-in 1", "ROUTINE"], ["Walk-in 2", "ROUTINE"], ["Urgent case", "URGENT"], ["Walk-in 3", "ROUTINE"], ["STAT case", "STAT"], ["Walk-in 4", "ROUTINE"]] as const) tk.push(await queue.issue(rec, { patientName: name, priority: pr }));
  const called = await queue.callNext(rec, { counter: "1" }); await queue.setStatus(rec, called.id, "SERVING"); await queue.setStatus(rec, called.id, "DONE");
  await queue.callNext(rec, { counter: "2" });
  c.log("reception data created (8 appointments tomorrow, queue board with called/served tickets)");
  void mgr;
}
