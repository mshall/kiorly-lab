export type TatStatus = "DONE_ON_TIME" | "DONE_LATE" | "OK" | "AT_RISK" | "BREACHED" | "NO_TARGET";

/** TAT classification for an order item (KLBIZ02). AT_RISK from 80% of the target elapsed. */
export function classifyTat(input: { startedAt: Date; targetMinutes: number | null; releasedAt: Date | null; now: Date }): { status: TatStatus; elapsedMinutes: number; percent: number | null } {
  const end = input.releasedAt ?? input.now;
  const elapsed = Math.max(0, Math.round((end.getTime() - input.startedAt.getTime()) / 60_000));
  if (!input.targetMinutes) return { status: "NO_TARGET", elapsedMinutes: elapsed, percent: null };
  const percent = Math.round((elapsed / input.targetMinutes) * 100);
  if (input.releasedAt) return { status: elapsed <= input.targetMinutes ? "DONE_ON_TIME" : "DONE_LATE", elapsedMinutes: elapsed, percent };
  return { status: elapsed > input.targetMinutes ? "BREACHED" : percent >= 80 ? "AT_RISK" : "OK", elapsedMinutes: elapsed, percent };
}
