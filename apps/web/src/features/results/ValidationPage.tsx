import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Empty, Input, Modal, Spinner, Table, Tabs, Td, useToast } from "@/components/ui";
import { ErrorNote, FlagBadge, PageHeader } from "@/components/common";

/** KLQC04: technical validation (technologist) and medical validation (authorised signatory). Critical and delta-flagged rows stand out. */
export function ValidationPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [stage, setStage] = useState<"tech" | "medical">(can("results.tech_validate") || !can("results.medical_validate") ? "tech" : "medical");
  const [sel, setSel] = useState<string[]>([]);
  const [delta, setDelta] = useState<any>(null);
  const [note, setNote] = useState("");
  const q = useQuery({ queryKey: ["validation", stage], queryFn: () => api<any[]>(`/validation-queue?stage=${stage}`), refetchInterval: 20_000 });
  const done = () => { setSel([]); setDelta(null); setNote(""); void qc.invalidateQueries(); };
  const validate = useMutation({
    mutationFn: async (ids: string[]) => {
      const out: { id: string; error?: unknown }[] = [];
      for (const id of ids) {
        try {
          await api(`/results/${id}/${stage === "tech" ? "tech-validate" : "medical-validate"}`, { body: {} });
          out.push({ id });
        } catch (e) { out.push({ id, error: e }); }
      }
      return out;
    },
    onSuccess: (r) => { toast(t("valid.done", { ok: r.filter((x) => !x.error).length, failed: r.filter((x) => x.error).length }), r.some((x) => x.error) ? "warn" : "ok"); done(); },
  });
  const ack = useMutation({ mutationFn: () => api(`/results/${delta.id}/tech-validate`, { body: { deltaAcknowledged: true, note } }), onSuccess: done });
  const rows = q.data ?? [];
  const allowed = stage === "tech" ? can("results.tech_validate") : can("results.medical_validate");
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <>
      <PageHeader title={t("valid.title")} sub={t("valid.sub")} />
      <Tabs value={stage} onChange={(v) => { setStage(v as "tech" | "medical"); setSel([]); }} tabs={[{ id: "tech", label: t("valid.tech") }, { id: "medical", label: t("valid.medical") }]} />
      {stage === "medical" && !can("results.medical_validate") ? <p className="mb-3 rounded-md bg-[hsl(var(--warning)/0.12)] p-2 text-sm text-[hsl(var(--warning))]">{t("valid.signatoryOnly")}</p> : null}
      {q.isLoading ? <Spinner /> : !rows.length ? <Empty>{t("valid.empty")}</Empty> : (
        <>
          <Table head={[allowed ? <input key="all" type="checkbox" aria-label="select all" checked={sel.length === rows.length} onChange={(e) => setSel(e.target.checked ? rows.map((r) => r.id) : [])} /> : "", t("orders.number"), t("orders.patient"), t("order.analyte"), t("order.result"), t("order.range"), t("valid.checks")]}>
            {rows.map((r) => {
              const blocked = stage === "tech" && ((r.source === "MANUAL" && !r.secondEntryBy));
              return (
                <tr key={r.id} className={r.flag.startsWith("CRITICAL") ? "bg-[hsl(var(--danger-text)/0.12)] " : ""}>
                  <Td>{allowed ? <input type="checkbox" checked={sel.includes(r.id)} disabled={blocked} onChange={() => toggle(r.id)} aria-label={`select ${r.analyte.code}`} /> : null}</Td>
                  <Td><Link className="font-mono text-primary underline" to={`/orders/${r.orderItem.order.id}`}>{r.orderItem.order.orderNumber}</Link></Td>
                  <Td>{r.orderItem.order.patient.fullName}</Td>
                  <Td>{r.analyte.nameEn}</Td>
                  <Td className="font-mono">{r.valueNumeric ?? r.valueText} <span className="text-xs text-muted-foreground">{r.unit}</span> <FlagBadge flag={r.flag} /></Td>
                  <Td className="text-xs text-muted-foreground">{r.refLow ?? ""}–{r.refHigh ?? ""}</Td>
                  <Td className="space-x-1 rtl:space-x-reverse">
                    {r.source === "MANUAL" ? <Badge tone={r.secondEntryBy ? "ok" : "warn"}>{r.secondEntryBy ? t("valid.dualOk") : t("work.dualPending")}</Badge> : <Badge tone="info">{t("valid.analyzer")}</Badge>}
                    {r.deltaCheckFailed ? <Badge tone="warn">Δ {r.deltaPercent}%</Badge> : null}
                    {r.deltaCheckFailed && stage === "tech" && allowed ? <Button size="sm" variant="outline" onClick={() => setDelta(r)}>{t("valid.review")}</Button> : null}
                  </Td>
                </tr>
              );
            })}
          </Table>
          {allowed ? <div className="mt-3 flex items-center gap-3"><Button disabled={!sel.length || validate.isPending} onClick={() => validate.mutate(sel)}>{stage === "tech" ? t("valid.validateTech", { n: sel.length }) : t("valid.validateMedical", { n: sel.length })}</Button></div> : null}
        </>
      )}
      <Modal open={Boolean(delta)} onClose={() => setDelta(null)} title={t("valid.deltaTitle")}>
        <p className="mb-3 text-sm">{t("valid.deltaBody", { pct: delta?.deltaPercent })}</p>
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("valid.deltaNote")} aria-label={t("valid.deltaNote")} />
        <div className="mt-3 space-y-2"><ErrorNote error={ack.error} /><Button disabled={note.trim().length < 5} onClick={() => ack.mutate()}>{t("valid.acknowledge")}</Button></div>
      </Modal>
    </>
  );
}
