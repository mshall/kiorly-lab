import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { api, download } from "@/lib/api";
import { money, num, today } from "@/lib/format";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input, Select, Table, Td } from "@/components/ui";
import { BarChart, Donut, TrendChart } from "@/components/charts";
import { EmptyState, Skeleton, Surface } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

const GROUPS = ["operations", "clinical", "quality", "finance", "inventory"];

/** M9 analytics: the report library (20+ reports) with period/branch filters, chart, table, CSV and PDF export. */
export function AnalyticsPage() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const ar = i18n.language === "ar";
  const [kind, setKind] = useState("volume-by-day");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [labId, setLabId] = useState("");
  const list = useQuery({ queryKey: ["analytics-list"], queryFn: () => api<any[]>("/analytics/reports") });
  const qs = `from=${from}&to=${to}${labId ? `&labId=${labId}` : ""}`;
  const rep = useQuery({ queryKey: ["analytics", kind, from, to, labId], queryFn: () => api<any>(`/analytics/reports/${kind}?${qs}`), enabled: Boolean(list.data?.some((r) => r.kind === kind)) });
  const r = rep.data;
  const cell = (c: any, v: unknown) => (v == null || v === "" ? "" : c.type === "money" ? money(v as number, me?.tenant.currency, i18n.language) : c.type === "percent" ? `${v}%` : c.type === "number" ? num(v) : c.type === "date" ? String(v).slice(0, 10) : String(v));
  const chart = r?.chart && r.rows.length ? (
    r.chart.type === "line" && r.rows.length > 1 ? <TrendChart label={ar ? r.titleAr : r.title} points={r.rows.map((x: any) => ({ at: String(x[r.chart.x]), value: Number(x[r.chart.y[0]]) || 0 }))} height={220} />
      : r.chart.type === "pie" ? <Donut label={ar ? r.titleAr : r.title} data={r.rows.map((x: any) => ({ label: String(x[r.chart.x]), value: Number(x[r.chart.y[0]]) || 0 }))} />
      : <BarChart label={ar ? r.titleAr : r.title} series={r.chart.y.map((k: string) => ar ? r.columns.find((c: any) => c.key === k)?.labelAr : r.columns.find((c: any) => c.key === k)?.label)} data={r.rows.map((x: any) => ({ label: String(x[r.chart.x]), values: r.chart.y.map((k: string) => Number(x[k]) || 0) }))} />
  ) : null;
  return (
    <>
      <PageHeader title={t("ana.title")} sub={t("ana.sub", { n: list.data?.length ?? 0 })} />
      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Surface className="max-h-[78vh] overflow-auto p-2">
          {GROUPS.map((g) => { const items = (list.data ?? []).filter((x) => x.group === g); return items.length ? <div key={g} className="mb-2"><div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground rtl:normal-case">{t(`ana.groups.${g}`)}</div>{items.map((x) => <button key={x.kind} type="button" aria-pressed={kind === x.kind} onClick={() => setKind(x.kind)} className={`block w-full rounded-lg px-3 py-2 text-start text-sm ${kind === x.kind ? "bg-accent font-semibold" : "hover:bg-muted"}`}>{ar ? x.titleAr : x.title}</button>)}</div> : null; })}
        </Surface>
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("common.from")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label={t("common.to")}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            {(me?.labs.length ?? 0) > 1 ? <Field label={t("ana.branch")}><Select value={labId} onChange={(e) => setLabId(e.target.value)}><option value="">{t("ana.allBranches")}</option>{me!.labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field> : null}
            <div className="ms-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => void download(`/analytics/reports/${kind}.csv?${qs}`, `${kind}.csv`)}><Download aria-hidden className="size-4" />CSV</Button><Button variant="outline" size="sm" onClick={() => void download(`/analytics/reports/${kind}.pdf?${qs}`, `${kind}.pdf`)}><Download aria-hidden className="size-4" />PDF</Button></div>
          </div>
          <ErrorNote error={rep.error} />
          {rep.isLoading ? <Skeleton className="h-72" /> : r ? (
            <>
              <h2 className="text-lg font-semibold">{ar ? r.titleAr : r.title}</h2>
              {chart ? <Surface className="p-4">{chart}</Surface> : null}
              {!r.rows.length ? <EmptyState title={t("common.none")} /> : (
                <Table head={r.columns.map((c: any) => ar ? c.labelAr : c.label)}>
                  {r.rows.slice(0, 300).map((row: any, i: number) => <tr key={i}>{r.columns.map((c: any) => <Td key={c.key} className={c.type && c.type !== "text" && c.type !== "date" ? "tabular-nums" : ""} dir={c.type === "text" ? "auto" : undefined}>{cell(c, row[c.key])}</Td>)}</tr>)}
                  {r.totals ? <tr className="bg-muted/50 font-semibold">{r.columns.map((c: any, i: number) => <Td key={c.key} className="tabular-nums">{i === 0 ? t("ana.total") : cell(c, r.totals[c.key])}</Td>)}</tr> : null}
                </Table>
              )}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
