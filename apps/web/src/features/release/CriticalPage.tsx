import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, CardTitle, Empty, Input, Modal, Spinner, Table, Td, useToast } from "@/components/ui";
import { ErrorNote, FlagBadge, PageHeader, StatusBadge } from "@/components/common";

function Countdown({ to }: { to: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const ms = new Date(to).getTime() - now;
  const m = Math.floor(Math.abs(ms) / 60000);
  const s = Math.floor((Math.abs(ms) % 60000) / 1000);
  return <span className={ms < 0 ? "font-semibold text-[hsl(var(--danger-text))]" : "font-mono"}>{ms < 0 ? t("crit.overdue", { m, s }) : `${m}:${String(s).padStart(2, "0")}`}</span>;
}

/** KLCRIT01: critical-value alerts with acknowledgement window and escalation. There is no switch to disable any of this (ADR-025). */
export function CriticalPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [ack, setAck] = useState<any>(null);
  const [note, setNote] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [form, setForm] = useState({ low: "", high: "", minutes: "30" });
  const q = useQuery({ queryKey: ["critical-alerts"], queryFn: () => api<any[]>("/critical-alerts"), refetchInterval: 15_000 });
  const rules = useQuery({ queryKey: ["critical-rules"], queryFn: () => api<any[]>("/critical-rules"), enabled: can("critical.read") });
  const analytes = useQuery({ queryKey: ["analytes"], queryFn: () => api<any[]>("/catalogue/analytes"), enabled: can("critical.configure") });
  const doAck = useMutation({ mutationFn: () => api(`/critical-alerts/${ack.id}/ack`, { body: { note: note || undefined } }), onSuccess: () => { setAck(null); setNote(""); void qc.invalidateQueries(); toast(t("crit.acked")); } });
  const save = useMutation({ mutationFn: () => api(`/analytes/${edit.id}/critical-rule`, { method: "PUT", body: { criticalLow: form.low === "" ? null : Number(form.low), criticalHigh: form.high === "" ? null : Number(form.high), ackWithinMinutes: Number(form.minutes) } }), onSuccess: () => { setEdit(null); void qc.invalidateQueries(); toast(t("common.saved")); } });
  return (
    <>
      <PageHeader title={t("crit.title")} sub={t("crit.sub")} />
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty>{t("crit.none")}</Empty> : (
        <Table head={[t("order.analyte"), t("common.status"), t("crit.deadline"), t("crit.level"), ""]}>
          {q.data.map((a) => (
            <tr key={a.id} className={a.status === "ESCALATED" ? "bg-[hsl(var(--danger-text)/0.12)] " : ""}>
              <Td>{a.result.analyte.nameEn} <FlagBadge flag={a.result.flag} /> {a.orderId ? <Link className="ms-2 text-xs text-primary underline" to={`/orders/${a.orderId}`}>{t("spec.order")}</Link> : null}</Td>
              <Td><StatusBadge value={a.status} /></Td>
              <Td><Countdown to={a.ackDeadlineAt} /></Td>
              <Td>{a.escalationLevel > 0 ? <Badge tone="crit">{t("crit.escalatedTo", { n: a.escalationLevel })}</Badge> : "-"}</Td>
              <Td className="text-end">{can("critical.ack") ? <Button size="sm" onClick={() => setAck(a)}>{t("crit.ack")}</Button> : null}</Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t("crit.noRawValues")}</p>
      {can("critical.read") ? (
        <Card className="mt-6">
          <CardTitle>{t("crit.rules")}</CardTitle>
          {rules.data?.length ? (
            <Table head={[t("order.analyte"), t("crit.low"), t("crit.high"), t("crit.window"), ""]}>
              {rules.data.map((r) => (
                <tr key={r.id}><Td>{r.analyte.nameEn}</Td><Td>{r.criticalLow ?? "-"}</Td><Td>{r.criticalHigh ?? "-"}</Td><Td>{r.ackWithinMinutes} {t("crit.min")}</Td>
                  <Td className="text-end">{can("critical.configure") ? <Button size="sm" variant="outline" onClick={() => { setEdit(r.analyte); setForm({ low: r.criticalLow ?? "", high: r.criticalHigh ?? "", minutes: String(r.ackWithinMinutes) }); }}>{t("common.edit")}</Button> : null}</Td></tr>
              ))}
            </Table>
          ) : <Empty>{t("common.none")}</Empty>}
          {can("critical.configure") ? <div className="mt-3"><select className="h-9 rounded-md border border-input bg-card px-2 text-sm" aria-label={t("crit.addRule")} value="" onChange={(e) => { const a = analytes.data?.find((x) => x.id === e.target.value); if (a) { setEdit(a); setForm({ low: "", high: "", minutes: "30" }); } }}><option value="">{t("crit.addRule")}</option>{analytes.data?.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameEn}</option>)}</select></div> : null}
          <p className="mt-3 text-xs text-muted-foreground">{t("crit.signoffNote")}</p>
        </Card>
      ) : null}
      <Modal open={Boolean(ack)} onClose={() => setAck(null)} title={t("crit.ackTitle")}>
        <p className="mb-3 text-sm text-muted-foreground">{t("crit.ackBody")}</p>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("crit.ackNote")} aria-label={t("crit.ackNote")} />
        <div className="mt-3 space-y-2"><ErrorNote error={doAck.error} /><Button onClick={() => doAck.mutate()} disabled={doAck.isPending}>{t("crit.ack")}</Button></div>
      </Modal>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `${edit.code} — ${t("crit.rules")}` : ""}>
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs">{t("crit.low")}<Input type="number" step="any" value={form.low} onChange={(e) => setForm({ ...form, low: e.target.value })} /></label>
          <label className="text-xs">{t("crit.high")}<Input type="number" step="any" value={form.high} onChange={(e) => setForm({ ...form, high: e.target.value })} /></label>
          <label className="text-xs">{t("crit.window")}<Input type="number" min={1} max={1440} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} /></label>
        </div>
        <div className="mt-3 space-y-2"><ErrorNote error={save.error} /><Button onClick={() => save.mutate()} disabled={save.isPending}>{t("common.save")}</Button></div>
      </Modal>
    </>
  );
}
