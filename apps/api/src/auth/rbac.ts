import type { StaffRole } from "../generated/prisma/client";

/** Permission catalogue (KX-07 roles). Tenant isolation is separate and not a permission (safety.lab.tenant_isolation). */
export const PERMISSIONS = [
  "catalogue.read", "catalogue.write",
  "patients.read", "patients.write",
  "orders.read", "orders.create", "orders.cancel",
  "collection.manage", "collection.perform",
  "specimens.read", "specimens.label", "specimens.collect", "specimens.receive", "specimens.process", "specimens.reject",
  "results.read", "results.enter", "results.second_entry", "results.tech_validate", "results.medical_validate", "results.correct",
  "qc.read", "qc.run", "qc.clear_block", "instruments.manage", "analyzers.ingest",
  "reports.read", "reports.sign", "reports.release",
  "critical.read", "critical.ack", "critical.configure",
  "billing.read", "billing.invoice", "billing.payment", "billing.cashclose", "billing.pricing",
  "dashboard.read", "exports.run",
  "staff.manage", "settings.manage", "audit.read",
  // standalone-LIS additions (registry, reception, pre-analytics, analytics, quality, inventory, finance, analytics)
  "patients.merge", "referrers.read", "referrers.write", "orders.edit", "queue.manage", "appointments.manage",
  "storage.manage", "manifests.manage", "results.rerun", "micro.enter", "histo.report",
  "quality.read", "quality.log", "quality.manage", "documents.approve",
  "inventory.read", "inventory.manage", "finance.commissions", "expenses.manage", "analytics.read", "reports.deliver", "templates.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS] as Permission[];
const clinicalRead: Permission[] = ["catalogue.read", "patients.read", "orders.read", "specimens.read", "results.read", "qc.read", "reports.read", "critical.read", "dashboard.read"];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  OWNER: all,
  LAB_DIRECTOR: all,
  AUTHORIZED_SIGNATORY: [
    ...clinicalRead, "results.medical_validate", "results.correct", "reports.sign", "reports.release", "critical.ack", "qc.clear_block", "audit.read",
    "histo.report", "micro.enter", "quality.read", "documents.approve", "analytics.read", "referrers.read", "reports.deliver", "results.rerun",
  ],
  TECHNOLOGIST: [
    ...clinicalRead, "specimens.label", "specimens.receive", "specimens.process", "specimens.reject", "results.enter", "results.second_entry",
    "results.tech_validate", "results.correct", "qc.run", "instruments.manage", "analyzers.ingest", "critical.ack",
    "results.rerun", "micro.enter", "quality.read", "quality.log", "inventory.read", "storage.manage", "manifests.manage",
  ],
  PHLEBOTOMIST: ["orders.read", "patients.read", "catalogue.read", "specimens.read", "specimens.label", "specimens.collect", "collection.perform"],
  RECEPTION: [
    "catalogue.read", "patients.read", "patients.write", "orders.read", "orders.create", "orders.cancel", "collection.manage", "specimens.read",
    "specimens.label", "specimens.collect", "reports.read", "reports.release", "billing.read", "billing.invoice", "billing.payment", "billing.cashclose", "dashboard.read",
    "referrers.read", "orders.edit", "queue.manage", "appointments.manage", "reports.deliver",
  ],
  BRANCH_MANAGER: [
    ...clinicalRead, "orders.create", "orders.cancel", "collection.manage", "billing.read", "billing.invoice", "billing.payment", "billing.cashclose",
    "billing.pricing", "exports.run", "staff.manage", "audit.read", "catalogue.write", "instruments.manage",
    "patients.write", "patients.merge", "referrers.read", "referrers.write", "orders.edit", "queue.manage", "appointments.manage", "storage.manage", "manifests.manage",
    "quality.read", "quality.log", "inventory.read", "inventory.manage", "finance.commissions", "expenses.manage", "analytics.read", "reports.deliver", "templates.manage",
  ],
  /** Shift/bench supervisor: runs the floor, approves quality records, merges duplicates; cannot sign reports or touch finance. */
  SUPERVISOR: [
    ...clinicalRead, "patients.write", "patients.merge", "orders.create", "orders.cancel", "orders.edit", "collection.manage", "queue.manage", "appointments.manage",
    "specimens.label", "specimens.collect", "specimens.receive", "specimens.process", "specimens.reject", "storage.manage", "manifests.manage",
    "results.enter", "results.second_entry", "results.tech_validate", "results.correct", "results.rerun", "micro.enter", "qc.run", "qc.clear_block", "instruments.manage", "analyzers.ingest",
    "critical.ack", "critical.configure", "quality.read", "quality.log", "quality.manage", "inventory.read", "inventory.manage", "referrers.read", "analytics.read", "audit.read", "exports.run", "reports.deliver",
  ],
  /** Finance officer: billing, receivables, commissions, expenses, analytics; no clinical entry. */
  FINANCE: [
    "catalogue.read", "patients.read", "orders.read", "reports.read", "dashboard.read", "billing.read", "billing.invoice", "billing.payment", "billing.cashclose", "billing.pricing",
    "referrers.read", "referrers.write", "finance.commissions", "expenses.manage", "exports.run", "analytics.read", "inventory.read",
  ],
};

export const PRIVILEGED_ROLES: readonly StaffRole[] = ["OWNER", "LAB_DIRECTOR", "AUTHORIZED_SIGNATORY"];
/** Who may perform medical validation / sign reports. */
export const SIGNATORY_ROLES: readonly StaffRole[] = ["AUTHORIZED_SIGNATORY", "LAB_DIRECTOR"];

export const hasPermission = (role: StaffRole, p: Permission): boolean => ROLE_PERMISSIONS[role].includes(p);

/** safety.lab.privileged_mfa: privileged roles need an MFA claim when enforcement is on (always in production). */
export function mfaSatisfied(role: StaffRole, amr: readonly string[] | undefined, enforced: boolean): boolean {
  if (!enforced || !PRIVILEGED_ROLES.includes(role)) return true;
  return (amr ?? []).some((m) => ["mfa", "otp", "hwk", "swk"].includes(m));
}
