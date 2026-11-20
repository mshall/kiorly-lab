import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pencil, Printer, Tags } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { ErrorNote } from "@/components/common";

/** Order detail extras: clinical info + ICD, fasting, referrer, edit with revision history, add/remove tests, labels (1D + QR), amendments timeline, deliveries. */
export function OrderExtras({ order: d, results }: { order: any; results: any[] }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState<any>(null);
  const [labels, setLabels] = useState(false);
  const [add, setAdd] = useState("");
  const revs = useQuery({ queryKey: ["order-revs", d.id], queryFn: () => api<any[]>(`/orders/${d.id}/revisions`), enabled: d.revision > 0 });
  const amend = useQuery({ queryKey: ["order-amend", d.id], queryFn: () => api<any>(`/orders/${d.id}/amendments`), enabled: can("results.read") && ["RELEASED", "VALIDATED"].includes(d.status) });
  const lbl = useQuery({ queryKey: ["order-labels", d.id], queryFn: () => api<any[]>(`/orders/${d.id}/labels`), enabled: labels });
  const referrers = useQuery({ queryKey: ["referrers-pick"], queryFn: () => api<any[]>("/referrers?active=true"), enabled: Boolean(edit) && can("referrers.read") });
  const icd = useQuery({ queryKey: ["icd", edit?.icdQ], queryFn: () => api<any[]>(`/icd/search?q=${encodeURIComponent(edit.icdQ)}`), enabled: Boolean(edit) && (edit.icdQ?.length ?? 0) >= 1 });
  const tests = useQuery({ queryKey: ["tests"], queryFn: () => api<any[]>("/catalogue/tests"), enabled: can("orders.edit") });
  const refresh = () => void qc.invalidateQueries();
  const save = useMutation({ mutationFn: () => api(`/orders/${d.id}`, { method: "PUT", body: { priority: edit.priority, clinicalInfo: edit.clinicalInfo || null, icdCodes: edit.icdCodes, fastingConfirmed: edit.fasting === "" ? null : edit.fasting === "yes", referrerId: edit.referrerId || null, reason: edit.reason || undefined } }), onSuccess: () => { setEdit(null); refresh(); toast(t("common.saved")); } });
  const addTest = useMutation({ mutationFn: () => api(`/orders/${d.id}/tests`, { body: { testCodes: [add] } }), onSuccess: () => { setAdd(""); refresh(); toast(t("common.saved")); } });
  const rmTest = useMutation({ mutationFn: (itemId: string) => api(`/orders/${d.id}/tests/${itemId}?reason=${encodeURIComponent("removed at desk")}`, { method: "DELETE" }), onSuccess: refresh });
  const editable = can("orders.edit") && !["CANCELLED", "RELEASED"].includes(d.status);
  const fastingNeeded = d.items.some((i: any) => i.test.fastingRequired);
  return (
    <>
      <Card className="space-y-2">
        <div className="flex items-center justify-between"><CardTitle>{t("oe.clinical")}</CardTitle>{editable ? <Button size="sm" variant="ghost" onClick={() => setEdit({ priority: d.priority, clinicalInfo: d.clinicalInfo ?? "", icdCodes: d.icdCodes ?? [], fasting: d.fastingConfirmed == null ? "" : d.fastingConfirmed ? "yes" : "no", referrerId: d.referrerId ?? "", reason: "", icdQ: "" })}><Pencil aria-hidden className="size-3.5" />{t("common.edit")}</Button> : null}</div>
        <p className="whitespace-pre-wrap text-sm" dir="auto">{d.clinicalInfo || <span className="text-muted-foreground">-</span>}</p>
        <div className="flex flex-wrap gap-1">{(d.icdCodes ?? []).map((c: string) => <Badge key={c} tone="info">{c}</Badge>)}{fastingNeeded ? <Badge tone={d.fastingConfirmed === false ? "crit" : d.fastingConfirmed ? "ok" : "warn"}>{d.fastingConfirmed === false ? t("oe.notFasting") : d.fastingConfirmed ? t("oe.fastingOk") : t("oe.fastingRequired")}</Badge> : null}{d.referringDoctorName ? <Badge tone="muted">{d.referringDoctorName}</Badge> : null}</div>
        {d.cancelReason ? <p className="text-xs text-muted-foreground">{t("oe.cancelReason")}: <span dir="auto">{d.cancelReason}</span></p> : null}
      </Card>
      {editable ? (
        <Card className="space-y-2">
          <CardTitle>{t("oe.tests")}</CardTitle>
          <div className="flex gap-2"><Select value={add} onChange={(e) => setAdd(e.target.value)} aria-label={t("oe.addTest")}><option value="">{t("oe.addTest")}</option>{(tests.data ?? []).filter((x) => !d.items.some((i: any) => i.test.code === x.code && i.status !== "CANCELLED")).slice(0, 400).map((x) => <option key={x.id} value={x.code}>{x.code} · {x.nameEn}</option>)}</Select><Button size="sm" disabled={!add || addTest.isPending} onClick={() => addTest.mutate()}>{t("common.add")}</Button></div>
          <ErrorNote error={addTest.error ?? rmTest.error} />
          <ul className="space-y-1 text-xs">{d.items.filter((i: any) => i.status === "PENDING" && !i.packageCode && !results.some((r) => r.orderItemId === i.id)).map((i: any) => <li key={i.id} className="flex items-center justify-between"><span><span className="font-mono">{i.test.code}</span> {i.test.nameEn}</span><Button size="sm" variant="ghost" onClick={() => rmTest.mutate(i.id)}>{t("common.remove")}</Button></li>)}</ul>
        </Card>
      ) : null}
      {can("specimens.read") && d.specimens.length ? <Button variant="outline" size="sm" onClick={() => setLabels(true)}><Tags aria-hidden className="size-4" />{t("oe.labels")}</Button> : null}
      {d.revision > 0 && revs.data?.length ? (
        <Card><CardTitle>{t("oe.history")}</CardTitle><ul className="space-y-1 text-xs text-muted-foreground">{revs.data.map((r) => <li key={r.id}>#{r.revision} · {dt(r.at, i18n.language)} · {Object.keys(r.changes).map((k) => t(`oe.fields.${k}`, { defaultValue: k })).join(", ")}{r.reason ? ` — ${r.reason}` : ""}</li>)}</ul></Card>
      ) : null}
      {amend.data?.corrections?.length ? (
        <Card><CardTitle>{t("oe.amendments")}</CardTitle>
          <ul className="space-y-2 text-xs">{amend.data.corrections.map((c: any) => <li key={c.resultId}><span className="font-semibold">{c.analyte.code}</span>: <span className="tabular-nums line-through">{String(c.from?.value ?? "")}</span> → <span className="font-semibold tabular-nums">{String(c.to.value ?? "")}</span> · <span dir="auto">{c.reason}</span></li>)}</ul>
          <p className="mt-2 text-xs text-muted-foreground">{t("oe.versions", { n: amend.data.versions.length })}</p>
        </Card>
      ) : null}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={t("oe.editOrder")} wide>
        {edit ? <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("orders.priority")}><Select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{["ROUTINE", "URGENT", "STAT"].map((p) => <option key={p} value={p}>{t(`ux.priority.${p}`, { defaultValue: p })}</option>)}</Select></Field>
            {can("referrers.read") ? <Field label={t("ref.referrer")}><Select value={edit.referrerId} onChange={(e) => setEdit({ ...edit, referrerId: e.target.value })}><option value="">-</option>{(referrers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field> : null}
            {fastingNeeded ? <Field label={t("oe.fasting")}><Select value={edit.fasting} onChange={(e) => setEdit({ ...edit, fasting: e.target.value })}><option value="">-</option><option value="yes">{t("oe.fastingYes")}</option><option value="no">{t("oe.fastingNo")}</option></Select></Field> : null}
          </div>
          <Field label={t("oe.clinical")}><Textarea rows={3} value={edit.clinicalInfo} onChange={(e) => setEdit({ ...edit, clinicalInfo: e.target.value })} dir="auto" /></Field>
          <Field label={t("oe.icd")} hint={t("oe.icdHint")}>
            <div className="space-y-2"><Input value={edit.icdQ} onChange={(e) => setEdit({ ...edit, icdQ: e.target.value })} placeholder="E11 / thyroid / سكر" />
              <div className="flex flex-wrap gap-1">{(icd.data ?? []).map((h) => <button key={h.code} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-accent" onClick={() => setEdit({ ...edit, icdCodes: [...new Set([...edit.icdCodes, h.code])] })}>{h.code} · {i18n.language === "ar" ? h.ar : h.en}</button>)}</div>
              <div className="flex flex-wrap gap-1">{edit.icdCodes.map((c: string) => <Badge key={c} tone="info">{c}<button type="button" aria-label={t("common.remove")} className="ms-1" onClick={() => setEdit({ ...edit, icdCodes: edit.icdCodes.filter((x: string) => x !== c) })}>×</button></Badge>)}</div></div>
          </Field>
          <Field label={t("oe.reason")}><Input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} /></Field>
          <ErrorNote error={save.error} /><Button disabled={save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button>
        </div> : null}
      </Modal>
      <Modal open={labels} onClose={() => setLabels(false)} title={t("oe.labels")} xl>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">{(lbl.data ?? []).map((l) => (
            <figure key={l.specimenId} className="rounded-lg border border-slate-300 bg-white p-3 text-slate-900" style={{ colorScheme: "light" }}>
              <div className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-bold" dir="auto">{l.patientName}</span><span className="text-[10px] font-semibold uppercase text-slate-500">{l.specimenType}</span></div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-600">{l.tests.join(" · ")}{l.fasting ? <span className="rounded bg-amber-100 px-1 font-semibold text-amber-800">FASTING</span> : null}{l.priority !== "ROUTINE" ? <span className="rounded bg-red-100 px-1 font-semibold text-red-700">{l.priority}</span> : null}</div>
              <div className="my-2 flex items-center gap-3"><div className="min-w-0 flex-1 [&_svg]:h-14 [&_svg]:w-full" role="img" aria-label={l.accessionNumber} dangerouslySetInnerHTML={{ __html: l.svg }} /><div className="size-20 shrink-0 [&_svg]:size-full" role="img" aria-label="QR" dangerouslySetInnerHTML={{ __html: l.qrSvg }} /></div>
              <figcaption className="flex justify-between font-mono text-sm font-semibold tracking-wider"><span>{l.accessionNumber}</span><span className="text-[10px] font-normal text-slate-500">{l.orderNumber}</span></figcaption>
            </figure>))}</div>
          <Button size="sm" onClick={() => window.print()}><Printer aria-hidden className="size-4" />{t("common.print")}</Button>
        </div>
      </Modal>
    </>
  );
}
