import { useTranslation } from "react-i18next";

export interface LjPoint { id: string; runAt: string; value: number; z: number; status: string; violatedRules: string[] }
export interface LjData { mean: number; sd: number; analyte: { code: string; unit: string | null }; level: string; lot: string; points: LjPoint[]; limits: Record<string, number> }

const W = 760;
const H = 300;
const PAD = { l: 52, r: 16, t: 16, b: 28 };
const COLOR: Record<string, string> = { PASS: "#059669", WARNING: "#D97706", FAIL: "#DC2626" };

/** Levey-Jennings chart in SD units (+-1/2/3 SD lines). Rejection points are red and list the violated Westgard rules in their tooltip. */
export function LeveyJenningsChart({ data }: { data: LjData }) {
  const { t } = useTranslation();
  const n = Math.max(data.points.length, 2);
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (n - 1);
  const y = (z: number) => PAD.t + ((4 - Math.max(-4, Math.min(4, z))) * (H - PAD.t - PAD.b)) / 8;
  const lines = [3, 2, 1, 0, -1, -2, -3];
  const path = data.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.z)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("qc.chartLabel", { analyte: data.analyte.code, level: data.level })}>
      {lines.map((z) => (
        <g key={z}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(z)} y2={y(z)} stroke={z === 0 ? "#059669" : Math.abs(z) === 3 ? "#DC2626" : Math.abs(z) === 2 ? "#D97706" : "#94A3B8"} strokeDasharray={z === 0 ? undefined : "4 4"} strokeWidth={z === 0 ? 1.5 : 1} />
          <text x={PAD.l - 6} y={y(z) + 4} textAnchor="end" fontSize="11" fill="currentColor">{z === 0 ? "x̄" : `${z > 0 ? "+" : ""}${z}s`}</text>
          <text x={W - PAD.r} y={y(z) - 3} textAnchor="end" fontSize="9" fill="#64748B">{(data.mean + z * data.sd).toFixed(2)}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#3B82F6" strokeWidth="1.5" />
      {data.points.map((p, i) => (
        <circle key={p.id} cx={x(i)} cy={y(p.z)} r={p.status === "PASS" ? 3.5 : 5.5} fill={COLOR[p.status] ?? "#64748B"} stroke="#fff" strokeWidth="1">
          <title>{`${new Date(p.runAt).toLocaleString()} · ${p.value} (z ${p.z.toFixed(2)}) · ${p.status}${p.violatedRules.length ? ` · ${p.violatedRules.join(", ")}` : ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}
