import type { Edition } from "../generated/prisma/client";
import { EDITION_CAPABILITIES } from "../kernel-adapter/local-kernel";
import type { PlanShape } from "./subscription-policy";

/**
 * Edition definitions for the comparison table: capabilities come from the kernel seam (KX-07 section 02). Limits (users, labs) are NOT decided
 * for Lab (NEEDS_HUMAN LG-SUB-6), so they are `null` (not limited) and nothing is enforced or promised beyond the capabilities.
 */
export const EDITION_ORDER: Edition[] = ["LITE", "PRO", "CHAIN"];
export const planShape = (e: Edition): PlanShape => ({ edition: e, maxUsers: null, maxBranches: null, capabilities: [...EDITION_CAPABILITIES[e]] });
export const listPlanShapes = (): PlanShape[] => EDITION_ORDER.map(planShape);
