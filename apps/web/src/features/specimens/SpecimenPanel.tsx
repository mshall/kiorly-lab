import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { printLabel } from "@/lib/print";
import { Badge, Button, Card, Field, Input, Select, Spinner } from "@/components/ui";
import { ErrorNote, StatusBadge } from "@/components/common";

const REJECT = ["HAEMOLYSED", "INSUFFICIENT_VOLUME", "MISLABELLED", "WRONG_CONTAINER", "CLOTTED", "OTHER"];

/** Specimen detail with scan-gated custody actions (label match is enforced by the API: a wrong scan is blocked and logged). */
export function SpecimenPanel({ specimenId, onChanged }: { specimenId: string; onChanged?: () => void }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [scan, setScan] = useState("");
  const [temp, setTemp] = useState("");
  const [reason, setReason] = useState("HAEMOLYSED");
  const [aliquots, setAliquots] = useState("2");
  const q = useQuery({ queryKey: ["specimen", specimenId], queryFn: () => api<any>(`/specimens/${specimenId}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["specimen", specimenId] });
    void qc.invalidateQueries();
    onChanged?.();
  };
  const act = useMutation({
    mutationFn: (a: string) => api(`/specimens/${specimenId}/${a}`, { body: { scannedBarcode: scan || undefined, temperatureC: temp ? Number(temp) : undefined } }),
    onSuccess: () => { setScan(""); refresh(); },
    onError: () => refresh(),
  });
  const reject = useMutation({ mutationFn: () => api(`/specimens/${specimenId}/reject`, { body: { reason } }), onSuccess: refresh });
  const aliq = useMutation({ mutationFn: () => api(`/specimens/${specimenId}/aliquots`, { body: { count: Number(aliquots) } }), onSuccess: refresh });
  const print = useMutation({ mutationFn: () => api<any>(`/specimens/${specimenId}/label/print`, { method: "POST", body: {} }), onSuccess: (l) => { printLabel(l); refresh(); } });
  if (q.isLoading || !q.data) return <Spinner />;
  const s = q.data;
  const next: { action: string; perm: string }[] = {
    PENDING_COLLECTION: [{ action: "collect", perm: "specimens.collect" }],
    COLLECTED: [{ action: "transport", perm: "specimens.collect" }, { action: "receive", perm: "specimens.receive" }],
    IN_TRANSIT: [{ action: "receive", perm: "specimens.receive" }],
    RECEIVED: [{ action: "process", perm: "specimens.process" }, { action: "store", perm: "specimens.process" }],
    PROCESSING: [{ action: "store", perm: "specimens.process" }, { action: "dispose", perm: "specimens.process" }],
    STORED: [{ action: "dispose", perm: "specimens.process" }],
  }[s.status as string]?.filter((x) => can(x.perm)) ?? [];
  const needsScan = (a: string) => ["collect", "receive", "process"].includes(a);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-lg font-bold">{s.accessionNumber}</span>
        <StatusBadge value={s.status} />
        <Badge>{s.specimenType}{s.container ? ` · ${s.container}` : ""}</Badge>
        {s.parentSpecimenId ? <Badge tone="info">{t("spec.aliquot")}</Badge> : null}
        {s.recollectOfId ? <Badge tone="warn">{t("spec.recollection")}</Badge> : null}
        <span className="text-sm text-muted-foreground">{s.order.patient.fullName}</span>
      </div>
      {s.order.identityVerified === false && s.status === "PENDING_COLLECTION" ? <p className="rounded-md bg-[hsl(var(--warning)/0.12)] p-2 text-sm text-[hsl(var(--warning))]">{t("spec.identityFirst")}</p> : null}
      {next.length > 0 ? (
        <Card className="space-y-3">
          <Field label={t("spec.scanLabel")} hint={t("spec.scanHint")}>
            <Input autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder={s.barcode.replace(/./g, "•")} inputMode="text" aria-label={t("spec.scanLabel")} />
          </Field>
          <Field label={t("spec.temperature")}><Input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} className="max-w-[10rem]" /></Field>
          <div className="flex flex-wrap gap-2">
            {next.map((n) => <Button key={n.action} onClick={() => act.mutate(n.action)} disabled={act.isPending || (needsScan(n.action) && !scan)}>{t(`spec.action.${n.action}`)}</Button>)}
          </div>
          <ErrorNote error={act.error} />
        </Card>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        {can("specimens.label") ? <Button variant="outline" onClick={() => print.mutate()}><Printer className="h-4 w-4" />{t("spec.printLabel")} ({s.labelsPrinted})</Button> : null}
        {can("specimens.reject") && !["REJECTED", "DISPOSED", "STORED"].includes(s.status) ? (
          <div className="flex items-end gap-2">
            <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("spec.reason")}>{REJECT.map((r) => <option key={r} value={r}>{t(`spec.reasons.${r}`)}</option>)}</Select>
            <Button variant="destructive" onClick={() => reject.mutate()}>{t("spec.reject")}</Button>
          </div>
        ) : null}
        {can("specimens.process") && ["RECEIVED", "PROCESSING", "STORED"].includes(s.status) ? (
          <div className="flex items-end gap-2"><Input type="number" min={1} max={20} value={aliquots} onChange={(e) => setAliquots(e.target.value)} className="w-20" aria-label={t("spec.aliquots")} /><Button variant="secondary" onClick={() => aliq.mutate()}>{t("spec.makeAliquots")}</Button></div>
        ) : null}
      </div>
      <ErrorNote error={reject.error ?? aliq.error ?? print.error} />
      <div>
        <h4 className="mb-2 text-sm font-semibold">{t("spec.custody")}</h4>
        <ol className="relative ms-2 space-y-4 border-s-2 border-border ps-5 text-sm" aria-label={t("spec.custody")}>
          {s.custody.map((c: any, i: number) => {
            const bad = c.type === "LABEL_MISMATCH_BLOCKED";
            const latest = i === s.custody.length - 1;
            return (
              <li key={c.id} className="relative">
                <span aria-hidden="true" className={`absolute -start-[1.72rem] top-1 grid size-3.5 place-items-center rounded-full ring-4 ring-card ${bad ? "bg-[hsl(var(--danger-text))]" : latest ? "bg-primary" : "bg-[hsl(var(--success))]"}`} />
                <div className={`font-semibold ${bad ? "text-[hsl(var(--danger-text))]" : ""}`}>{t(`spec.event.${c.type}`)}{bad ? <span className="ms-2 rounded-full bg-[hsl(var(--danger-text)/0.12)] px-2 py-0.5 text-xs">{t("spec.blocked")}</span> : null}</div>
                <div className="text-xs tabular-nums text-muted-foreground">{dt(c.occurredAt, i18n.language)}{c.temperatureC != null ? ` · ${c.temperatureC}°C` : ""}{c.note ? ` · ${c.note}` : ""}</div>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">{t("spec.appendOnly")}</p>
      </div>
    </div>
  );
}
