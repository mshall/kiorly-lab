/** Pure quality-management helpers. */
export type EqaStatusT = "ACCEPTABLE" | "WARNING" | "UNACCEPTABLE";

/** EQA z-score against the peer-group SD; rounded to 3 decimals. */
export function eqaZ(reported: number, assigned: number, groupSd: number): number {
  if (!(groupSd > 0)) throw new RangeError("group SD must be positive");
  return Math.round(((reported - assigned) / groupSd) * 1000) / 1000;
}
/** |z| <= 2 acceptable, 2 < |z| < 3 warning, |z| >= 3 unacceptable (ISO 13528 convention). */
export const eqaStatus = (z: number): EqaStatusT => (Math.abs(z) >= 3 ? "UNACCEPTABLE" : Math.abs(z) > 2 ? "WARNING" : "ACCEPTABLE");

export type LotState = "OK" | "EXPIRING_SOON" | "EXPIRED";
export function lotState(expiresAt: Date | null, now = new Date(), soonDays = 30): LotState {
  if (!expiresAt) return "OK";
  const end = expiresAt.getTime() + 86_400_000; // valid through the whole expiry day
  if (end <= now.getTime()) return "EXPIRED";
  return end - now.getTime() <= soonDays * 86_400_000 ? "EXPIRING_SOON" : "OK";
}

/** Mean, sample SD, CV% of QC values. */
export function qcStats(values: number[]): { n: number; mean: number | null; sd: number | null; cv: number | null } {
  const n = values.length;
  if (!n) return { n, mean: null, sd: null, cv: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const r = (x: number) => Math.round(x * 10000) / 10000;
  return { n, mean: r(mean), sd: r(sd), cv: mean !== 0 ? Math.round((sd / Math.abs(mean)) * 10000) / 100 : null };
}

export const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

/** NCR workflow: which statuses may follow which. */
export const NCR_NEXT: Record<string, string[]> = { OPEN: ["INVESTIGATING"], INVESTIGATING: ["ACTION"], ACTION: ["VERIFIED"], VERIFIED: ["CLOSED"], CLOSED: [] };

/** Document version workflow. */
export const DOC_NEXT: Record<string, string[]> = { DRAFT: ["IN_REVIEW"], IN_REVIEW: ["APPROVED", "DRAFT"], APPROVED: ["SUPERSEDED"], SUPERSEDED: [] };
