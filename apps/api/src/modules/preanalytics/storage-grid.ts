/** Storage grid helpers (pure): slots are "<row letter><column>" e.g. A1..H12. */
export const slotLabel = (row: number, col: number): string => `${String.fromCharCode(65 + row)}${col + 1}`;

/** Parses "B7" -> {row:1,col:6}; null when malformed or outside the grid. */
export function parseSlot(slot: string, rows: number, cols: number): { row: number; col: number } | null {
  const m = /^([A-Z])(\d{1,3})$/.exec(slot.trim().toUpperCase());
  if (!m) return null;
  const row = m[1]!.charCodeAt(0) - 65;
  const col = Number(m[2]) - 1;
  return row >= 0 && row < rows && col >= 0 && col < cols ? { row, col } : null;
}

/** First free slot scanning row by row; null when the unit is full. */
export function firstFreeSlot(rows: number, cols: number, taken: ReadonlySet<string>): string | null {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const s = slotLabel(r, c); if (!taken.has(s)) return s; }
  return null;
}

/** Retention end = stored/received date + days. */
export const retentionEnd = (from: Date, days: number): Date => new Date(from.getTime() + days * 86_400_000);

/** Manifest status transitions. */
export const MANIFEST_NEXT: Record<string, string[]> = {
  DRAFT: ["DISPATCHED", "CANCELLED"], DISPATCHED: ["IN_TRANSIT", "DELIVERED", "CANCELLED"], IN_TRANSIT: ["DELIVERED"], DELIVERED: ["RECEIVED"], RECEIVED: [], CANCELLED: [],
};
/** Courier event -> manifest status it implies (null = timeline note only). */
export const EVENT_STATUS: Record<string, string | null> = { PICKED_UP: "IN_TRANSIT", IN_TRANSIT: "IN_TRANSIT", DELAYED: null, DELIVERED: "DELIVERED", NOTE: null };
