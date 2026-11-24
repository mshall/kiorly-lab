import type { StaffRole } from "../../generated/prisma/client";

/**
 * Growth workspace permissions for Kiorly Lab (GRW-P4-B1, PROPOSED_DEFAULT: the role matrix is a founder decision, see Docs/GROWTH.md). No doctor scope.
 *  - admin  (OWNER, LAB_DIRECTOR, BRANCH_MANAGER): create, pause, resume, revoke; QR and posters; performance.
 *  - read   (RECEPTION, SUPERVISOR, AUTHORIZED_SIGNATORY, FINANCE): view links, counts, QR and the reception desk card (the desk prints its own card).
 *  - none   (TECHNOLOGIST, PHLEBOTOMIST): bench roles have no Growth module (403 GROWTH_FORBIDDEN).
 * A site-scoped user (StaffUser.labIds not empty) only sees org-wide links and links of their own labs, and can change only links of their own labs.
 */
const ADMIN = new Set<StaffRole>(["OWNER", "LAB_DIRECTOR", "BRANCH_MANAGER"]);
const READ = new Set<StaffRole>(["RECEPTION", "SUPERVISOR", "AUTHORIZED_SIGNATORY", "FINANCE"]);

export type GrowthLevel = "admin" | "read" | "none";
export const growthLevel = (role: StaffRole): GrowthLevel => (ADMIN.has(role) ? "admin" : READ.has(role) ? "read" : "none");

export type GrowthAction = "view" | "create" | "update" | "revoke";
const MATRIX: Record<GrowthLevel, ReadonlySet<GrowthAction>> = {
  admin: new Set(["view", "create", "update", "revoke"]),
  read: new Set(["view"]),
  none: new Set(),
};
export const canGrowth = (role: StaffRole, action: GrowthAction): boolean => MATRIX[growthLevel(role)].has(action);
