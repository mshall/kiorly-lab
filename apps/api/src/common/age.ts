/** Age in whole days at a given instant (reference intervals are keyed by age in days, KLQC03). */
export function ageInDays(dob: Date | null | undefined, at: Date): number | null {
  if (!dob) return null;
  return Math.max(0, Math.floor((at.getTime() - dob.getTime()) / 86_400_000));
}
