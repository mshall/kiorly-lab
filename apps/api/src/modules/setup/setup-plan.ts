/**
 * Quick setup (Lab), pure rules. Every step is computed from real data (never a manual tick); per-lab steps are listed per lab with their own
 * state and deep link; optional steps can be skipped (the only stored state, kept as audit events). A lab added later appears as a new pending entity.
 */
import type { StaffRole } from "../../generated/prisma/client";
import { ROLE_PERMISSIONS, type Permission } from "../../auth/rbac";

export type SetupStatus = "pending" | "done" | "skipped";
export type SetupKey = "lab_licence" | "starter_catalogue" | "signatory" | "invite_staff" | "lab_coverage" | "safety_contact" | "first_order" | "first_report" | "connect_kiorex";

export interface LabSnap { id: string; name: string; code: string; licenceNo: string | null; address: string | null; coverageDistricts: number }
export interface SetupSnapshot {
  labs: LabSnap[];
  testCount: number;
  /** AUTHORIZED_SIGNATORY / LAB_DIRECTOR with a licence number: reports cannot be signed without one. */
  signatoryLicensed: boolean;
  otherStaff: number;
  safetyContact: boolean;
  orderCount: number;
  releasedReports: number;
  connected: boolean;
}
export interface Viewer { role: StaffRole }
interface Def {
  key: SetupKey; scope: "org" | "lab"; required: boolean; perm: Permission; hideIfCannot?: boolean;
  done: (s: SetupSnapshot, l?: LabSnap) => boolean; href: (labId?: string) => string;
}
const q = (path: string, key: string, entity?: string) => `${path}${path.includes("?") ? "&" : "?"}setup=${key}${entity ? `&entity=${entity}` : ""}`;

export const SETUP_DEFS: Def[] = [
  { key: "lab_licence", scope: "lab", required: true, perm: "settings.manage", done: (_s, l) => Boolean(l?.licenceNo?.trim() && l?.address?.trim()), href: (id) => q("/settings?tab=labs", "lab_licence", id) },
  { key: "starter_catalogue", scope: "org", required: true, perm: "catalogue.write", done: (s) => s.testCount > 0, href: () => q("/settings?tab=general", "starter_catalogue") },
  { key: "signatory", scope: "org", required: true, perm: "staff.manage", done: (s) => s.signatoryLicensed, href: () => q("/settings?tab=staff", "signatory") },
  { key: "invite_staff", scope: "org", required: false, perm: "staff.manage", done: (s) => s.otherStaff > 0, href: () => q("/settings?tab=staff", "invite_staff") },
  { key: "lab_coverage", scope: "lab", required: false, perm: "settings.manage", done: (_s, l) => (l?.coverageDistricts ?? 0) > 0, href: (id) => q("/settings?tab=labs", "lab_coverage", id) },
  { key: "safety_contact", scope: "org", required: false, perm: "settings.manage", done: (s) => s.safetyContact, href: () => q("/settings?tab=general", "safety_contact") },
  { key: "first_order", scope: "org", required: true, perm: "orders.create", done: (s) => s.orderCount > 0, href: () => q("/orders", "first_order") },
  { key: "first_report", scope: "org", required: true, perm: "reports.release", done: (s) => s.releasedReports > 0, href: () => q("/release", "first_report") },
  { key: "connect_kiorex", scope: "org", required: false, perm: "settings.manage", hideIfCannot: true, done: (s) => s.connected, href: () => q("/kiorex-connect", "connect_kiorex") },
];

export interface EntityDto { id: string; name: string; code: string; status: SetupStatus; href: string }
export interface StepDto {
  key: SetupKey; order: number; required: boolean; manual: false; scope: "org" | "lab"; status: SetupStatus; href: string;
  whoCan: StaffRole[]; canPerform: boolean; available: boolean; entities: EntityDto[] | null; doneCount: number; totalCount: number;
}
export interface PlanDto {
  steps: StepDto[]; progressPercent: number; overallPercent: number; doneUnits: number; totalUnits: number; allDone: boolean;
  nextKey: SetupKey | null; nextHref: string | null; dismissedAt: string | null;
}

export const skipKey = (key: string, entity?: string | null) => (entity ? `${key}@${entity}` : key);
export const rolesWith = (perm: Permission): StaffRole[] => (Object.keys(ROLE_PERMISSIONS) as StaffRole[]).filter((r) => ROLE_PERMISSIONS[r].includes(perm));

export function buildPlan(snap: SetupSnapshot, skipped: Record<string, string>, viewer: Viewer, dismissedAt: string | null = null): PlanDto {
  const steps: StepDto[] = [];
  let order = 0;
  for (const d of SETUP_DEFS) {
    const canPerform = ROLE_PERMISSIONS[viewer.role].includes(d.perm);
    if (d.hideIfCannot && !canPerform) continue;
    order += 1;
    let entities: EntityDto[] | null = null;
    let status: SetupStatus; let href: string; let doneCount: number; let totalCount: number;
    if (d.scope === "lab") {
      entities = snap.labs.map((l) => {
        const done = d.done(snap, l);
        const sk = !done && !d.required && skipped[skipKey(d.key, l.id)] === "skipped";
        return { id: l.id, name: l.name, code: l.code, status: done ? "done" : sk ? "skipped" : "pending", href: d.href(l.id) } as EntityDto;
      });
      totalCount = entities.length; doneCount = entities.filter((e) => e.status !== "pending").length;
      const first = entities.find((e) => e.status === "pending");
      status = totalCount === 0 ? "pending" : first ? "pending" : entities.every((e) => e.status === "skipped") ? "skipped" : "done";
      href = (first ?? entities[0])?.href ?? d.href();
    } else {
      const done = d.done(snap);
      const sk = !done && !d.required && skipped[d.key] === "skipped";
      status = done ? "done" : sk ? "skipped" : "pending"; totalCount = 1; doneCount = status === "pending" ? 0 : 1; href = d.href();
    }
    steps.push({ key: d.key, order, required: d.required, manual: false, scope: d.scope, status, href, whoCan: rolesWith(d.perm), canPerform, available: true, entities, doneCount, totalCount });
  }
  const units = (s: StepDto) => Math.max(s.totalCount, 1);
  const req = steps.filter((s) => s.required);
  const reqTotal = req.reduce((a, s) => a + units(s), 0), reqDone = req.reduce((a, s) => a + s.doneCount, 0);
  const total = steps.reduce((a, s) => a + units(s), 0), done = steps.reduce((a, s) => a + s.doneCount, 0);
  const next = steps.find((s) => s.status === "pending") ?? null;
  const allDone = total > 0 && done === total;
  return {
    steps, progressPercent: reqTotal ? Math.round((reqDone / reqTotal) * 100) : 100, overallPercent: total ? Math.round((done / total) * 100) : 100,
    doneUnits: done, totalUnits: total, allDone, nextKey: next?.key ?? null, nextHref: next?.href ?? null, dismissedAt: allDone ? dismissedAt : null,
  };
}
