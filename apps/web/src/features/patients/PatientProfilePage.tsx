import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, Pencil, Plus } from "lucide-react";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly, dt, num } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Tabs, Td, Textarea, useToast } from "@/components/ui";
import { Meta, PriorityChip } from "@/components/kit";
import { TrendChart } from "@/components/charts";
import { EmptyState, Skeleton, Surface } from "@/brand/ui-kit";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";

const KINDS = ["RESULT_SHARING", "DATA_PROCESSING", "MARKETING", "RESEARCH"];

/** Patient 360: demographics, consent history, visits, cumulative result trends per analyte (chart + table + PDF). */
export function PatientProfilePage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("trends");
  const [sel, setSel] = useState<string>("");
  const [edit, setEdit] = useState<any>(null);
  const prof = useQuery({ queryKey: ["patient-profile", id], queryFn: () => api<any>(`/patients/${id}/profile`) });
  const trends = useQuery({ queryKey: ["patient-trends", id], queryFn: () => api<any[]>(`/patients/${id}/trends`), enabled: can("results.read") });
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => api(`/patients/${id}`, { method: "PUT", body }), onSuccess: () => { setEdit(null); void qc.invalidateQueries(); toast(t("common.saved")); } });
  const consent = useMutation({ mutationFn: (b: { kind: string; granted: boolean }) => api(`/patients/${id}/consents`, { body: b }), onSuccess: () => { void qc.invalidateQueries({ queryKey: ["patient-profile", id] }); toast(t("common.saved")); } });
  if (prof.isLoading || !prof.data) return <div role="status" aria-busy="true" className="space-y-4"><Skeleton className="h-9 w-1/3" /><Skeleton className="h-40" /><Skeleton className="h-72" /></div>;
  const { patient: p, orders, stats, consents } = prof.data;
  const series = trends.data ?? [];
  const cur = series.find((s) => s.analyte.id === sel) ?? series[0];
  const tabs = [...(can("results.read") ? [{ id: "trends", label: t("pat.trends") }] : []), { id: "visits", label: t("pat.visitsTab") }, { id: "consent", label: t("pat.consentTab") }];
  return (
    <>
      <PageHeader title={p.fullName} sub={`${p.mrn ?? ""} · ${t(`orders.sexes.${p.sex}`, { defaultValue: p.sex })}${p.dateOfBirth ? ` · ${dOnly(p.dateOfBirth, i18n.language)}` : ""}`}
        actions={<>
          {can("results.read") ? <Button variant="outline" size="sm" onClick={() => void download(`/patients/${id}/cumulative.pdf`, `cumulative-${p.mrn ?? id}.pdf`)}><FileText aria-hidden className="size-4" />{t("pat.cumulative")}</Button> : null}
          {can("orders.create") ? <Link to={`/orders/new?patientId=${id}`}><Button size="sm"><Plus aria-hidden className="size-4" />{t("orders.new")}</Button></Link> : null}
          {can("patients.write") ? <Button variant="outline" size="sm" onClick={() => setEdit({ fullName: p.fullName, phone: p.phone ?? "", email: p.email ?? "", address: p.address ?? "", city: p.city ?? "", bloodGroup: p.bloodGroup ?? "", notes: p.notes ?? "", conditions: (p.conditions ?? []).join(",") })}><Pencil aria-hidden className="size-4" />{t("common.edit")}</Button> : null}
        </>} />
      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Surface className="p-4">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meta label={t("orders.phone")}><bdi dir="ltr" className="tabular-nums">{p.phone ?? "-"}</bdi></Meta>
            <Meta label={t("pat.email")}>{p.email ?? "-"}</Meta>
            <Meta label={t("pat.city")}>{p.city ?? "-"}</Meta>
            <Meta label={t("pat.blood")}>{p.bloodGroup ?? "-"}</Meta>
            <Meta label={t("orders.nationalId")}>{p.nationalIdLast4 ? `••••${p.nationalIdLast4}` : "-"}</Meta>
            <Meta label={t("pat.conditions")}>{p.conditions?.length ? p.conditions.map((c: string) => <Badge key={c} tone="info" className="me-1">{c}</Badge>) : "-"}</Meta>
            <Meta label={t("pat.firstVisit")}>{stats.firstVisit ? dOnly(stats.firstVisit, i18n.language) : "-"}</Meta>
            <Meta label={t("pat.lastVisit")}>{stats.lastVisit ? dOnly(stats.lastVisit, i18n.language) : "-"}</Meta>
          </dl>
          {p.notes ? <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-sm" dir="auto">{p.notes}</p> : null}
        </Surface>
        <Surface className="grid grid-cols-3 gap-2 p-4 text-center">
          <div><div className="text-2xl font-semibold tabular-nums">{stats.orders}</div><div className="text-xs text-muted-foreground">{t("pat.visits")}</div></div>
          <div><div className="text-2xl font-semibold tabular-nums">{stats.results}</div><div className="text-xs text-muted-foreground">{t("pat.resultsCount")}</div></div>
          <div><div className="text-2xl font-semibold tabular-nums">{series.length}</div><div className="text-xs text-muted-foreground">{t("pat.analytes")}</div></div>
        </Surface>
      </div>
      <Tabs tabs={tabs} value={tabs.some((x) => x.id === tab) ? tab : tabs[0]!.id} onChange={setTab} />
      {tab === "trends" && can("results.read") ? (
        trends.isLoading ? <Skeleton className="h-72" /> : !series.length ? <EmptyState title={t("pat.noTrends")} /> : (
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <Surface className="max-h-[28rem] overflow-auto p-2">
              <ul className="space-y-0.5">{series.map((s) => {
                const on = s.analyte.id === cur?.analyte.id;
                const d = s.stats.deltaPercent;
                return <li key={s.analyte.id}><button type="button" onClick={() => setSel(s.analyte.id)} aria-pressed={on} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm ${on ? "bg-accent font-semibold" : "hover:bg-muted"}`}><span dir="auto">{s.analyte.nameEn}</span><span className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">{s.stats.abnormal ? <Badge tone="warn">{s.stats.abnormal}</Badge> : null}{d != null ? `${d > 0 ? "+" : ""}${d}%` : ""}</span></button></li>;
              })}</ul>
            </Surface>
            {cur ? (
              <Surface className="space-y-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-sm font-semibold" dir="auto">{cur.analyte.nameEn} <span className="font-mono text-xs text-muted-foreground">{cur.analyte.code}</span></h3><span className="text-xs text-muted-foreground">{t("pat.trendStats", { min: num(cur.stats.min), max: num(cur.stats.max), n: cur.stats.count })}</span></div>
                <TrendChart label={cur.analyte.nameEn} unit={cur.analyte.unit} points={cur.points.map((x: any) => ({ at: x.at, value: x.value, flag: x.flag }))} low={cur.points.at(-1)?.refLow} high={cur.points.at(-1)?.refHigh} />
                <Table head={[t("common.date"), t("order.result"), t("order.range"), t("order.number"), ""]}>
                  {[...cur.points].reverse().map((x: any, i: number) => <tr key={i}><Td>{dOnly(x.at, i18n.language)}</Td><Td className="tabular-nums"><span className={x.flag !== "NORMAL" ? "font-semibold text-[hsl(var(--warning))]" : ""}>{x.value} {cur.analyte.unit}</span></Td><Td className="text-xs text-muted-foreground"><bdi dir="ltr">{x.refLow ?? ""} – {x.refHigh ?? ""}</bdi></Td><Td><Link className="font-mono text-xs text-primary hover:underline" to={`/orders/${x.orderId}`}>{x.orderNumber}</Link></Td><Td>{x.flag !== "NORMAL" ? <Badge tone={x.flag.startsWith("CRITICAL") ? "crit" : "warn"}>{t(`flag.${x.flag}`, { defaultValue: x.flag })}</Badge> : null}</Td></tr>)}
                </Table>
              </Surface>
            ) : null}
          </div>
        )
      ) : null}
      {tab === "visits" ? (
        <Table head={[t("order.number"), t("common.date"), t("cat.test"), t("orders.priority"), t("common.status"), t("ref.referrer")]}>
          {orders.map((o: any) => <tr key={o.id}><Td><Link className="font-mono text-xs font-semibold text-primary hover:underline" to={`/orders/${o.id}`}>{o.orderNumber}</Link></Td><Td>{dt(o.createdAt, i18n.language)}</Td><Td className="max-w-xs truncate text-xs">{o.items.map((i: any) => i.test.code).join(", ")}</Td><Td><PriorityChip priority={o.priority} /></Td><Td><StatusBadge value={o.status} /></Td><Td>{o.referrer?.name ?? "-"}</Td></tr>)}
        </Table>
      ) : null}
      {tab === "consent" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <CardTitle>{t("pat.consentTab")}</CardTitle>
            {KINDS.map((k) => {
              const c = consents.current[k];
              return <div key={k} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{t(`pat.consent.${k}`)}</span><span className="flex items-center gap-2">{c ? <Badge tone={c.granted ? "ok" : "muted"}>{c.granted ? t("pat.granted") : t("pat.withdrawn")}</Badge> : <Badge tone="muted">{t("pat.notAsked")}</Badge>}{can("patients.write") ? <Button size="sm" variant="outline" onClick={() => consent.mutate({ kind: k, granted: !(c?.granted) })}>{c?.granted ? t("pat.withdraw") : t("pat.grant")}</Button> : null}</span></div>;
            })}
            <p className="text-xs text-muted-foreground">{t("pat.consentNote")}</p>
          </Card>
          <Card>
            <CardTitle>{t("pat.consentHistory")}</CardTitle>
            <ul className="space-y-1 text-xs text-muted-foreground">{consents.history.map((h: any) => <li key={h.id}>{dt(h.capturedAt, i18n.language)} · {t(`pat.consent.${h.kind}`)} · {h.granted ? t("pat.granted") : t("pat.withdrawn")}</li>)}{!consents.history.length ? <li>{t("common.none")}</li> : null}</ul>
          </Card>
        </div>
      ) : null}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={t("common.edit")} wide>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("orders.fullName")} className="sm:col-span-2"><Input value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} /></Field>
          <Field label={t("orders.phone")}><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label={t("pat.email")}><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label={t("pat.city")}><Input value={edit.city} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
          <Field label={t("pat.blood")}><Select value={edit.bloodGroup} onChange={(e) => setEdit({ ...edit, bloodGroup: e.target.value })}>{["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => <option key={b} value={b}>{b || "-"}</option>)}</Select></Field>
          <Field label={t("pat.conditions")} hint={t("pat.conditionsHint")} className="sm:col-span-2"><Input value={edit.conditions} onChange={(e) => setEdit({ ...edit, conditions: e.target.value })} /></Field>
          <Field label={t("pat.notes")} className="sm:col-span-2"><Textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <div className="sm:col-span-2 space-y-2"><ErrorNote error={save.error} /><Button disabled={save.isPending} onClick={() => { const b: any = { ...edit, conditions: edit.conditions.split(",").map((x: string) => x.trim().toUpperCase()).filter(Boolean) }; for (const k of ["phone", "email", "address", "city", "bloodGroup", "notes"]) if (b[k] === "") b[k] = null; save.mutate(b); }}>{t("common.save")}</Button></div>
        </div> : null}
      </Modal>
    </>
  );
}
