export const money = (n: number | string | null | undefined, cur = "EGP", lang = "en") =>
  n == null ? "-" : new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-EG", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(Number(n));

export const dt = (v: string | Date | null | undefined, lang = "en") =>
  v ? new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(v)) : "-";

export const dOnly = (v: string | Date | null | undefined, lang = "en") => (v ? new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(new Date(v)) : "-");

export const num = (v: unknown, digits = 2): string => (v == null || v === "" ? "-" : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits }));

/** Result flag -> tone. */
export function flagTone(f: string | undefined): "ok" | "warn" | "crit" | "muted" {
  if (!f || f === "NORMAL") return "ok";
  if (f.startsWith("CRITICAL")) return "crit";
  return "warn";
}
export const flagShort = (f: string | undefined) => ({ NORMAL: "", LOW: "L", HIGH: "H", CRITICAL_LOW: "LL", CRITICAL_HIGH: "HH", ABNORMAL: "A" })[f ?? ""] ?? "";

export const today = () => new Date().toISOString().slice(0, 10);
