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
    for (const f of files(src)) {
      for (const m of readFileSync(f, "utf8").matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)) if (typeof get(en, m[1]) !== "string") missing.add(m[1]);
    }
    assert.deepEqual([...missing], []);
  });

  it("dynamic key families cover every enum value the API can return", () => {
    const families: Record<string, string[]> = {
      status: ["DRAFT", "AWAITING_COLLECTION", "COLLECTED", "IN_LAB", "PARTIALLY_RESULTED", "AWAITING_VALIDATION", "VALIDATED", "RELEASED", "CANCELLED", "PENDING_COLLECTION", "IN_TRANSIT", "RECEIVED", "PROCESSING", "STORED", "DISPOSED", "REJECTED", "ENTERED", "TECH_VALIDATED", "MEDICAL_VALIDATED", "CORRECTED", "PASS", "WARNING", "FAIL", "OPEN", "CLEARED", "ACKNOWLEDGED", "ESCALATED", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID", "REQUESTED", "SCHEDULED", "EN_ROUTE", "FAILED", "OK", "AT_RISK", "BREACHED", "DONE_ON_TIME", "DONE_LATE", "NO_TARGET"],
      flag: ["NORMAL", "LOW", "HIGH", "CRITICAL_LOW", "CRITICAL_HIGH", "ABNORMAL"],
      role: ["OWNER", "LAB_DIRECTOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST", "RECEPTION", "BRANCH_MANAGER"],
      channel: ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"],
      "orders.sources": ["WALK_IN", "KIORLY_CLINIC", "KIOREX_BOOKING", "REFERRING_DOCTOR"],
      "spec.event": ["COLLECTED", "TRANSPORT_STARTED", "RECEIVED", "PROCESSING_STARTED", "ALIQUOTED", "STORED", "DISPOSED", "REJECTED", "LABEL_MISMATCH_BLOCKED"],
      "spec.reasons": ["HAEMOLYSED", "INSUFFICIENT_VOLUME", "MISLABELLED", "WRONG_CONTAINER", "CLOTTED", "OTHER"],
      "spec.action": ["collect", "transport", "receive", "process", "store", "dispose"],
      "qc.ruleText": ["1_2s", "1_3s", "2_2s", "R_4s", "4_1s", "10x"],
      "qc.levels": ["LEVEL_1", "LEVEL_2", "LEVEL_3"],
      "qc.result": ["PASS", "WARNING", "FAIL"],
      "rep.export": ["invoices", "payments", "orders", "qc-runs", "tat", "results-summary"],
      nav: ["dashboard", "orders", "accessioning", "worklist", "validation", "qc", "release", "critical", "billing", "reports", "catalogue", "settings", "phleb"],
    };
    for (const [fam, keys] of Object.entries(families)) for (const k of keys) assert.equal(typeof get(en, `${fam}.${k}`), "string", `${fam}.${k}`);
  });

  it("the stop-ship error codes have friendly messages", () => {
    for (const c of ["LABEL_MISMATCH", "ACCESSION_DUPLICATE", "QC_BLOCK_OPEN", "REPORT_NOT_READY", "CONSENT_REQUIRED", "FEATURE_DISABLED", "PLAN_REQUIRED", "NOT_AUTHORIZED_SIGNATORY"]) assert.equal(typeof get(en, `errors.${c}`), "string", c);
  });
});
