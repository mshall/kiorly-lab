import { useTranslation } from "react-i18next";

export interface LjPoint { id: string; runAt: string; value: number; z: number; status: string; violatedRules: string[] }
export interface LjData { mean: number; sd: number; analyte: { code: string; unit: string | null }; level: string; lot: string; points: LjPoint[]; limits: Record<string, number> }

const W = 760;
const H = 320;
const PAD = { l: 56, r: 56, t: 24, b: 28 };
/** Brand semantic ramps (CSS vars so the chart follows light/dark). */
const C = { pass: "hsl(var(--success))", warn: "hsl(var(--warning))", fail: "hsl(var(--danger-text))", line: "hsl(var(--primary))", grid: "hsl(var(--border))", text: "hsl(var(--muted-foreground))", card: "hsl(var(--card))" };
const fill: Record<string, string> = { PASS: C.pass, WARNING: C.warn, FAIL: C.fail };

/** Levey-Jennings chart in SD units: zone bands (+-1/2/3 SD), series in the brand colour, rule violations marked with a ring + rule label (never colour alone). Mirrors in RTL. */
export function LeveyJenningsChart({ data }: { data: LjData }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === "rtl";
  const n = Math.max(data.points.length, 2);
  const plotL = PAD.l, plotR = W - PAD.r;
  const x = (i: number) => { const f = i / (n - 1); return rtl ? plotR - f * (plotR - plotL) : plotL + f * (plotR - plotL); };
  const y = (z: number) => PAD.t + ((4 - Math.max(-4, Math.min(4, z))) * (H - PAD.t - PAD.b)) / 8;
  const axisX = rtl ? plotR + 8 : plotL - 8;
  const valX = rtl ? plotL - 8 : plotR + 8;
  const anchorA = rtl ? "start" : "end";
  const anchorV = rtl ? "end" : "start";
  const lines = [3, 2, 1, 0, -1, -2, -3];
  const path = data.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.z)}`).join(" ");
  const band = (a: number, b: number, color: string, o: number) => <rect x={plotL} width={plotR - plotL} y={y(Math.max(a, b))} height={Math.abs(y(a) - y(b))} fill={color} opacity={o} />;
  const last = data.points[data.points.length - 1];
  const fails = data.points.filter((p) => p.status !== "PASS").length;
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${t("qc.chartLabel", { analyte: data.analyte.code, level: data.level })}. ${t("qc.chartSummary", { n: data.points.length, bad: fails })}`}>
        {band(1, -1, C.pass, 0.07)}{band(2, 1, C.warn, 0.08)}{band(-1, -2, C.warn, 0.08)}{band(3, 2, C.fail, 0.08)}{band(-2, -3, C.fail, 0.08)}
        {lines.map((z) => (
          <g key={z}>
            <line x1={plotL} x2={plotR} y1={y(z)} y2={y(z)} stroke={z === 0 ? C.pass : Math.abs(z) === 3 ? C.fail : Math.abs(z) === 2 ? C.warn : C.grid} strokeDasharray={z === 0 ? undefined : Math.abs(z) === 1 ? "2 4" : "5 4"} strokeWidth={z === 0 ? 1.5 : 1} opacity={z === 0 ? 0.9 : 0.8} />
            <text x={axisX} y={y(z) + 4} textAnchor={anchorA} fontSize="11" fontWeight={z === 0 ? 700 : 500} fill={C.text}>{z === 0 ? "x̄" : `${z > 0 ? "+" : "−"}${Math.abs(z)}s`}</text>
            <text x={valX} y={y(z) + 4} textAnchor={anchorV} fontSize="10" fill={C.text} style={{ fontVariantNumeric: "tabular-nums" }}>{(data.mean + z * data.sd).toFixed(2)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={C.line} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />
        {data.points.map((p, i) => {
          const bad = p.status !== "PASS";
          return (
            <g key={p.id} className="kx-lj-point">
              {bad && <circle cx={x(i)} cy={y(p.z)} r={9} fill="none" stroke={fill[p.status] ?? C.text} strokeWidth="1.5" />}
              <circle cx={x(i)} cy={y(p.z)} r={bad ? 5 : 3.5} fill={fill[p.status] ?? C.text} stroke={C.card} strokeWidth="1.5">
                <title>{`${new Date(p.runAt).toLocaleString(i18n.language)} · ${p.value} (z ${p.z.toFixed(2)}) · ${p.status}${p.violatedRules.length ? ` · ${p.violatedRules.join(", ")}` : ""}`}</title>
              </circle>
              {bad && p.violatedRules.length > 0 && <text x={x(i)} y={y(p.z) + (p.z >= 0 ? -14 : 20)} textAnchor="middle" fontSize="10" fontWeight="700" fill={fill[p.status]}>{p.violatedRules[0]}</text>}
            </g>
          );
        })}
        {last && <text x={x(data.points.length - 1)} y={H - 8} textAnchor={rtl ? "start" : "end"} fontSize="10" fill={C.text}>{new Date(last.runAt).toLocaleDateString(i18n.language)}</text>}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {[["PASS", C.pass, t("status.PASS")], ["WARNING", C.warn, t("status.WARNING")], ["FAIL", C.fail, t("status.FAIL")]].map(([k, c, l]) => <span key={k} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
        <span className="ms-auto tabular-nums">{data.analyte.unit ? `${data.analyte.code} · ${data.analyte.unit} · ` : ""}{data.lot}</span>
      </figcaption>
    </figure>
  );
}
