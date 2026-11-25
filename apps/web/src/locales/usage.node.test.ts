import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const src = join(here, "..");
const en = JSON.parse(readFileSync(join(here, "en.json"), "utf8"));

const get = (o: any, path: string) => path.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const files = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) && !p.endsWith(".test.ts") ? [p] : []; });

describe("i18n coverage", () => {
  it("every static t(\"key\") used in the UI exists in en.json", () => {
    const missing = new Set<string>();
    // Quick-setup strings live in setup/setup-strings.ts and are merged at runtime (the shared locale files stay untouched): a `setup.<k>` key is covered by a `"<k>":` entry there.
    const setupSrc = readFileSync(join(src, "setup/setup-strings.ts"), "utf8");
    const growthSrc = readFileSync(join(src, "features/growth/growth-strings-data.ts"), "utf8"); // Growth strings: merged at runtime like Quick setup (GRW-P4-B1)
    const subSrc = readFileSync(join(src, "features/subscription/subscription-strings.ts"), "utf8"); // SUB-01 strings: merged at runtime like Quick setup
    for (const f of files(src)) {
      // a call with a default value (`t("key", "Default")`) always renders something; only bare keys must exist
      for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([A-Za-z0-9_.]+)"(\s*,\s*["'`])?/g)) {
        if (m[2]) continue;
        if (m[1].startsWith("growth.") && growthSrc.includes(`"${m[1].split(".").pop()}":`)) continue;
        if (m[1].startsWith("sub.") && subSrc.includes(`"${m[1].slice(4)}":`)) continue;
        if (m[1].startsWith("setup.") && setupSrc.includes(`"${m[1].split(".").pop()}":`)) continue;
        if (typeof get(en, m[1]) !== "string") missing.add(m[1]);
      }
    }
    assert.deepEqual([...missing], []);
  });

  it("dynamic key families cover every enum value the API can return", () => {
    const families: Record<string, string[]> = {
      status: ["DRAFT", "AWAITING_COLLECTION", "COLLECTED", "IN_LAB", "PARTIALLY_RESULTED", "AWAITING_VALIDATION", "VALIDATED", "RELEASED", "CANCELLED", "PENDING_COLLECTION", "IN_TRANSIT", "RECEIVED", "PROCESSING", "STORED", "DISPOSED", "REJECTED", "ENTERED", "TECH_VALIDATED", "MEDICAL_VALIDATED", "CORRECTED", "PASS", "WARNING", "FAIL", "OPEN", "CLEARED", "ACKNOWLEDGED", "ESCALATED", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID", "REQUESTED", "SCHEDULED", "EN_ROUTE", "ARRIVED", "FAILED", "ABORTED_UNSAFE", "OK", "AT_RISK", "BREACHED", "DONE_ON_TIME", "DONE_LATE", "NO_TARGET"],
      flag: ["NORMAL", "LOW", "HIGH", "CRITICAL_LOW", "CRITICAL_HIGH", "ABNORMAL"],
      role: ["OWNER", "LAB_DIRECTOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST", "RECEPTION", "BRANCH_MANAGER", "SUPERVISOR", "FINANCE"],
      channel: ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIORLY_NURSE_IMPORT", "KIOREX_VAULT", "REFERRER_PORTAL"],
      "orders.sources": ["WALK_IN", "KIORLY_CLINIC", "KIOREX_BOOKING", "REFERRING_DOCTOR", "KIORLY_NURSE"],
      "spec.event": ["COLLECTED", "TRANSPORT_STARTED", "RECEIVED", "PROCESSING_STARTED", "ALIQUOTED", "STORED", "DISPOSED", "REJECTED", "LABEL_MISMATCH_BLOCKED"],
      "spec.reasons": ["HAEMOLYSED", "INSUFFICIENT_VOLUME", "MISLABELLED", "WRONG_CONTAINER", "CLOTTED", "OTHER", "LIPAEMIC", "LEAKED", "UNLABELLED", "TEMPERATURE_EXCURSION", "STABILITY_EXCEEDED"],
      "spec.action": ["collect", "transport", "receive", "process", "store", "dispose"],
      "qc.ruleText": ["1_2s", "1_3s", "2_2s", "R_4s", "4_1s", "10x"],
      "qc.levels": ["LEVEL_1", "LEVEL_2", "LEVEL_3"],
      "qc.result": ["PASS", "WARNING", "FAIL"],
      "rep.export": ["invoices", "payments", "orders", "qc-runs", "tat", "results-summary"],
      "pat.consent": ["RESULT_SHARING", "DATA_PROCESSING", "MARKETING", "RESEARCH"], "pat.reason": ["NATIONAL_ID", "PHONE_DOB", "NAME_DOB"],
      "ref.kinds": ["DOCTOR", "CLINIC", "HOSPITAL", "CORPORATE"], "ref.chan": ["WHATSAPP", "EMAIL", "SMS"], "ref.commissionTypes": ["NONE", "PERCENT", "FIXED"], "ref.acct": ["COMMISSION", "CREDIT"],
      "ref.ledgerType": ["COMMISSION_ACCRUED", "COMMISSION_REVERSED", "COMMISSION_PAYOUT", "CREDIT_CHARGE", "CREDIT_PAYMENT", "ADJUSTMENT"],
      "rec.kinds": ["WALK_IN", "PACKAGE", "HOME", "FOLLOW_UP"], "oe.recipients": ["PATIENT", "REFERRER"],
      "sto.kinds": ["FRIDGE", "FREEZER_MINUS20", "FREEZER_MINUS80", "ROOM_TEMP", "RACK"], "sto.manifestKinds": ["INTER_BRANCH", "SEND_OUT"], "sto.manifestStatus": ["DRAFT", "DISPATCHED", "IN_TRANSIT", "DELIVERED", "RECEIVED", "CANCELLED"],
      "sto.recolStatus": ["REQUESTED", "NOTIFIED", "COLLECTED", "CANCELLED"], "sto.events": ["PICKED_UP", "IN_TRANSIT", "DELAYED", "DELIVERED", "NOTE"],
      "mic.status": ["RECEIVED", "INCUBATING", "PRELIMINARY", "FINAL"], "mic.hstatus": ["RECEIVED", "GROSSING", "PROCESSING", "REPORTING", "SIGNED_OUT"],
      "qm.areas": ["PRE_ANALYTICAL", "ANALYTICAL", "POST_ANALYTICAL", "EQUIPMENT", "DOCUMENT", "PERSONNEL", "SAFETY", "OTHER"], "qm.severities": ["MINOR", "MAJOR", "CRITICAL"], "qm.ncStatus": ["OPEN", "INVESTIGATING", "ACTION", "VERIFIED", "CLOSED"],
      "qm.capaStatus": ["OPEN", "DONE", "VERIFIED"], "qm.categories": ["SOP", "POLICY", "FORM", "MANUAL", "WORK_INSTRUCTION"], "qm.docStatus": ["DRAFT", "IN_REVIEW", "APPROVED", "SUPERSEDED"], "qm.eqaStatus": ["ACCEPTABLE", "WARNING", "UNACCEPTABLE"],
      "qm.lotState": ["OK", "EXPIRING_SOON", "EXPIRED"], "qm.lotStatus": ["ACTIVE", "RETIRED"], "qm.maintKinds": ["PREVENTIVE", "CORRECTIVE", "CLEANING", "CALIBRATION", "PARTS"],
      "qm.kpi": ["lotsExpired", "lotsExpiringSoon", "maintenanceOverdue", "calibrationsDue", "ncrOpen", "capaOverdue", "documentsReviewOverdue", "eqaUnacceptable90d"], "qm.forms": ["calib", "eqa", "sched", "mlog", "ncr", "doc"],
      "inv.categories": ["REAGENT", "CONSUMABLE", "CALIBRATOR", "CONTROL", "GENERAL"], "inv.lotStatus": ["ACTIVE", "QUARANTINE", "EXPIRED", "DEPLETED"], "inv.poStatus": ["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"],
      "inv.countStatus": ["OPEN", "COMPLETED"], "inv.moveTypes": ["RECEIPT", "CONSUMPTION", "ADJUSTMENT", "COUNT_VARIANCE", "DISPOSAL"], "inv.forms": ["item", "supplier", "receive", "po", "adjust"],
      "fin.cat": ["RENT", "SALARIES", "UTILITIES", "REAGENTS", "CONSUMABLES", "EQUIPMENT", "MAINTENANCE", "TRANSPORT", "MARKETING", "PROFESSIONAL_FEES", "OTHER"], "fin.method": ["CASH", "CARD", "TRANSFER", "CHEQUE"],
      "fin.bucket": ["current", "d1_30", "d31_60", "d61_90", "d90_plus"], "fin.partyKind": ["PAYER", "PATIENT"], "fin.accountKind": ["INSURANCE", "CORPORATE"], "fin.export": ["expenses", "refunds", "payments", "invoices"],
      "ana.groups": ["operations", "clinical", "quality", "finance", "inventory"], "tpl.lang": ["AR", "EN", "BILINGUAL"], "set.modes": ["STANDALONE", "INTEGRATED"], "set.modeNote": ["STANDALONE", "INTEGRATED"],
      "work.sections": ["HEMATOLOGY", "CHEMISTRY", "IMMUNOLOGY", "SEROLOGY", "COAGULATION", "URINALYSIS", "MICROBIOLOGY", "GENERAL"], "nav.groups": ["front", "lab", "quality", "business", "admin"],
      "phleb.unsafeReasons": ["THREAT_OR_AGGRESSION", "UNSAFE_ENVIRONMENT", "ANIMAL", "OTHER"],
      nav: ["dashboard", "orders", "accessioning", "worklist", "validation", "qc", "release", "critical", "billing", "reports", "catalogue", "settings", "phleb", "reception", "patients", "referrers", "storage", "microbiology", "quality", "inventory", "finance", "analytics"],
    };
    for (const [fam, keys] of Object.entries(families)) for (const k of keys) assert.equal(typeof get(en, `${fam}.${k}`), "string", `${fam}.${k}`);
  });

  it("the stop-ship error codes have friendly messages", () => {
    for (const c of ["LABEL_MISMATCH", "ACCESSION_DUPLICATE", "QC_BLOCK_OPEN", "REPORT_NOT_READY", "CONSENT_REQUIRED", "FEATURE_DISABLED", "PLAN_REQUIRED", "NOT_AUTHORIZED_SIGNATORY", "SAFETY_CONTACT_REQUIRED", "OUT_OF_COVERAGE", "PHLEBOTOMIST_UNAVAILABLE", "NO_SHOW_NOT_ALLOWED", "GEOSTAMP_REQUIRED"]) assert.equal(typeof get(en, `errors.${c}`), "string", c);
  });
});
