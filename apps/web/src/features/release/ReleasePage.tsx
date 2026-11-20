import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileSignature, Send, ShieldCheck } from "lucide-react";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Modal, useToast } from "@/components/ui";
import { ErrorNote, PageHeader, ResultValue } from "@/components/common";
import { PdfPreview } from "@/components/kit";
import { EmptyState, Skeleton, Surface, kcn } from "@/brand/ui-kit";

const CHANNELS = ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"];

/** Sign-off summary shown before an authorised signatory signs: patient, results with flags, blockers. */
function SignSummary({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const results = useQuery({ queryKey: ["order-results", orderId], queryFn: () => api<any[]>(`/orders/${orderId}/results`) });
  const ready = useQuery({ queryKey: ["order-ready", orderId], queryFn: () => api<any>(`/orders/${orderId}/report-readiness`) });
  const rs = (results.data ?? []).filter((r) => !["CORRECTED", "REJECTED"].includes(r.status));
  const abn = rs.filter((r) => r.flag && r.flag !== "NORMAL").length;
  const crit = rs.filter((r) => r.flag?.startsWith("CRITICAL")).length;
  if (results.isLoading) return <div role="status" aria-busy="true" className="space-y-2"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-6" /></div>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge tone="info">{t("ux.release.results", { n: rs.length })}</Badge>
        {abn ? <Badge tone="warn">{t("ux.release.abnormal", { n: abn })}</Badge> : <Badge tone="ok">{t("ux.release.allNormal")}</Badge>}
        {crit ? <Badge tone="crit">{t("ux.release.critical", { n: crit })}</Badge> : null}
      </div>
      <ul className="max-h-64 divide-y divide-border/70 overflow-auto rounded-lg border border-border/80">
        {rs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{r.analyte.nameEn}</span>
            <ResultValue value={r.valueNumeric ?? r.valueText} unit={r.unit} flag={r.flag} />
          </li>
        ))}
      </ul>
      {ready.data && !ready.data.ready ? <p role="alert" className="rounded-lg bg-[hsl(var(--warning)/0.12)] p-2 text-sm text-[hsl(var(--warning))]">{t("order.notReady", { n: ready.data.blockers.length })}</p> : null}
    </div>
  );
}

/** KLCRIT02/03: release queue. Signing needs an authorised signatory; every channel needs recorded consent. */
export function ReleasePage() {
  const { t } = useTranslation();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [rel, setRel] = useState<any>(null);
  const [signing, setSigning] = useState<any>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const q = useQuery({ queryKey: ["release-queue"], queryFn: () => api<any>("/release-queue"), refetchInterval: 20_000 });
  const sign = useMutation({ mutationFn: (orderId: string) => api<any>(`/orders/${orderId}/reports`, { body: {} }), onSuccess: () => { setSigning(null); void qc.invalidateQueries(); toast(t("order.signed")); } });
  const release = useMutation({ mutationFn: () => api<any>(`/reports/${rel.reportId}/release`, { body: { channels } }), onSuccess: () => { setRel(null); void qc.invalidateQueries(); toast(t("order.released")); } });
  if (q.isLoading || !q.data) return <div role="status" aria-busy="true" className="space-y-4"><Skeleton className="h-8 w-1/3" /><div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-56" /><Skeleton className="h-56" /></div></div>;
  const toSign: any[] = q.data.readyToSign, toRelease: any[] = q.data.signedNotReleased;
  return (
    <>
      <PageHeader title={t("release.title")} sub={t("release.sub")} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Surface className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3"><h3 className="text-sm font-semibold">{t("release.readyToSign")}</h3><span className="text-xs tabular-nums text-muted-foreground">{toSign.length}</span></div>
          {toSign.length === 0 ? <EmptyState compact className="m-4" title={t("common.none")} /> : (
            <ul className="divide-y divide-border/70">
              {toSign.map((r) => (
                <li key={r.orderId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0"><Link to={`/orders/${r.orderId}`} className="font-mono text-sm font-semibold text-primary underline-offset-4 hover:underline">{r.orderNumber}</Link><div className="truncate text-sm text-muted-foreground" dir="auto">{r.patient}</div></div>
                  {can("reports.sign") ? <Button size="sm" variant="pulse" onClick={() => setSigning(r)}><FileSignature aria-hidden className="size-4" />{t("order.sign")}</Button> : <Badge>{t("release.signatoryOnly")}</Badge>}
                </li>
              ))}
            </ul>
          )}
          <div className="px-4 pb-3"><ErrorNote error={sign.error} /></div>
        </Surface>
        <Surface className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border/70 px-4 py-3"><h3 className="text-sm font-semibold">{t("release.signedNotReleased")}</h3><span className="text-xs tabular-nums text-muted-foreground">{toRelease.length}</span></div>
          {toRelease.length === 0 ? <EmptyState compact className="m-4" title={t("common.none")} /> : (
            <ul className="divide-y divide-border/70">
              {toRelease.map((r) => (
                <li key={r.reportId} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0"><Link to={`/orders/${r.orderId}`} className="font-mono text-sm font-semibold text-primary underline-offset-4 hover:underline">{r.orderNumber}</Link> <span className="text-xs text-muted-foreground tabular-nums">v{r.version}</span><div className="truncate text-sm text-muted-foreground" dir="auto">{r.patient}</div></div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void download(`/reports/${r.reportId}/pdf`, `${r.orderNumber}-v${r.version}.pdf`)}>PDF</Button>
                      {can("reports.release") ? <Button size="sm" onClick={() => { setRel(r); setChannels([]); }}>{t("order.release")}</Button> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">{r.consent.length ? r.consent.map((c: string) => <Badge key={c} tone="ok">{t(`channel.${c}`)}</Badge>) : <Badge tone="warn">{t("order.noConsent")}</Badge>}</div>
                </li>
              ))}
            </ul>
          )}
        </Surface>
      </div>
      <Surface className="mt-4 flex items-start gap-3 p-4 text-sm text-muted-foreground"><ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />{t("release.guardNote")}</Surface>

      <Modal open={Boolean(signing)} onClose={() => setSigning(null)} title={`${t("ux.release.signTitle")} · ${signing?.orderNumber ?? ""}`} wide>
        {signing ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("ux.release.signNote", { patient: signing.patient })}</p>
            <SignSummary orderId={signing.orderId} />
            <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm"><FileSignature aria-hidden className="size-4 text-primary" /><span>{t("ux.release.signedAs", { name: me?.user.displayName ?? "" })}</span></div>
            <ErrorNote error={sign.error} />
            <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setSigning(null)}>{t("ux.cancel")}</Button><Button variant="pulse" disabled={sign.isPending} onClick={() => sign.mutate(signing.orderId)}>{t("order.sign")}</Button></div>
          </div>
        ) : null}
      </Modal>

      <Modal open={Boolean(rel)} onClose={() => setRel(null)} title={`${t("order.releaseTitle")} · ${rel?.orderNumber ?? ""}`} xl>
        {rel ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <PdfPreview path={`/reports/${rel.reportId}/pdf`} title={t("ux.preview.title")} filename={`${rel.orderNumber}-v${rel.version}.pdf`} onDownload={() => void download(`/reports/${rel.reportId}/pdf`, `${rel.orderNumber}-v${rel.version}.pdf`)} />
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("order.releaseNote")}</p>
              <div className="space-y-2">{CHANNELS.map((c) => { const ok = rel.consent.includes(c); return <label key={c} className={kcn("flex min-h-11 items-center gap-3 rounded-lg border border-border/80 px-3 text-sm", ok ? "bg-card" : "bg-muted/40 opacity-60")}><input type="checkbox" className="size-4" disabled={!ok} checked={channels.includes(c)} onChange={() => setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} />{t(`channel.${c}`)}{!ok ? <Badge tone="warn" className="ms-auto">{t("order.noConsent")}</Badge> : null}</label>; })}</div>
              <ErrorNote error={release.error} />
              <Button className="w-full" disabled={!channels.length || release.isPending} onClick={() => release.mutate()}><Send aria-hidden className="size-4" />{t("order.release")}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
