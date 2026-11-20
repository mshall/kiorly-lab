/** Receivables aging (pure). Days overdue = whole days past the due date; not yet due = "current". */
export type AgeBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "d90_plus";
export const AGE_BUCKETS: AgeBucket[] = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];

export function daysOverdue(dueAt: Date, asOf: Date): number {
  return Math.floor((asOf.getTime() - dueAt.getTime()) / 86_400_000);
}
export function ageBucket(days: number): AgeBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "d1_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}
