import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Empty, Spinner, Table, Tabs, Td } from "@/components/ui";
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
      {tab === "tat" ? (tat.isLoading ? <Spinner /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">{Object.entries(tat.data.summary).map(([k, v]) => <Badge key={k} tone={k === "breached" ? "crit" : k === "atRisk" ? "warn" : "info"}>{t(`rep.tatKeys.${k}`)}: {String(v)}</Badge>)}</div>
          {tat.data.rows.length === 0 ? <Empty>{t("common.none")}</Empty> : (
            <Table head={[t("orders.number"), t("cat.test"), t("rep.target"), t("rep.elapsed"), t("common.status")]}>
              {tat.data.rows.slice(0, 200).map((r: any) => <tr key={r.orderItemId}><Td><Link className="font-mono text-primary underline" to={`/orders/${r.orderId}`}>{r.orderNumber}</Link></Td><Td>{r.test}</Td><Td>{r.targetMinutes ?? "-"} {t("crit.min")}</Td><Td>{r.elapsedMinutes} {t("crit.min")}{r.percent != null ? ` (${r.percent}%)` : ""}</Td><Td><StatusBadge value={r.status} /></Td></tr>)}
            </Table>
          )}
        </>
      )) : null}
      {tab === "exports" ? (
        <Card>
          <CardTitle>{t("rep.exportTitle")}</CardTitle>
          <div className="flex flex-wrap gap-2">{EXPORTS.map((k) => <Button key={k} variant="outline" onClick={() => void download(`/exports/${k}.csv`, `${k}.csv`)}>{t(`rep.export.${k}`)} CSV</Button>)}</div>
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
