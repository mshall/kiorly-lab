/** Small pure statistics helpers for the report engine. */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round((sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo)) * 10) / 10;
}
export const median = (xs: number[]) => percentile([...xs].sort((a, b) => a - b), 50);
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Age band label for demographics (years). */
export function ageBand(years: number | null): string {
  if (years == null) return "Unknown";
  if (years < 1) return "<1";
  if (years < 5) return "1-4";
  if (years < 15) return "5-14";
  if (years < 25) return "15-24";
  if (years < 45) return "25-44";
  if (years < 65) return "45-64";
  return "65+";
}
export const AGE_BANDS = ["<1", "1-4", "5-14", "15-24", "25-44", "45-64", "65+", "Unknown"];

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
