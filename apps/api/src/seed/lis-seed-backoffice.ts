import { BillingService } from "../modules/business/billing.service";
import { FinanceService } from "../modules/business/finance.service";
import { OrdersService } from "../modules/orders/orders.service";
import { ReferrersService } from "../modules/registry/referrers.service";
import { QualityService } from "../modules/quality/quality.service";
import type { Ctx } from "./seed-lis";

const DAY = 86_400_000;

/** Phase 3: finance (contracts, discounts, partial payments, refunds, aging, expenses, cash close, commissions) and quality management records. */
export async function seedBackOffice(c: Ctx): Promise<void> {
  const { prisma, app, tenant, users, lab } = c;
  const org = tenant.id;
  const billing = app.get(BillingService), finance = app.get(FinanceService), orders = app.get(OrdersService), refs = app.get(ReferrersService), quality = app.get(QualityService);
  const rec = users.RECEPTION, fin = users.FINANCE, mgr = users.BRANCH_MANAGER, tech = users.TECHNOLOGIST, sup = users.SUPERVISOR, sig = users.AUTHORIZED_SIGNATORY, dir = users.LAB_DIRECTOR;
  let n = 0;
  const key = () => `lis-seed-${Date.now().toString(36)}-${n++}`;
  const backdate = async (orderId: string, days: number) => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
        const iv = `${days} days`;
        await tx.$executeRawUnsafe(`UPDATE "Invoice" SET "createdAt" = "createdAt" - interval '${iv}', "issuedAt" = "issuedAt" - interval '${iv}', "dueAt" = "dueAt" - interval '${iv}' WHERE "orderId" = '${orderId}'`);
        await tx.$executeRawUnsafe(`UPDATE "Payment" SET "createdAt" = "createdAt" - interval '${iv}' WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "orderId" = '${orderId}')`);
        await tx.$executeRawUnsafe(`UPDATE "Refund" SET "createdAt" = "createdAt" - interval '${iv}' WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "orderId" = '${orderId}')`);
        await tx.$executeRawUnsafe(`UPDATE "ReferrerLedgerEntry" SET "createdAt" = "createdAt" - interval '${iv}' WHERE "orderId" = '${orderId}'`);
      });
    } catch { /* needs trigger bypass (superuser); dates stay current */ }
  };

  // ---------------------------------------------------------------- contracts
  const insurer = await prisma.b2bAccount.findFirst({ where: { orgId: org, name: "Demo Insurance Co" } });
  if (insurer) await billing.updateAccount(mgr, insurer.id, { kind: "INSURANCE", discountPercent: 5, coveragePercent: 80, contractRef: "POL-DEMO-2026", contractStart: "2026-01-01", contractEnd: "2026-12-31", billingEmail: "claims@demoinsurance.test" });
  const delta = await billing.createAccount(mgr, { name: "Delta Health Insurance (demo)", kind: "INSURANCE", discountPercent: 8, coveragePercent: 70, paymentTermsDays: 60, contractRef: "DH-77", billingEmail: "claims@delta.demo.test" });
  const nilePharma = await billing.createAccount(mgr, { name: "Nile Pharma Employees (demo)", kind: "CORPORATE", discountPercent: 10, coveragePercent: 100, paymentTermsDays: 30, creditLimit: 30000, contractRef: "NP-STAFF" });

  // ---------------------------------------------------------------- invoices on released history orders
  const released = await prisma.labOrder.findMany({ where: { orgId: org, status: "RELEASED" }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, createdAt: true } });
  let i = 0;
  for (const o of released) {
    if (await prisma.invoice.findFirst({ where: { orderId: o.id } })) continue;
    const manual = i % 7 === 3 ? { discountPercent: 10, reason: "returning patient" } : {};
    const invc = await billing.invoiceOrder(rec, o.id, manual);
    const mode = i % 5;
    if (mode <= 2) await billing.pay(rec, invc.id, mode === 0 ? { method: "CARD", amount: invc.total, cardToken: "tok_visa" } : { method: "CASH", amount: invc.total }, key());
    else if (mode === 3) await billing.pay(rec, invc.id, { method: "CASH", amount: Math.round(invc.total * 0.5 * 100) / 100 }, key());
    const age = Math.max(1, Math.round((Date.now() - o.createdAt.getTime()) / DAY));
    await backdate(o.id, Math.min(age, 100));
    i++;
  }
  // payer-covered orders (insurance/corporate) aged into the receivables buckets
  const people = await prisma.patientRef.findMany({ where: { orgId: org, mergedIntoId: null }, take: 40, orderBy: { createdAt: "asc" } });
  const covered: [string, number, number][] = [[delta.id, 12, 5], [delta.id, 52, 9], [delta.id, 95, 14], [nilePharma.id, 8, 18], [nilePharma.id, 41, 22], [insurer?.id ?? delta.id, 75, 27], [insurer?.id ?? delta.id, 24, 31]];
  for (const [accId, daysAgo, pi] of covered) {
    const p = people[pi % people.length]!;
    const o = (await orders.create(rec, { patientId: p.id, testCodes: ["CBC", "KFT"], b2bAccountId: accId, identifiersChecked: ["dateOfBirth", "phone"], consentChannels: ["PRINTED"] } as never)).order;
    const invc = await billing.invoiceOrder(rec, o.id);
    if (invc.patientShare > 0 && daysAgo % 2 === 0) await billing.pay(rec, invc.id, { method: "CASH", amount: invc.patientShare }, key());
    if (daysAgo === 52) await billing.pay(fin, invc.id, { method: "TRANSFER", payer: "PAYER", amount: Math.round(invc.payerAmount * 0.6 * 100) / 100, reference: "TRF-44102" }, key());
    await backdate(o.id, daysAgo);
  }
  // refunds
  const pays = await prisma.payment.findMany({ where: { orgId: org, status: "SUCCEEDED", method: "CASH", payer: "PATIENT" }, orderBy: { createdAt: "desc" }, take: 3 });
  if (pays[0]) await billing.refund(fin, pays[0].id, { amount: 20, reason: "test cancelled before processing" });
  if (pays[1]) await billing.refund(fin, pays[1].id, { reason: "billed twice" });
  // referrer payouts
  const hana = await prisma.referrer.findFirst({ where: { orgId: org, name: "Dr. Hana Mostafa" } });
  if (hana) { const bal = (await refs.balances(org)).get(hana.id)?.COMMISSION ?? 0; if (bal > 100) await refs.payout(fin, hana.id, Math.floor(bal / 2), "Settlement - first half"); }
  c.log("finance: contracts, invoices with discounts/partial payments, payer settlements, refunds, commission payout");

  // ---------------------------------------------------------------- expenses (3 months) + cash close
  const today = new Date();
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const monthStart = (back: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
  for (let m = 0; m < 3; m++) {
    const d = monthStart(m);
    for (const [cat, amt, vendor, ref] of [["RENT", 18000, "Nile Properties", `RENT-${ymd(d).slice(0, 7)}`], ["SALARIES", 64500, "Payroll", `PAY-${ymd(d).slice(0, 7)}`], ["UTILITIES", 5200 + m * 310, "Electricity & water", undefined], ["REAGENTS", 21000 - m * 1500, "MedSupply (demo)", undefined], ["MAINTENANCE", 2400, "Instrument service contract", undefined], ["MARKETING", 3000, "Local advertising", undefined]] as const)
      await finance.createExpense(fin, { date: ymd(new Date(d.getTime() + (cat === "RENT" ? 0 : 4 * DAY))), category: cat, amount: amt, vendor, paidVia: cat === "UTILITIES" ? "CARD" : "BANK", reference: ref });
  }
  await finance.createExpense(fin, { date: ymd(today), category: "TRANSPORT", amount: 60, vendor: "Taxi (sample courier)", fromDrawer: true, note: "urgent specimen transfer" });
  await finance.createExpense(fin, { date: ymd(today), category: "CONSUMABLES", amount: 140, vendor: "Local pharmacy", fromDrawer: true, note: "gloves + alcohol swabs" });
  const yest = new Date(Date.now() - DAY);
  const day0 = new Date(`${ymd(yest)}T00:00:00.000Z`), day1 = new Date(day0.getTime() + DAY);
  const cashIn = (await prisma.payment.findMany({ where: { orgId: org, labId: lab.id, method: "CASH", status: { in: ["SUCCEEDED", "REFUNDED"] }, createdAt: { gte: day0, lt: day1 } } })).reduce((a, p) => a + Number(p.amount), 0);
  await billing.cashClose(fin, { labId: lab.id, businessDate: ymd(yest), countedCash: Math.round((cashIn - 5) * 100) / 100, note: "5 EGP short, recounted" });

  // ---------------------------------------------------------------- quality
  const instr = await prisma.instrument.findMany({ where: { orgId: org } });
  const analyte = async (code: string) => (await prisma.analyte.findFirstOrThrow({ where: { orgId: org, code } })).id;
  for (const [inst, lot, status, note] of [[instr[0]!, "CAL-CH-2611", "PASS", undefined], [instr[1] ?? instr[0]!, "CAL-HM-2610", "PASS", undefined], [instr[2] ?? instr[0]!, "CAL-IM-2609", "FAIL", "Drift on TSH: recalibrated with fresh lot, QC repeated and passed"], [instr[0]!, "CAL-CH-2610", "PASS", undefined]] as const)
    await quality.calibrate(tech, { instrumentId: inst.id, analyteId: await analyte("GLU"), calibratorLot: lot, calibratorExpiry: ymd(new Date(Date.now() + 120 * DAY)), status, slope: 1.002, intercept: 0.18, nextDueDays: 30, note });
  const eqa: [string, number, number, number][] = [["GLU", 101, 100, 3], ["CREA", 1.18, 1.1, 0.06], ["HB", 13.1, 13.4, 0.35], ["K", 4.9, 4.4, 0.18], ["NA", 141, 140, 1.4], ["TSH", 2.4, 2.1, 0.22]];
  for (const [code, rep, asg, sd] of eqa) await quality.recordEqa(tech, { scheme: "Demo EQA Scheme (synthetic)", cycle: "2026-C5", sampleCode: "S-017", analyteId: await analyte(code), instrumentId: instr[0]!.id, reportedValue: rep, assignedValue: asg, groupSd: sd });
  const sched = await quality.createSchedule(sup, { instrumentId: instr[1]?.id ?? instr[0]!.id, task: "Daily probe cleaning", frequencyDays: 1, firstDueAt: new Date(Date.now() - 2 * DAY).toISOString() });
  await quality.createSchedule(sup, { instrumentId: instr[0]!.id, task: "Weekly photometer lamp check", frequencyDays: 7 });
  const s3 = await quality.createSchedule(sup, { instrumentId: instr[2]?.id ?? instr[0]!.id, task: "Monthly preventive maintenance", frequencyDays: 30 });
  await quality.logMaintenance(tech, { instrumentId: instr[2]?.id ?? instr[0]!.id, scheduleId: s3.id, kind: "PREVENTIVE", notes: "Service engineer visit; all checks passed", downtimeMinutes: 90 });
  await quality.logMaintenance(tech, { instrumentId: instr[0]!.id, kind: "CORRECTIVE", notes: "Replaced worn sample probe", downtimeMinutes: 45, partsReplaced: "Sample probe" });
  void sched;
  const ncr1 = await quality.raiseNcr(tech, { title: "Mislabelled tube at reception", description: "Tube arrived with a label from a different patient; caught by the two-identifier check and recollected.", area: "PRE_ANALYTICAL", severity: "MAJOR", source: "SPECIMEN" });
  await quality.advanceNcr(sup, ncr1.id, { to: "INVESTIGATING" });
  await quality.advanceNcr(sup, ncr1.id, { to: "ACTION", rootCause: "Pre-printed labels stacked out of order at the collection desk", containment: "All tubes of the batch relabelled and rechecked" });
  const capa1 = await quality.addCapa(sup, ncr1.id, { description: "Print labels per patient at the time of collection", ownerId: users.RECEPTION.staffId, dueAt: new Date(Date.now() - 3 * DAY).toISOString() });
  void capa1;
  const ncr2 = await quality.raiseNcr(tech, { title: "Freezer -20 temperature excursion", description: "Alarm at 03:10, peaked at -9 C for 40 minutes. Door seal found loose.", area: "EQUIPMENT", severity: "MAJOR", source: "INSTRUMENT" });
  await quality.advanceNcr(sup, ncr2.id, { to: "INVESTIGATING" });
  const ncr3 = await quality.raiseNcr(sup, { title: "Late critical value call", description: "Critical potassium acknowledged after 52 minutes (target 30).", area: "POST_ANALYTICAL", severity: "MINOR", source: "AUDIT" });
  await quality.advanceNcr(sup, ncr3.id, { to: "INVESTIGATING" });
  await quality.advanceNcr(sup, ncr3.id, { to: "ACTION", rootCause: "On-call phone not charged" });
  const capa3 = await quality.addCapa(sup, ncr3.id, { description: "Dedicated charger + weekly phone check", ownerId: users.TECHNOLOGIST.staffId });
  await quality.completeCapa(tech, capa3.id);
  await quality.verifyCapa(dir, capa3.id, "No late acknowledgements in 6 weeks");
  await quality.advanceNcr(sup, ncr3.id, { to: "VERIFIED" });
  await quality.advanceNcr(sup, ncr3.id, { to: "CLOSED" });
  await quality.raiseNcr(rec, { title: "Patient complaint: long waiting time", description: "Patient waited 70 minutes on Saturday morning.", area: "OTHER", severity: "MINOR", source: "COMPLAINT" });
  // SOP library (document control): approved, in review, draft
  const docs: [string, string, "SOP" | "POLICY" | "FORM" | "MANUAL" | "WORK_INSTRUCTION", string, string, "approve" | "review" | "draft", boolean?][] = [
    ["SOP-001", "Specimen reception and accessioning", "SOP", "Pre-analytics", "# Specimen reception\n\n1. Verify two patient identifiers against the order.\n2. Check the container, volume and fasting status.\n3. Scan the label to receive; a mismatch blocks processing.\n4. Reject with a documented reason and request recollection.", "approve", true],
    ["SOP-002", "Critical value notification", "SOP", "Post-analytics", "# Critical values\n\nThe system raises an alert for every critical result.\n- Acknowledge within the configured window (default 30 min).\n- Unacknowledged alerts escalate to the lab director, then the owner.\n- Record who was informed and when.", "approve"],
    ["SOP-003", "Internal quality control and Westgard rules", "SOP", "Quality", "# Internal QC\n\nRun two levels per analyte each day. Rules: 1-3s, 2-2s, R-4s, 4-1s, 10x. A failed run opens a QC block; patient release is blocked until a documented passing run clears it.", "approve", true],
    ["SOP-004", "Instrument maintenance and calibration", "SOP", "Equipment", "# Maintenance\n\nFollow the schedules in the quality module; log every action. A failed calibration raises an NCR.", "approve"],
    ["SOP-005", "Sample rejection criteria", "SOP", "Pre-analytics", "# Rejection criteria\n\nHaemolysed, clotted, insufficient volume, wrong container, unlabelled, leaked, temperature excursion, stability exceeded.", "review"],
    ["POL-001", "Quality manual", "MANUAL", "Quality", "# Quality manual\n\nDraft in preparation.", "draft"],
  ];
  for (const [code, title, category, section, body, state, revise] of docs) {
    const d = await quality.createDocument(sup, { code, title, category, section, body });
    const v = d.versions[0]!;
    if (state === "draft") continue;
    await quality.transitionVersion(sup, d.id, v.id, "IN_REVIEW");
    if (state === "review") continue;
    await quality.transitionVersion(sig, d.id, v.id, "APPROVED", { reviewMonths: code === "SOP-004" ? 1 : 12 });
    await quality.acknowledge(tech, d.id, v.id);
    if (revise) {
      const r = await quality.reviseDocument(sup, d.id, { body: `${body}\n\n_Revision: clarified responsibilities._`, changeNote: "clarified responsibilities" });
      await quality.transitionVersion(sup, d.id, r.id, "IN_REVIEW");
      await quality.transitionVersion(sig, d.id, r.id, "APPROVED", {});
    }
  }
  c.log("quality: calibrations, EQA (incl. unacceptable result -> NCR), maintenance schedules/logs, NCR/CAPA, SOP library");
  void mgr;
}
