import { ROLE_PERMISSIONS, SIGNATORY_ROLES, type Permission } from "../../auth/rbac";
import type { StaffRole } from "../../generated/prisma/client";

/** Kiorly Work module catalogue (role gating by permission). Shared by bootstrap and the upgrade-request feature-key validation. */
export interface ModuleDef { key: string; anyOf: Permission[]; screens: { name: string; perm?: Permission }[] }
export const MODULES: ModuleDef[] = [
  { key: "lab.phlebotomy", anyOf: ["specimens.collect"], screens: [{ name: "scan" }, { name: "custody" }, { name: "round", perm: "collection.perform" }, { name: "safety", perm: "collection.perform" }] },
  { key: "lab.accession", anyOf: ["specimens.label", "specimens.receive"], screens: [{ name: "scan" }, { name: "labels", perm: "specimens.label" }, { name: "receive", perm: "specimens.receive" }] },
  { key: "lab.critical", anyOf: ["critical.read"], screens: [{ name: "inbox" }, { name: "acknowledge", perm: "critical.ack" }, { name: "escalations" }] },
  { key: "lab.validation", anyOf: ["results.tech_validate", "results.medical_validate"], screens: [{ name: "queue" }, { name: "review" }, { name: "tech-validate", perm: "results.tech_validate" }, { name: "sign-off", perm: "results.medical_validate" }] },
  { key: "lab.worklist", anyOf: ["results.read"], screens: [{ name: "progress" }, { name: "specimens" }] },
  { key: "lab.qc", anyOf: ["qc.read"], screens: [{ name: "status" }, { name: "blocks" }, { name: "levey-jennings" }] },
  { key: "lab.tat", anyOf: ["dashboard.read"], screens: [{ name: "summary" }, { name: "breaches" }] },
  { key: "lab.orders", anyOf: ["orders.read"], screens: [{ name: "today" }, { name: "detail" }, { name: "search" }] },
  { key: "lab.reagents", anyOf: ["inventory.read"], screens: [{ name: "low-stock" }, { name: "expiring" }] },
];

/**
 * Modules + screens a staff member gets in the app. Enabled by permission; the `sign-off` screen additionally needs what the API enforces for medical
 * validation and report signing (SIGNATORY_ROLES + a recorded licence number, results.service/reports.service `NOT_AUTHORIZED_SIGNATORY`): the OWNER holds
 * results.medical_validate in the permission table but is refused by the server, so the app must not offer it.
 */
export function modulesForRole(role: StaffRole, signatoryLicenceNo?: string | null) {
  const perms = ROLE_PERMISSIONS[role];
  const mayAttest = SIGNATORY_ROLES.includes(role) && Boolean(signatoryLicenceNo);
  return MODULES.map((m) => {
    const enabled = m.anyOf.some((p) => perms.includes(p));
    return { key: m.key, enabled, screens: enabled ? m.screens.filter((s) => (!s.perm || perms.includes(s.perm)) && (s.name !== "sign-off" || mayAttest)).map((s) => s.name) : [] };
  });
}
