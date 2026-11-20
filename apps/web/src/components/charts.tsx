import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Brand chart palette (CSS vars so charts follow light/dark). */
const C = { line: "hsl(var(--primary))", ok: "hsl(var(--success))", warn: "hsl(var(--warning))", crit: "hsl(var(--danger-text))", grid: "hsl(var(--border))", text: "hsl(var(--muted-foreground))", card: "hsl(var(--card))", ocean: "#0369A1", coral: "#E8735E" };
export const SERIES = [C.line, C.ocean, C.coral, "#7C3AED", "#0F766E", "#B45309"];
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(Math.round(n * 100) / 100));

export interface TrendPoint { at: string; value: number; flag?: string; label?: string }

/** Result trend line with the reference band, flagged points ringed (never colour alone: abnormal points are squares). Mirrors in RTL (time runs right to left). */
export function TrendChart({ points, low, high, unit, label, height = 190 }: { points: TrendPoint[]; low?: number | null; high?: number | null; unit?: string | null; label: string; height?: number }) {
  const { i18n, t } = useTranslation();
  const rtl = i18n.dir() === "rtl";
  const W = 560, H = height, P = { l: 46, r: 14, t: 14, b: 26 };
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals, low ?? Infinity), hi = Math.max(...vals, high ?? -Infinity);
  const pad = (hi - lo || 1) * 0.12;
  const y0 = lo - pad, y1 = hi + pad;
  const X = (i: number) => { const f = points.length === 1 ? 0.5 : i / (points.length - 1); return rtl ? W - P.r - f * (W - P.l - P.r) : P.l + f * (W - P.l - P.r); };
  const Y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p.value)}`).join(" ");
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  const date = (s: string) => new Intl.DateTimeFormat(i18n.language === "ar" ? "ar-EG" : "en-GB", { day: "2-digit", month: "short" }).format(new Date(s));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ direction: "ltr" }} role="img" aria-label={`${label}. ${t("pat.trendSummary", { n: points.length, last: fmt(vals.at(-1) ?? 0), unit: unit ?? "" })}`}>
      {low != null && high != null ? <rect x={P.l} width={W - P.l - P.r} y={Y(high)} height={Math.max(2, Y(low) - Y(high))} fill={C.ok} opacity={0.12} /> : null}
      {ticks.map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke={C.grid} strokeDasharray="3 4" /><text x={rtl ? W - P.r + 2 : P.l - 6} y={Y(v) + 4} textAnchor={rtl ? "start" : "end"} fontSize="10" fill={C.text}>{fmt(v)}</text></g>)}
      <path d={path} fill="none" stroke={C.line} strokeWidth={2} strokeLinejoin="round" />
      {points.map((p, i) => {
        const bad = p.flag && p.flag !== "NORMAL";
        const crit = p.flag?.startsWith("CRITICAL");
        return (
          <g key={i}>
            {bad ? <rect x={X(i) - 4.5} y={Y(p.value) - 4.5} width={9} height={9} fill={crit ? C.crit : C.warn} stroke={C.card} strokeWidth={1.5} /> : <circle cx={X(i)} cy={Y(p.value)} r={3.5} fill={C.line} stroke={C.card} strokeWidth={1.5} />}
            <title>{`${date(p.at)}: ${fmt(p.value)} ${unit ?? ""}${bad ? ` (${p.flag})` : ""}`}</title>
            {points.length <= 9 || i % Math.ceil(points.length / 8) === 0 ? <text x={X(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={C.text}>{date(p.at)}</text> : null}
            {i === points.length - 1 ? <text x={X(i)} y={Y(p.value) - 9} textAnchor="middle" fontSize="11" fontWeight={700} fill={bad ? (crit ? C.crit : C.warn) : C.line}>{fmt(p.value)}</text> : null}
          </g>
        );
      })}
    </svg>
  );
}

export interface BarDatum { label: string; values: number[] }
/** Horizontal bar chart (labels are readable in AR and EN); multi-series bars are grouped. */
export function BarChart({ data, series, label }: { data: BarDatum[]; series: string[]; label: string }) {
  const id = useId();
  const max = Math.max(1, ...data.flatMap((d) => d.values));
  const rows = data.slice(0, 14);
  return (
    <div role="img" aria-label={label} className="space-y-2">
      {series.length > 1 ? <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">{series.map((s, i) => <span key={s} className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />{s}</span>)}</div> : null}
      {rows.map((d, r) => (
        <div key={`${id}${r}`} className="grid grid-cols-[minmax(6rem,11rem)_1fr] items-center gap-3 text-xs">
          <span className="truncate text-end text-muted-foreground rtl:text-start" title={d.label} dir="auto">{d.label}</span>
          <div className="space-y-1">
            {d.values.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="h-3 rounded-sm" style={{ width: `${Math.max(1.5, (v / max) * 100)}%`, background: SERIES[i % SERIES.length] }} />
                <span className="tabular-nums text-[11px] font-medium">{fmt(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Donut with a legend (label + value + share), for compositions (sources, payment methods, rejection reasons). */
export function Donut({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const R = 52, r = 32, cx = 60, cy = 60;
  let a0 = -Math.PI / 2;
  const arcs: ReactNode[] = [];
  for (const [i, d] of data.slice(0, 8).entries()) {
    const a1 = a0 + (d.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const full = d.value / total > 0.999;
    const path = full ? `M${cx - R},${cy} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${cx - r},${cy} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0` : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
    a0 = a1;
    arcs.push(<path key={i} d={path} fill={SERIES[i % SERIES.length]} fillRule="evenodd" stroke={C.card} strokeWidth={1.5} />);
  }
  return (
    <div className="flex flex-wrap items-center gap-5" role="img" aria-label={label}>
      <svg viewBox="0 0 120 120" className="size-32 shrink-0">{arcs}<text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fontWeight={700} fill="hsl(var(--foreground))">{fmt(total)}</text></svg>
      <ul className="min-w-[10rem] flex-1 space-y-1 text-xs">
        {data.slice(0, 8).map((d, i) => <li key={d.label} className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} /><span dir="auto">{d.label}</span></span><span className="tabular-nums text-muted-foreground">{fmt(d.value)} · {Math.round((d.value / total) * 100)}%</span></li>)}
      </ul>
    </div>
  );
}

/** Tiny sparkline for tables/cards. */
export function Spark({ values, w = 80, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const d = values.map((v, i) => `${i ? "L" : "M"}${(i / (values.length - 1)) * (w - 2) + 1},${h - 2 - ((v - lo) / span) * (h - 4)}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ direction: "ltr" }} aria-hidden><path d={d} fill="none" stroke={C.line} strokeWidth={1.5} /></svg>;
}
