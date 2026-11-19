/**
 * Westgard multirule QC evaluation (KLQC02). Pure and deterministic.
 * Rejection rules (block patient release): 1_3s, 2_2s, R_4s, 4_1s, 10x. Warning rule: 1_2s.
 * The exact rule set / warning-vs-rejection policy still needs pathologist sign-off (NH-LB-005); this implements the PRD list.
 */
export type WestgardRule = "1_2s" | "1_3s" | "2_2s" | "R_4s" | "4_1s" | "10x";
export const REJECTION_RULES: readonly WestgardRule[] = ["1_3s", "2_2s", "R_4s", "4_1s", "10x"];

export interface WestgardInput {
  /** z-scores of the SAME control level, oldest -> newest, INCLUDING the current observation as the last element. */
  history: number[];
  /** z-scores of other control levels measured in the same run (for cross-level 2_2s and R_4s). */
  sameRunOthers?: number[];
}
export interface WestgardResult {
  status: "PASS" | "WARNING" | "FAIL";
  violated: WestgardRule[];
  warnings: WestgardRule[];
}

export const zScore = (value: number, mean: number, sd: number): number => (value - mean) / sd;

const sign = (z: number) => (z > 0 ? 1 : z < 0 ? -1 : 0);

export function evaluateWestgard({ history, sameRunOthers = [] }: WestgardInput): WestgardResult {
  const violated: WestgardRule[] = [];
  const warnings: WestgardRule[] = [];
  if (history.length === 0) return { status: "PASS", violated, warnings };
  const cur = history[history.length - 1];
  const prev = history.length > 1 ? history[history.length - 2] : undefined;

  if (Math.abs(cur) > 3) violated.push("1_3s");
  else if (Math.abs(cur) > 2) warnings.push("1_2s");

  // 2_2s: two consecutive observations beyond 2s on the same side (same level), or across levels in the same run.
  const twoTwo = (a: number, b: number) => Math.abs(a) > 2 && Math.abs(b) > 2 && sign(a) === sign(b);
  if ((prev !== undefined && twoTwo(prev, cur)) || sameRunOthers.some((o) => twoTwo(o, cur))) violated.push("2_2s");

  // R_4s: one observation > +2s and another < -2s (range > 4s) within a run (across levels) or consecutively on one level.
  const r4 = (a: number, b: number) => (a > 2 && b < -2) || (a < -2 && b > 2);
  if ((prev !== undefined && r4(prev, cur) && Math.abs(cur - prev) > 4) || sameRunOthers.some((o) => r4(o, cur) && Math.abs(cur - o) > 4)) violated.push("R_4s");

  // 4_1s: four consecutive observations beyond 1s on the same side.
  if (history.length >= 4) {
    const last4 = history.slice(-4);
    if (last4.every((z) => z > 1) || last4.every((z) => z < -1)) violated.push("4_1s");
  }
  // 10x: ten consecutive observations on the same side of the mean.
  if (history.length >= 10) {
    const last10 = history.slice(-10);
    if (last10.every((z) => z > 0) || last10.every((z) => z < 0)) violated.push("10x");
  }
  const status = violated.length ? "FAIL" : warnings.length ? "WARNING" : "PASS";
  return { status, violated, warnings };
}
