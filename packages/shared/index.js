"use strict";
// Kiorly Lab shared constants (plain CJS so api and web can both consume without a build step).
const PRODUCT_KEY = "kiorly-lab";
const FLAG_KEYS = ["lab.module", "lab.analyzer_interfaces", "lab.home_collection", "lab.kiorex_bookings"];
/** ADR-025: these are NEVER feature flags. */
const SAFETY_CONTROLS = [
  {
    "id": "safety.lab.qc_block",
    "name": "QC_BLOCK",
    "description": "Westgard violation (1-3s, 2-2s, R-4s, 4-1s, 10x) blocks patient release",
    "requirements": "KLQC02"
  },
  {
    "id": "safety.lab.authorized_release",
    "name": "AUTHORIZED_RELEASE",
    "description": "Release requires technical + medical validation and signed report version",
    "requirements": "KLQC04, KLCRIT02"
  },
  {
    "id": "safety.lab.critical_value_escalation",
    "name": "CRITICAL_VALUE_ESCALATION",
    "description": "Unacknowledged critical value escalates after configured minutes",
    "requirements": "KLCRIT01"
  },
  {
    "id": "safety.lab.accession_uniqueness",
    "name": "ACCESSION_UNIQUENESS",
    "description": "Duplicate accession numbers are rejected",
    "requirements": "KLSPC01"
  },
  {
    "id": "safety.lab.custody_append_only",
    "name": "CUSTODY_APPEND_ONLY",
    "description": "Chain of custody is append-only",
    "requirements": "KLSPC03"
  },
  {
    "id": "safety.lab.label_match",
    "name": "LABEL_MATCH",
    "description": "Mislabelled specimens cannot be processed (label mismatch scan blocks)",
    "requirements": "KLSPC02, KLSPC04"
  },
  {
    "id": "safety.lab.audit_logging",
    "name": "AUDIT_LOGGING",
    "description": "State changes affecting results, access, money are audited",
    "requirements": "KX-08 §09"
  },
  {
    "id": "safety.lab.consent_enforcement",
    "name": "CONSENT_ENFORCEMENT",
    "description": "Result release channels require consent",
    "requirements": "KLORD03, KLCRIT02"
  },
  {
    "id": "safety.lab.tenant_isolation",
    "name": "TENANT_ISOLATION",
    "description": "Tenant isolation and authorization",
    "requirements": "KX-08 §09"
  },
  {
    "id": "safety.lab.privileged_mfa",
    "name": "PRIVILEGED_MFA",
    "description": "Privileged MFA on production",
    "requirements": "KX-08 §09"
  }
];
module.exports = { PRODUCT_KEY, FLAG_KEYS, SAFETY_CONTROLS };
