import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly, dt, money, num } from "@/lib/format";
import { Check, Eye, FileText, Home } from "lucide-react";
import { Badge, Button, Card, CardTitle, Input, Modal, Table, Td, useToast } from "@/components/ui";
import { Meta, PdfPreview, PriorityChip } from "@/components/kit";
import { Skeleton, StatusChip, Surface, kcn } from "@/brand/ui-kit";
import { ErrorNote, PageHeader, ResultValue, StatusBadge } from "@/components/common";
import { SpecimenPanel } from "@/features/specimens/SpecimenPanel";
import { OrderExtras } from "@/components/OrderExtras";

const CHANNELS = ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT", "REFERRER_PORTAL"];

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [spec, setSpec] = useState<string | null>(null);
  const [rel, setRel] = useState<any>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [consent, setConsent] = useState<string[] | null>(null);
  const o = useQuery({ queryKey: ["order", id], queryFn: () => api<any>(`/orders/${id}`) });
  const results = useQuery({ queryKey: ["order-results", id], queryFn: () => api<any[]>(`/orders/${id}/results`), enabled: can("results.read") });
  const reports = useQuery({ queryKey: ["order-reports", id], queryFn: () => api<any[]>(`/orders/${id}/reports`), enabled: can("reports.read") });
  const ready = useQuery({ queryKey: ["order-ready", id], queryFn: () => api<any>(`/orders/${id}/report-readiness`), enabled: can("reports.read") });
  const refresh = () => void qc.invalidateQueries();
  const run = <T,>(fn: () => Promise<T>, msg?: string) => ({ mutationFn: fn, onSuccess: () => { refresh(); if (msg) toast(msg); } });
  const verify = useMutation(run(() => api(`/orders/${id}/verify-identity`, { body: { identifiersChecked: ids } }), t("orders.idVerified")));
  const saveConsent = useMutation(run(() => api(`/orders/${id}/consent`, { method: "PUT", body: { channels: consent ?? o.data.consentShareChannels } }), t("common.saved")));
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [deliver, setDeliver] = useState<any>(null);
  const cancel = useMutation({ mutationFn: () => api(`/orders/${id}/cancel`, { body: { reason: cancelReason } }), onSuccess: () => { setCancelOpen(false); refresh(); } });
  const doDeliver = useMutation({ mutationFn: () => api<any[]>(`/reports/${deliver.id}/deliver`, { body: { recipient: deliver.recipient, channels: deliver.channels } }), onSuccess: (r) => { setDeliver(null); refresh(); toast(t("oe.delivered", { ok: r.filter((x) => x.status === "SENT").length, n: r.length })); } });
  const medical = useMutation(run(() => api(`/orders/${id}/medical-validate`, { body: {} }), t("order.medicalDone")));
  const sign = useMutation(run(() => api(`/orders/${id}/reports`, { body: {} }), t("order.signed")));
  const release = useMutation({ mutationFn: () => api(`/reports/${rel.id}/release`, { body: { channels } }), onSuccess: () => { setRel(null); refresh(); toast(t("order.released")); } });
  const invoice = useMutation(run(() => api(`/orders/${id}/invoice`, { body: {} }), t("order.invoiced")));
  if (o.isLoading || !o.data) return <div role="status" aria-busy="true" className="space-y-4"><Skeleton className="h-8 w-1/3" /><Skeleton className="h-16" /><div className="grid gap-4 lg:grid-cols-[1fr_22rem]"><Skeleton className="h-64" /><Skeleton className="h-64" /></div></div>;
  const d = o.data;
  const consentNow: string[] = consent ?? d.consentShareChannels;
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const idKinds = ["dateOfBirth", "phone", "nationalId", "externalId"].filter((k) => (k === "dateOfBirth" ? d.patient.dateOfBirth : k === "phone" ? d.patient.phone : k === "nationalId" ? d.patient.nationalIdLast4 : d.patient.externalId));
  const cur = me?.tenant.currency;
  const steps = [
    { k: "ordered", on: true },
    { k: "collected", on: !["AWAITING_COLLECTION", "DRAFT"].includes(d.status) },
    { k: "resulted", on: ["IN_LAB", "PARTIALLY_RESULTED", "AWAITING_VALIDATION", "VALIDATED", "RELEASED"].includes(d.status) && d.status !== "IN_LAB" },
    { k: "validated", on: ["VALIDATED", "RELEASED"].includes(d.status) },
    { k: "signed", on: Boolean(reports.data?.length) },
    { k: "released", on: d.status === "RELEASED" },
  ];
  const activeStep = steps.findIndex((x) => !x.on);
  const cancelled = d.status === "CANCELLED";
  const rows = d.items.length;
  const abnormal = (results.data ?? []).filter((r) => r.flag && r.flag !== "NORMAL" && !["CORRECTED", "REJECTED"].includes(r.status)).length;
  return (
    <>
      <PageHeader title={`${d.orderNumber}`} sub={`${d.patient.fullName} · ${t(`orders.sources.${d.source}`)}`}
        actions={<><PriorityChip priority={d.priority} /><StatusBadge value={d.status} />{can("orders.cancel") && !["CANCELLED", "RELEASED"].includes(d.status) ? <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>{t("order.cancel")}</Button> : null}</>} />
      <ErrorNote error={cancel.error ?? medical.error ?? sign.error ?? invoice.error ?? verify.error} />
      {!cancelled ? (
        <ol aria-label={t("ux.order.progress")} className="mb-5 flex items-start">
          {steps.map((x, i) => (
            <li key={x.k} aria-current={i === activeStep ? "step" : undefined} className="flex min-w-0 flex-1 flex-col items-center gap-1.5 px-0.5 text-center">
              <div className="flex w-full items-center">
                <span aria-hidden className={kcn("h-0.5 flex-1 rounded-full", i === 0 ? "opacity-0" : x.on ? "bg-primary" : "bg-border")} />
                <span className={kcn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ring-4 ring-background", x.on ? "bg-primary text-primary-foreground" : i === activeStep ? "bg-accent text-accent-foreground ring-2 ring-primary!" : "bg-muted text-muted-foreground")}>{x.on ? <Check aria-hidden className="size-4" /> : i + 1}</span>
                <span aria-hidden className={kcn("h-0.5 flex-1 rounded-full", i === steps.length - 1 ? "opacity-0" : steps[i + 1]!.on ? "bg-primary" : "bg-border")} />
              </div>
              <span className={kcn("text-[11px] leading-tight sm:text-xs", x.on || i === activeStep ? "font-semibold" : "text-muted-foreground")}>{t(`ux.order.steps.${x.k}`)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Surface className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
              <h3 className="text-sm font-semibold">{t("order.itemsResults")}</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="tabular-nums">{t("ux.order.tests", { n: rows })}</span>{abnormal ? <StatusChip tone="warn">{t("ux.order.abnormal", { n: abnormal })}</StatusChip> : null}</div>
            </div>
            <Table className="rounded-none border-0 shadow-none" head={[t("cat.test"), t("order.analyte"), t("order.result"), t("order.range"), t("common.status"), t("common.price")]}>
              {d.items.map((it: any) => {
                const rs = (results.data ?? []).filter((r) => r.orderItemId === it.id && !["CORRECTED", "REJECTED"].includes(r.status));
                if (rs.length === 0) return <tr key={it.id}><Td><span className="font-mono text-xs">{it.test.code}</span> <span className="ms-1">{it.test.nameEn}</span></Td><Td>-</Td><Td>-</Td><Td>-</Td><Td><StatusBadge value={it.status} /></Td><Td className="tabular-nums">{num(it.price)}</Td></tr>;
                return rs.map((r, idx) => (
                  <tr key={r.id} className={r.flag?.startsWith("CRITICAL") ? "kx-row-crit" : r.flag && r.flag !== "NORMAL" ? "kx-row-warn" : undefined}>
                    <Td>{idx === 0 ? <><span className="font-mono text-xs">{it.test.code}</span> <span className="ms-1">{it.test.nameEn}</span></> : ""}</Td>
                    <Td>{r.analyte.nameEn}</Td>
                    <Td><ResultValue value={r.valueNumeric ?? r.valueText} unit={r.unit} flag={r.flag} />{r.deltaCheckFailed ? <Badge tone="warn" className="ms-1">Δ</Badge> : null}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground"><bdi dir="ltr" className="tabular-nums">{r.refLow ?? ""} – {r.refHigh ?? ""}</bdi></Td>
                    <Td><StatusBadge value={r.status} />{r.autoVerified ? <Badge tone="info" className="ms-1">{t("order.auto")}</Badge> : null}</Td>
                    <Td className="tabular-nums">{idx === 0 ? num(it.price) : ""}</Td>
                  </tr>
                ));
              })}
            </Table>
            {(can("results.medical_validate") && d.items.some(() => (results.data ?? []).some((r) => r.status === "TECH_VALIDATED"))) || (can("reports.sign") && ready.data?.ready && d.status !== "RELEASED") || (ready.data && !ready.data.ready && can("reports.read")) ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 bg-muted/30 px-4 py-3">
                {can("results.medical_validate") && d.items.some(() => (results.data ?? []).some((r) => r.status === "TECH_VALIDATED")) ? <Button onClick={() => medical.mutate()}>{t("order.medicalValidate")}</Button> : null}
                {can("reports.sign") && ready.data?.ready && d.status !== "RELEASED" ? <Button variant="pulse" onClick={() => sign.mutate()}>{t("order.sign")}</Button> : null}
                {ready.data && !ready.data.ready && can("reports.read") ? <p className="text-xs text-muted-foreground">{t("order.notReady", { n: ready.data.blockers.length })}</p> : null}
              </div>
            ) : null}
          </Surface>
          {can("reports.read") ? (
            <Surface className="overflow-hidden">
              <div className="border-b border-border/70 px-4 py-3"><h3 className="text-sm font-semibold">{t("order.reports")}</h3></div>
              {reports.data?.length ? (
                <ul className="divide-y divide-border/70">
                  {reports.data.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><FileText aria-hidden className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold">{t("order.version")} <span className="tabular-nums">v{r.version}</span>{r.correctionReason ? <span className="ms-2 text-xs font-normal text-muted-foreground">{r.correctionReason}</span> : null}</div>
                        <div className="text-xs text-muted-foreground">{t("order.signedAt")}: {dt(r.signedAt, i18n.language)}</div>
                        <div className="mt-1 flex flex-wrap gap-1">{r.releases.map((x: any) => <Badge key={x.channel} tone="ok">{t(`channel.${x.channel}`)}</Badge>)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => setPdf({ ...r, filename: `${d.orderNumber}-v${r.version}.pdf` })}><Eye aria-hidden className="size-4" />{t("ux.preview.open")}</Button>
                        <Button size="sm" variant="outline" onClick={() => void download(`/reports/${r.id}/pdf`, `${d.orderNumber}-v${r.version}.pdf`)}>PDF</Button>
                        {can("reports.release") && r.version === reports.data[0].version ? <Button size="sm" onClick={() => { setRel(r); setChannels([]); }}>{t("order.release")}</Button> : null}
                        {can("reports.deliver") && r.releases.length && r.version === reports.data[0].version ? <Button size="sm" variant="outline" onClick={() => setDeliver({ id: r.id, recipient: "PATIENT", channels: ["WHATSAPP"] })}>{t("oe.deliver")}</Button> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-4 py-6 text-sm text-muted-foreground">{t("order.noReports")}</p>}
            </Surface>
          ) : null}
        </div>
        <aside className="space-y-4">
          <Surface className="p-4">
            <h3 className="mb-3 text-sm font-semibold">{t("orders.patient")}</h3>
            <dl className="grid grid-cols-2 gap-3">
              <Meta label={t("orders.fullName")} className="col-span-2"><span dir="auto">{d.patient.fullName}</span></Meta>
              <Meta label={t("orders.dob")}>{d.patient.dateOfBirth ? dOnly(d.patient.dateOfBirth, i18n.language) : "-"}</Meta>
              <Meta label={t("orders.sex")}>{t(`orders.sexes.${d.patient.sex ?? "UNKNOWN"}`, { defaultValue: d.patient.sex ?? "-" })}</Meta>
              <Meta label={t("orders.phone")} className="col-span-2"><bdi dir="ltr" className="tabular-nums">{d.patient.phone ?? "-"}</bdi></Meta>
            </dl>
          </Surface>
          <Card>
            <CardTitle>{t("order.identity")}</CardTitle>
            {d.identityVerified ? <Badge tone="ok" className="gap-1"><Check aria-hidden className="size-3" />{t("order.verified")}: {d.identifiersChecked.map((k: string) => t(`orders.ids.${k}`, { defaultValue: k })).join(", ")}</Badge> : (
              <div className="space-y-2">
                <Badge tone="warn">{t("order.notVerified")}</Badge>
                <div className="flex flex-wrap gap-3">{idKinds.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(k)} onChange={() => toggle(ids, setIds, k)} />{t(`orders.ids.${k}`)}</label>)}</div>
                <Button size="sm" disabled={ids.length < 2} onClick={() => verify.mutate()}>{t("order.verify")}</Button>
              </div>
            )}
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t("orders.consent")}</p>
              <div className="flex flex-wrap gap-3">{CHANNELS.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!can("orders.create")} checked={consentNow.includes(c)} onChange={() => toggle(consentNow, setConsent, c)} />{t(`channel.${c}`)}</label>)}</div>
              {consent && can("orders.create") ? <Button size="sm" className="mt-2" onClick={() => saveConsent.mutate()}>{t("common.save")}</Button> : null}
            </div>
          </Card>
          <Card>
            <CardTitle>{t("order.specimens")}</CardTitle>
            {d.specimens.length === 0 ? <p className="text-sm text-muted-foreground">{t("order.noSpecimens")}</p> : (
              <ul className="space-y-2">{d.specimens.map((s: any) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/70 px-3 py-2 text-sm">
                  <span><span className="font-mono font-semibold">{s.accessionNumber}</span> <span className="text-muted-foreground">{s.specimenType}</span></span>
                  <span className="flex items-center gap-2"><StatusBadge value={s.status} />{can("specimens.read") ? <Button size="sm" variant="outline" onClick={() => setSpec(s.id)}>{t("common.open")}</Button> : null}</span>
                </li>
              ))}</ul>
            )}
            {d.homeCollection ? (
              <div className="mt-3 rounded-lg bg-accent/70 p-3 text-sm">
                <div className="mb-1 flex flex-wrap items-center gap-2 font-semibold"><Home aria-hidden className="size-4" />{t("orders.homeCollection")} <StatusBadge value={d.homeCollection.status} /></div>
                <div dir="auto">{d.homeCollection.address}</div>
                {d.homeCollection.addressMasked ? <div className="text-xs text-muted-foreground">{t("phleb.addressMasked")}</div> : null}
                <div className="text-xs text-muted-foreground">{dt(d.homeCollection.slotStart, i18n.language)} – {dt(d.homeCollection.slotEnd, i18n.language)}</div>
                {d.homeCollection.labelPhotoKey ? <div className="text-xs text-muted-foreground">{t("order.labelPhoto")}</div> : null}
              </div>
            ) : null}
            {d.nurseCollection ? (
              <div className="mt-3 rounded-lg bg-accent/70 p-3 text-sm" data-testid="nurse-collection">
                <div className="mb-1 font-semibold">{t("order.nurse.title")}</div>
                <div>{t("order.nurse.collector")}: {d.nurseCollection.collectorName ?? d.nurseCollection.collectorRef}</div>
                <div className="text-muted-foreground">{t("order.nurse.collectedAt")}: {dt(d.nurseCollection.collectedAt, i18n.language)}</div>
                {d.nurseCollection.handedOverAt ? <div className="text-muted-foreground">{t("order.nurse.handedOverAt")}: {dt(d.nurseCollection.handedOverAt, i18n.language)}</div> : null}
                {d.nurseCollection.receivedAt ? <div className="text-muted-foreground">{t("order.nurse.receivedAt")}: {dt(d.nurseCollection.receivedAt, i18n.language)}</div> : null}
                <div className="mt-1 text-xs text-muted-foreground">{t("order.nurse.note")}</div>
              </div>
            ) : null}
          </Card>
          <OrderExtras order={d} results={results.data ?? []} />
          {can("billing.invoice") ? (
            <Card>
              <CardTitle>{t("order.billing")}</CardTitle>
              {d.invoices.length ? d.invoices.map((i: any) => (
                <div key={i.id} className="space-y-1 text-sm">
                  <div className="flex items-center justify-between"><span className="font-mono text-xs">{i.number}</span><StatusBadge value={i.status} /></div>
                  {i.subtotal != null ? <div className="flex justify-between text-muted-foreground"><span>{t("bill.subtotal")}</span><span className="tabular-nums">{money(i.subtotal, cur, i18n.language)}</span></div> : null}
                  {i.vatTotal != null ? <div className="flex justify-between text-muted-foreground"><span>{t("bill.vat")} ({i.vatRatePercent}%)</span><span className="tabular-nums">{money(i.vatTotal, cur, i18n.language)}</span></div> : null}
                  <div className="flex justify-between border-t border-border pt-1 font-semibold"><span>{t("bill.total")}</span><span className="tabular-nums">{money(i.total, cur, i18n.language)}</span></div>
                </div>
              )) : <Button size="sm" onClick={() => invoice.mutate()}>{t("order.createInvoice")}</Button>}
            </Card>
          ) : null}
        </aside>
      </div>
      <Modal open={Boolean(spec)} onClose={() => setSpec(null)} title={t("spec.details")} wide>{spec ? <SpecimenPanel specimenId={spec} /> : null}</Modal>
      <Modal open={Boolean(pdf)} onClose={() => setPdf(null)} title={`${t("ux.preview.title")} · ${d.orderNumber} v${pdf?.version ?? ""}`} xl>{pdf ? <PdfPreview path={`/reports/${pdf.id}/pdf`} title={t("ux.preview.title")} filename={pdf.filename} onDownload={() => void download(`/reports/${pdf.id}/pdf`, pdf.filename)} /> : null}</Modal>
      <Modal open={Boolean(rel)} onClose={() => setRel(null)} title={t("order.releaseTitle")}>
        <p className="mb-3 text-sm text-muted-foreground">{t("order.releaseNote")}</p>
        <div className="space-y-2">{CHANNELS.map((c) => { const ok = d.consentShareChannels.includes(c); return <label key={c} className={`flex items-center gap-2 text-sm ${ok ? "" : "opacity-40"}`}><input type="checkbox" disabled={!ok} checked={channels.includes(c)} onChange={() => toggle(channels, setChannels, c)} />{t(`channel.${c}`)}{!ok ? <Badge tone="warn">{t("order.noConsent")}</Badge> : null}</label>; })}</div>
        <div className="mt-4 space-y-2"><ErrorNote error={release.error} /><Button disabled={!channels.length || release.isPending} onClick={() => release.mutate()}>{t("order.release")}</Button></div>
      </Modal>
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title={t("order.cancel")}>
        <div className="space-y-3"><p className="text-sm text-muted-foreground">{t("oe.cancelNote")}</p><Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder={t("oe.reason")} aria-label={t("oe.reason")} autoFocus /><ErrorNote error={cancel.error} /><Button variant="outline" disabled={cancelReason.trim().length < 3 || cancel.isPending} onClick={() => cancel.mutate()}>{t("order.cancel")}</Button></div>
      </Modal>
      <Modal open={Boolean(deliver)} onClose={() => setDeliver(null)} title={t("oe.deliver")}>
        {deliver ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{t("oe.deliverNote")}</p>
          <div className="flex gap-4">{["PATIENT", "REFERRER"].map((r) => <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="rcp" checked={deliver.recipient === r} onChange={() => setDeliver({ ...deliver, recipient: r })} />{t(`oe.recipients.${r}`)}</label>)}</div>
          <div className="flex gap-4">{["EMAIL", "WHATSAPP", "SMS"].map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={deliver.channels.includes(c)} onChange={() => setDeliver({ ...deliver, channels: deliver.channels.includes(c) ? deliver.channels.filter((x: string) => x !== c) : [...deliver.channels, c] })} />{t(`ref.chan.${c}`)}</label>)}</div>
          <ErrorNote error={doDeliver.error} /><Button disabled={!deliver.channels.length || doDeliver.isPending} onClick={() => doDeliver.mutate()}>{t("oe.send")}</Button></div> : null}
      </Modal>
    </>
  );
}
