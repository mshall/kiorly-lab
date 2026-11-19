import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, CardTitle, Empty, Modal, Spinner, Table, Td, useToast } from "@/components/ui";
import { ErrorNote, PageHeader } from "@/components/common";

const CHANNELS = ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"];

/** KLCRIT02/03: release queue. Signing needs an authorised signatory; every channel needs recorded consent. */
export function ReleasePage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [rel, setRel] = useState<any>(null);
  const [channels, setChannels] = useState<string[]>([]);
  const q = useQuery({ queryKey: ["release-queue"], queryFn: () => api<any>("/release-queue"), refetchInterval: 20_000 });
  const sign = useMutation({ mutationFn: (orderId: string) => api(`/orders/${orderId}/reports`, { body: {} }), onSuccess: () => { void qc.invalidateQueries(); toast(t("order.signed")); } });
  const release = useMutation({ mutationFn: () => api<any>(`/reports/${rel.reportId}/release`, { body: { channels } }), onSuccess: () => { setRel(null); void qc.invalidateQueries(); toast(t("order.released")); } });
  if (q.isLoading || !q.data) return <Spinner />;
  return (
    <>
      <PageHeader title={t("release.title")} sub={t("release.sub")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>{t("release.readyToSign")}</CardTitle>
          {q.data.readyToSign.length === 0 ? <Empty>{t("common.none")}</Empty> : (
            <Table head={[t("orders.number"), t("orders.patient"), ""]}>
              {q.data.readyToSign.map((r: any) => (
                <tr key={r.orderId}><Td><Link to={`/orders/${r.orderId}`} className="font-mono text-primary underline">{r.orderNumber}</Link></Td><Td>{r.patient}</Td>
                  <Td className="text-end">{can("reports.sign") ? <Button size="sm" variant="pulse" disabled={sign.isPending} onClick={() => sign.mutate(r.orderId)}>{t("order.sign")}</Button> : <Badge>{t("release.signatoryOnly")}</Badge>}</Td></tr>
              ))}
            </Table>
          )}
          <div className="mt-2"><ErrorNote error={sign.error} /></div>
        </Card>
        <Card>
          <CardTitle>{t("release.signedNotReleased")}</CardTitle>
          {q.data.signedNotReleased.length === 0 ? <Empty>{t("common.none")}</Empty> : (
            <Table head={[t("orders.number"), t("orders.patient"), t("orders.consent"), ""]}>
              {q.data.signedNotReleased.map((r: any) => (
                <tr key={r.reportId}><Td><Link to={`/orders/${r.orderId}`} className="font-mono text-primary underline">{r.orderNumber}</Link> v{r.version}</Td><Td>{r.patient}</Td>
                  <Td>{r.consent.length ? r.consent.map((c: string) => <Badge key={c} tone="ok" className="me-1">{t(`channel.${c}`)}</Badge>) : <Badge tone="warn">{t("order.noConsent")}</Badge>}</Td>
                  <Td className="space-x-1 text-end rtl:space-x-reverse"><Button size="sm" variant="outline" onClick={() => void download(`/reports/${r.reportId}/pdf`, `${r.orderNumber}-v${r.version}.pdf`)}>PDF</Button>{can("reports.release") ? <Button size="sm" onClick={() => { setRel(r); setChannels([]); }}>{t("order.release")}</Button> : null}</Td></tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      <Card className="mt-4 text-sm text-muted-foreground">{t("release.guardNote")}</Card>
      <Modal open={Boolean(rel)} onClose={() => setRel(null)} title={t("order.releaseTitle")}>
        <p className="mb-3 text-sm text-muted-foreground">{t("order.releaseNote")}</p>
        <div className="space-y-2">{CHANNELS.map((c) => { const ok = rel?.consent.includes(c); return <label key={c} className={`flex items-center gap-2 text-sm ${ok ? "" : "opacity-40"}`}><input type="checkbox" disabled={!ok} checked={channels.includes(c)} onChange={() => setChannels((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]))} />{t(`channel.${c}`)}{!ok ? <Badge tone="warn">{t("order.noConsent")}</Badge> : null}</label>; })}</div>
        <div className="mt-4 space-y-2"><ErrorNote error={release.error} /><Button disabled={!channels.length || release.isPending} onClick={() => release.mutate()}>{t("order.release")}</Button></div>
      </Modal>
    </>
  );
}
