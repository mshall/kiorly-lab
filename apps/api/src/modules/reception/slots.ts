/** Appointment slot arithmetic (pure, UTC). */
export interface SlotConfig { openingHour: number; closingHour: number; slotMinutes: number; capacity: number }

export function dayStartUtc(date: string): Date {
  const d = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new RangeError("invalid date");
  return d;
}

/** Slot grid for a date: [{startsAt, endsAt}]. */
export function slotGrid(date: string, c: SlotConfig): { startsAt: Date; endsAt: Date }[] {
  const out: { startsAt: Date; endsAt: Date }[] = [];
  const day = dayStartUtc(date).getTime();
  for (let m = c.openingHour * 60; m + c.slotMinutes <= c.closingHour * 60; m += c.slotMinutes) out.push({ startsAt: new Date(day + m * 60_000), endsAt: new Date(day + (m + c.slotMinutes) * 60_000) });
  return out;
}

/** The grid slot containing `at` (or null when outside opening hours). */
export function slotFor(at: Date, c: SlotConfig): { startsAt: Date; endsAt: Date } | null {
  const date = at.toISOString().slice(0, 10);
  return slotGrid(date, c).find((s) => at >= s.startsAt && at < s.endsAt) ?? null;
}

/** Queue lane ordering: STAT, URGENT, then first come first served. */
export const laneRank = (p: string) => (p === "STAT" ? 0 : p === "URGENT" ? 1 : 2);
export const ticketPrefix = (priority: string) => (priority === "ROUTINE" ? "A" : "S");
