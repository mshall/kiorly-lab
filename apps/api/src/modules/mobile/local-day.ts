/** UTC offset (ms) of an IANA zone at an instant, from Intl parts (DST-correct). */
function offsetMs(at: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of 00:00 (wall clock) of the day that `now` falls in, in `timeZone`. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const off = offsetMs(now, timeZone);
  const local = new Date(now.getTime() + off);
  const midnightLocalAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let guess = midnightLocalAsUtc - off;
  const off2 = offsetMs(new Date(guess), timeZone); // DST change between midnight and now
  if (off2 !== off) guess = midnightLocalAsUtc - off2;
  return new Date(guess);
}
