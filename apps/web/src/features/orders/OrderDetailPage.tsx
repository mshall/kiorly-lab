import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt, money, num } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Modal, Spinner, Table, Td, useToast } from "@/components/ui";
import { ErrorNote, FlagBadge, PageHeader, StatusBadge } from "@/components/common";
import { SpecimenPanel } from "@/features/specimens/SpecimenPanel";

const CHANNELS = ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"];

export function OrderDetailPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [spec, setSpec] = useState<string | null>(null);
  const [rel, setRel] = useState<any>(null);
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
  const cancel = useMutation(run(() => api(`/orders/${id}/cancel`, { body: {} })));
  const medical = useMutation(run(() => api(`/orders/${id}/medical-validate`, { body: {} }), t("order.medicalDone")));
  const sign = useMutation(run(() => api(`/orders/${id}/reports`, { body: {} }), t("order.signed")));
  const release = useMutation({ mutationFn: () => api(`/reports/${rel.id}/release`, { body: { channels } }), onSuccess: () => { setRel(null); refresh(); toast(t("order.released")); } });
  const invoice = useMutation(run(() => api(`/orders/${id}/invoice`, { body: {} }), t("order.invoiced")));
  if (o.isLoading || !o.data) return <Spinner />;
  const d = o.data;
  const consentNow: string[] = consent ?? d.consentShareChannels;
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const idKinds = ["dateOfBirth", "phone", "nationalId", "externalId"].filter((k) => (k === "dateOfBirth" ? d.patient.dateOfBirth : k === "phone" ? d.patient.phone : k === "nationalId" ? d.patient.nationalIdLast4 : d.patient.externalId));
  return (
    <>
      <PageHeader title={`${d.orderNumber}`} sub={`${d.patient.fullName} · ${t(`orders.sources.${d.source}`)}`}
        actions={<><StatusBadge value={d.status} />{d.priority !== "ROUTINE" ? <Badge tone="crit">{d.priority}</Badge> : null}{can("orders.cancel") && !["CANCELLED", "RELEASED"].includes(d.status) ? <Button variant="outline" size="sm" onClick={() => cancel.mutate()}>{t("order.cancel")}</Button> : null}</>} />
      <ErrorNote error={cancel.error ?? medical.error ?? sign.error ?? invoice.error ?? verify.error} />
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>{t("order.identity")}</CardTitle>
          {d.identityVerified ? <Badge tone="ok">{t("order.verified")}: {d.identifiersChecked.map((k: string) => t(`orders.ids.${k}`, { defaultValue: k })).join(", ")}</Badge> : (
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
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                <span><span className="font-mono font-semibold">{s.accessionNumber}</span> <span className="text-muted-foreground">{s.specimenType}</span></span>
                <span className="flex items-center gap-2"><StatusBadge value={s.status} />{can("specimens.read") ? <Button size="sm" variant="outline" onClick={() => setSpec(s.id)}>{t("common.open")}</Button> : null}</span>
              </li>
            ))}</ul>
          )}
          {d.homeCollection ? (
            <div className="mt-3 rounded-md bg-accent p-3 text-sm">
              <div className="mb-1 flex items-center gap-2 font-semibold">{t("orders.homeCollection")} <StatusBadge value={d.homeCollection.status} /></div>
              <div>{d.homeCollection.address}</div>
              {d.homeCollection.addressMasked ? <div className="text-xs text-muted-foreground">{t("phleb.addressMasked")}</div> : null}
              <div className="text-muted-foreground">{dt(d.homeCollection.slotStart, i18n.language)} – {dt(d.homeCollection.slotEnd, i18n.language)}</div>
              {d.homeCollection.labelPhotoKey ? <div className="text-xs text-muted-foreground">{t("order.labelPhoto")}</div> : null}
            </div>
          ) : null}
          {d.nurseCollection ? (
            <div className="mt-3 rounded-md bg-accent p-3 text-sm" data-testid="nurse-collection">
              <div className="mb-1 font-semibold">{t("order.nurse.title")}</div>
              <div>{t("order.nurse.collector")}: {d.nurseCollection.collectorName ?? d.nurseCollection.collectorRef}</div>
              <div className="text-muted-foreground">{t("order.nurse.collectedAt")}: {dt(d.nurseCollection.collectedAt, i18n.language)}</div>
              {d.nurseCollection.handedOverAt ? <div className="text-muted-foreground">{t("order.nurse.handedOverAt")}: {dt(d.nurseCollection.handedOverAt, i18n.language)}</div> : null}
              {d.nurseCollection.receivedAt ? <div className="text-muted-foreground">{t("order.nurse.receivedAt")}: {dt(d.nurseCollection.receivedAt, i18n.language)}</div> : null}
              <div className="mt-1 text-xs text-muted-foreground">{t("order.nurse.note")}</div>
            </div>
          ) : null}
        </Card>
      </div>
      <Card className="mt-4">
        <CardTitle>{t("order.itemsResults")}</CardTitle>
        <Table head={[t("cat.test"), t("order.analyte"), t("order.result"), t("order.range"), t("common.status"), t("common.price")]}>
          {d.items.map((it: any) => {
            const rs = (results.data ?? []).filter((r) => r.orderItemId === it.id && !["CORRECTED", "REJECTED"].includes(r.status));
            if (rs.length === 0) return <tr key={it.id}><Td>{it.test.code} — {it.test.nameEn}</Td><Td>-</Td><Td>-</Td><Td>-</Td><Td><StatusBadge value={it.status} /></Td><Td>{num(it.price)}</Td></tr>;
            return rs.map((r, idx) => (
              <tr key={r.id}>
                <Td>{idx === 0 ? `${it.test.code} — ${it.test.nameEn}` : ""}</Td>
                <Td>{r.analyte.nameEn}</Td>
                <Td className="font-mono">{r.valueNumeric ?? r.valueText} <span className="text-xs text-muted-foreground">{r.unit}</span> <FlagBadge flag={r.flag} />{r.deltaCheckFailed ? <Badge tone="warn" className="ms-1">Δ</Badge> : null}</Td>
                <Td className="text-xs text-muted-foreground">{r.refLow ?? ""} – {r.refHigh ?? ""}</Td>
                <Td><StatusBadge value={r.status} />{r.autoVerified ? <Badge tone="info" className="ms-1">{t("order.auto")}</Badge> : null}</Td>
                <Td>{idx === 0 ? num(it.price) : ""}</Td>
              </tr>
            ));
          })}
        </Table>
        <div className="mt-3 flex flex-wrap gap-2">
          {can("results.medical_validate") && d.items.some(() => (results.data ?? []).some((r) => r.status === "TECH_VALIDATED")) ? <Button onClick={() => medical.mutate()}>{t("order.medicalValidate")}</Button> : null}
          {can("reports.sign") && ready.data?.ready ? <Button variant="pulse" onClick={() => sign.mutate()}>{t("order.sign")}</Button> : null}
        </div>
        {ready.data && !ready.data.ready && can("reports.read") ? <p className="mt-2 text-xs text-muted-foreground">{t("order.notReady", { n: ready.data.blockers.length })}</p> : null}
      </Card>
      {can("reports.read") ? (
        <Card className="mt-4">
          <CardTitle>{t("order.reports")}</CardTitle>
          {reports.data?.length ? (
            <Table head={[t("order.version"), t("order.signedAt"), t("order.correction"), t("order.channels"), ""]}>
              {reports.data.map((r) => (
                <tr key={r.id}>
                  <Td>v{r.version}</Td><Td>{dt(r.signedAt, i18n.language)}</Td><Td className="text-xs">{r.correctionReason ?? "-"}</Td>
                  <Td>{r.releases.map((x: any) => <Badge key={x.channel} tone="ok" className="me-1">{t(`channel.${x.channel}`)}</Badge>)}</Td>
                  <Td className="space-x-2 text-end rtl:space-x-reverse">
                    <Button size="sm" variant="outline" onClick={() => void download(`/reports/${r.id}/pdf`, `${d.orderNumber}-v${r.version}.pdf`)}>PDF</Button>
                    {can("reports.release") && r.version === reports.data[0].version ? <Button size="sm" onClick={() => { setRel(r); setChannels([]); }}>{t("order.release")}</Button> : null}
                  </Td>
                </tr>
              ))}
            </Table>
          ) : <p className="text-sm text-muted-foreground">{t("order.noReports")}</p>}
        </Card>
      ) : null}
      {can("billing.invoice") ? (
        <Card className="mt-4 flex flex-wrap items-center gap-3">
          <CardTitle className="mb-0">{t("order.billing")}</CardTitle>
          {d.invoices.length ? d.invoices.map((i: any) => <Badge key={i.id} tone="info">{i.number} · <StatusBadge value={i.status} /> · {money(i.total, me?.tenant.currency, i18n.language)}</Badge>) : <Button size="sm" onClick={() => invoice.mutate()}>{t("order.createInvoice")}</Button>}
        </Card>
      ) : null}
      <Modal open={Boolean(spec)} onClose={() => setSpec(null)} title={t("spec.details")} wide>{spec ? <SpecimenPanel specimenId={spec} /> : null}</Modal>
      <Modal open={Boolean(rel)} onClose={() => setRel(null)} title={t("order.releaseTitle")}>
        <p className="mb-3 text-sm text-muted-foreground">{t("order.releaseNote")}</p>
        <div className="space-y-2">{CHANNELS.map((c) => { const ok = d.consentShareChannels.includes(c); return <label key={c} className={`flex items-center gap-2 text-sm ${ok ? "" : "opacity-40"}`}><input type="checkbox" disabled={!ok} checked={channels.includes(c)} onChange={() => toggle(channels, setChannels, c)} />{t(`channel.${c}`)}{!ok ? <Badge tone="warn">{t("order.noConsent")}</Badge> : null}</label>; })}</div>
        <div className="mt-4 space-y-2"><ErrorNote error={release.error} /><Button disabled={!channels.length || release.isPending} onClick={() => release.mutate()}>{t("order.release")}</Button></div>
      </Modal>
    </>
  );
}
