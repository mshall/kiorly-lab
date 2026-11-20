import type { ResultFlag } from "../generated/prisma/client";

export interface IntervalLike {
  low: number | null;
  high: number | null;
}
export interface CriticalLike {
  criticalLow: number | null;
  criticalHigh: number | null;
}

/** Classifies a numeric result against the reference interval and critical limits (strict inequalities at the bounds). */
export function classifyResult(value: number, interval: IntervalLike | null, critical: CriticalLike | null): ResultFlag {
  if (critical?.criticalLow != null && value < critical.criticalLow) return "CRITICAL_LOW";
  if (critical?.criticalHigh != null && value > critical.criticalHigh) return "CRITICAL_HIGH";
  if (interval?.low != null && value < interval.low) return "LOW";
  if (interval?.high != null && value > interval.high) return "HIGH";
  return "NORMAL";
}

export const isCriticalFlag = (f: ResultFlag): boolean => f === "CRITICAL_LOW" || f === "CRITICAL_HIGH";

/** Delta check: percent change relative to the prior value; null when not computable. */
export function deltaPercent(current: number, prior: number | null | undefined): number | null {
  if (prior == null || prior === 0) return null;
  return Math.round(((current - prior) / Math.abs(prior)) * 10000) / 100;
}

export interface IntervalCandidate {
  sex: string | null;
  ageMinDays: number;
  ageMaxDays: number | null;
  version: number;
  condition?: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

/** Picks the reference interval that applies: effective at `at`, matching age, sex-specific before sex-neutral, newest version first. */
export function pickInterval<T extends IntervalCandidate>(cands: T[], sex: string, ageDays: number | null, at: Date, conditions: readonly string[] = []): T | null {
  const ok = cands.filter(
    (c) =>
      c.effectiveFrom <= at &&
      (c.effectiveTo == null || c.effectiveTo > at) &&
      (ageDays == null || (ageDays >= c.ageMinDays && (c.ageMaxDays == null || ageDays <= c.ageMaxDays))) &&
      (c.sex == null || c.sex === sex) &&
      (c.condition == null || conditions.includes(c.condition)),
  );
  // condition-specific intervals win over general ones, then sex-specific over sex-neutral, then newest version
  ok.sort((a, b) => Number(b.condition != null) - Number(a.condition != null) || Number(b.sex === sex) - Number(a.sex === sex) || b.version - a.version);
  return ok[0] ?? null;
}
