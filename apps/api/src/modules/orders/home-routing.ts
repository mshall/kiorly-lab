export interface GeoPoint {
  lat: number;
  lng: number;
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest-neighbour route from the lab (simple, deterministic; a real maps provider is a go-live adapter). Stops without geo go last in input order. */
export function nearestNeighbourRoute<T extends { id: string; geo?: GeoPoint | null }>(start: GeoPoint, stops: T[]): T[] {
  const withGeo = stops.filter((s) => s.geo);
  const without = stops.filter((s) => !s.geo);
  const out: T[] = [];
  let cur = start;
  const left = [...withGeo];
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (haversineKm(cur, left[i].geo!) < haversineKm(cur, left[bi].geo!)) bi = i;
    const [next] = left.splice(bi, 1);
    out.push(next);
    cur = next.geo!;
  }
  return [...out, ...without];
}

/** Default slot grid for a day (NEEDS_HUMAN NH-LB-011: operating hours/capacity). */
export function defaultSlotsFor(day: Date, opts: { startHour?: number; endHour?: number; lengthMinutes?: number } = {}): { startsAt: Date; endsAt: Date }[] {
  const startHour = opts.startHour ?? 8;
  const endHour = opts.endHour ?? 18;
  const len = opts.lengthMinutes ?? 60;
  const base = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), startHour, 0, 0));
  const out: { startsAt: Date; endsAt: Date }[] = [];
  for (let t = base.getTime(); t + len * 60_000 <= base.getTime() + (endHour - startHour) * 3_600_000; t += len * 60_000) out.push({ startsAt: new Date(t), endsAt: new Date(t + len * 60_000) });
  return out;
}
