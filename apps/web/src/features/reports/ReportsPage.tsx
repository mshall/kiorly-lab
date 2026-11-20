import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Download } from "lucide-react";
import { Button, Card, CardTitle, Empty, Table, Tabs, Td } from "@/components/ui";
import { EmptyState, Skeleton, StatCard, Surface, TableSkeleton, type KTone } from "@/brand/ui-kit";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";

const EXPORTS = ["invoices", "payments", "orders", "qc-runs", "tat", "results-summary"];

/** KLBIZ02/03: TAT dashboard + SLA, CSV exports for the lab's accountant (VAT lines only), send-out costs, referring-doctor statements (gated). */
export function ReportsPage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const [tab, setTab] = useState("tat");
  const tat = useQuery({ queryKey: ["tat"], queryFn: () => api<any>("/tat") });
  const send = useQuery({ queryKey: ["send-out"], queryFn: () => api<any>("/send-out-costs"), enabled: tab === "sendout" && can("billing.read") });
  const stmt = useQuery({ queryKey: ["statements"], queryFn: () => api<any[]>("/statements/referring-doctors"), enabled: tab === "statements" && can("exports.run"), retry: false });
  const sweep = useMutation({ mutationFn: () => api("/tat/sla-sweep", { body: {} }) });
  const tabs = [{ id: "tat", label: t("rep.tat") }, ...(can("exports.run") ? [{ id: "exports", label: t("rep.exports") }, { id: "statements", label: t("rep.statements") }] : []), ...(can("billing.read") ? [{ id: "sendout", label: t("rep.sendOut") }] : [])];
  return (
    <>
      <PageHeader title={t("rep.title")} sub={t("rep.sub")} actions={can("settings.manage") ? <Button variant="outline" size="sm" onClick={() => sweep.mutate()}>{t("rep.runSweep")}</Button> : null} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "tat" ? (tat.isLoading ? <div role="status" aria-busy="true"><div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20" />)}</div><Surface><TableSkeleton rows={6} cols={5} /></Surface></div> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Object.entries(tat.data.summary).map(([k, v]) => <StatCard key={k} label={t(`rep.tatKeys.${k}`)} value={String(v)} tone={(k === "breached" ? (v ? "bad" : "good") : k === "atRisk" ? (v ? "warn" : "good") : k === "ok" || k === "doneOnTime" ? "good" : k === "doneLate" ? "warn" : "neutral") as KTone} />)}</div>
          {tat.data.rows.length === 0 ? <EmptyState compact title={t("common.none")} /> : (
            <Table head={[t("orders.number"), t("cat.test"), t("rep.target"), t("rep.elapsed"), t("common.status")]}>
              {tat.data.rows.slice(0, 200).map((r: any) => (
                <tr key={r.orderItemId} className={r.status === "BREACHED" ? "kx-row-crit" : r.status === "AT_RISK" ? "kx-row-warn" : undefined}>
                  <Td><Link className="font-mono font-semibold text-primary underline-offset-4 hover:underline" to={`/orders/${r.orderId}`}>{r.orderNumber}</Link></Td><Td>{r.test}</Td><Td className="tabular-nums">{r.targetMinutes ?? "-"} {t("crit.min")}</Td>
                  <Td><div className="flex items-center gap-2"><span className="tabular-nums">{r.elapsedMinutes} {t("crit.min")}</span>{r.percent != null ? <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><span className={`block h-full rounded-full ${r.percent >= 100 ? "bg-[hsl(var(--danger-text))]" : r.percent >= 80 ? "bg-[hsl(var(--warning))]" : "bg-[hsl(var(--success))]"}`} style={{ width: `${Math.min(100, r.percent)}%` }} /></span> : null}{r.percent != null ? <span className="text-xs tabular-nums text-muted-foreground">{r.percent}%</span> : null}</div></Td>
                  <Td><StatusBadge value={r.status} /></Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )) : null}
      {tab === "exports" ? (
        <Card>
          <CardTitle>{t("rep.exportTitle")}</CardTitle>
          <div className="flex flex-wrap gap-2">{EXPORTS.map((k) => <Button key={k} variant="outline" onClick={() => void download(`/exports/${k}.csv`, `${k}.csv`)}><Download aria-hidden className="size-4" />{t(`rep.export.${k}`)} CSV</Button>)}</div>
          <p className="mt-3 text-xs text-muted-foreground">{t("rep.exportNote")}</p>
        </Card>
      ) : null}
      {tab === "statements" ? (
        <div>
          <ErrorNote error={stmt.error} />
          <p className="mb-3 text-sm text-muted-foreground">{t("rep.statementsNote")}</p>
          {stmt.data?.length ? <Table head={[t("orders.doctorName"), t("orders.number"), t("orders.tests"), t("rep.gross")]}>{stmt.data.map((s) => <tr key={s.ref ?? s.doctor}><Td>{s.doctor}</Td><Td>{s.orders}</Td><Td>{s.tests}</Td><Td>{money(s.gross, me?.tenant.currency, i18n.language)}</Td></tr>)}</Table> : stmt.isError ? null : <Empty>{t("common.none")}</Empty>}
        </div>
      ) : null}
      {tab === "sendout" ? (
        send.data?.lines.length ? <Table head={[t("orders.number"), t("cat.test"), t("rep.referralLab"), t("rep.cost"), t("common.price"), t("rep.margin")]}>{send.data.lines.map((l: any, i: number) => <tr key={i}><Td>{l.orderNumber}</Td><Td>{l.test}</Td><Td>{l.referralLab}</Td><Td>{money(l.cost, me?.tenant.currency, i18n.language)}</Td><Td>{money(l.price, me?.tenant.currency, i18n.language)}</Td><Td>{money(l.margin, me?.tenant.currency, i18n.language)}</Td></tr>)}</Table> : <Empty>{t("common.none")}</Empty>
      ) : null}
    </>
  );
}
