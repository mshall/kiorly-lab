import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, FileUp, Plus } from "lucide-react";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Td, Textarea, useToast } from "@/components/ui";
import { PdfPreview } from "@/components/kit";
import { EmptyState } from "@/brand/ui-kit";
import { ErrorNote } from "@/components/common";

/** Report templates: branding per lab, language (AR / EN / bilingual), header/footer, accent colour, logo, QR verification; live PDF preview. */
export function TemplatesTab() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const file = useRef<HTMLInputElement>(null);
  const [logoFor, setLogoFor] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["templates"], queryFn: () => api<any[]>("/report-templates") });
  const labs = useQuery({ queryKey: ["labs"], queryFn: () => api<any[]>("/labs") });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["templates"] });
  const save = useMutation({ mutationFn: () => { const { id, ...b } = form; return id ? api(`/report-templates/${id}`, { method: "PUT", body: b }) : api("/report-templates", { body: b }); }, onSuccess: () => { setForm(null); refresh(); toast(t("common.saved")); } });
  const def = useMutation({ mutationFn: (id: string) => api(`/report-templates/${id}/default`, { body: {} }), onSuccess: refresh });
  const rm = useMutation({ mutationFn: (id: string) => api(`/report-templates/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const logo = useMutation({ mutationFn: (v: { id: string; b64: string }) => api(`/report-templates/${v.id}/logo`, { method: "PUT", body: { imageBase64: v.b64 } }), onSuccess: () => { refresh(); toast(t("common.saved")); } });
  const onFile = (f?: File) => {
    if (!f || !logoFor) return;
    const r = new FileReader();
    r.onload = () => logo.mutate({ id: logoFor, b64: String(r.result).split(",")[1] ?? "" });
    r.readAsDataURL(f);
  };
  const m = can("templates.manage");
  return (
    <div className="space-y-3">
      {m ? <Button size="sm" onClick={() => setForm({ name: "", language: "BILINGUAL", headerTitle: "", headerSubtitle: "", footerText: "", accentColor: "#3730A3", showQr: true, showRanges: true, labId: "" })}><Plus aria-hidden className="size-4" />{t("tpl.new")}</Button> : null}
      <input ref={file} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      <ErrorNote error={logo.error ?? def.error ?? rm.error} />
      {!list.data?.length ? <EmptyState title={t("tpl.none")} description={t("tpl.noneHint")} /> : (
        <div className="grid gap-3 sm:grid-cols-2">{list.data.map((x) => (
          <Card key={x.id} className="space-y-2">
            <div className="flex items-start justify-between gap-2"><div><div className="flex items-center gap-2 font-semibold" dir="auto"><span aria-hidden className="size-3 rounded-full" style={{ background: x.accentColor }} />{x.name}</div><div className="mt-1 flex flex-wrap gap-1"><Badge tone="info">{t(`tpl.lang.${x.language}`)}</Badge>{x.isDefault ? <Badge tone="ok">{t("tpl.default")}</Badge> : null}{x.showQr ? <Badge tone="muted">QR</Badge> : null}{x.hasLogo ? <Badge tone="muted">{t("tpl.logo")}</Badge> : null}</div></div></div>
            <p className="text-xs text-muted-foreground" dir="auto">{x.headerTitle || "-"}{x.headerSubtitle ? ` · ${x.headerSubtitle}` : ""}</p>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setPreview(x)}>{t("tpl.preview")}</Button>{m ? <><Button size="sm" variant="ghost" onClick={() => setForm({ ...x, labId: x.labId ?? "", headerTitle: x.headerTitle ?? "", headerSubtitle: x.headerSubtitle ?? "", footerText: x.footerText ?? "" })}>{t("common.edit")}</Button><Button size="sm" variant="ghost" onClick={() => { setLogoFor(x.id); file.current?.click(); }}>{t("tpl.uploadLogo")}</Button>{!x.isDefault ? <><Button size="sm" variant="ghost" onClick={() => def.mutate(x.id)}>{t("tpl.makeDefault")}</Button><Button size="sm" variant="ghost" onClick={() => rm.mutate(x.id)}>{t("common.remove")}</Button></> : null}</> : null}</div>
          </Card>))}</div>
      )}
      <p className="text-xs text-muted-foreground">{t("tpl.note")}</p>
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={t("tpl.new")} wide>
        {form ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.name")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label={t("tpl.language")}><Select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>{["BILINGUAL", "AR", "EN"].map((l) => <option key={l} value={l}>{t(`tpl.lang.${l}`)}</option>)}</Select></Field>
          <Field label={t("tpl.headerTitle")}><Input value={form.headerTitle} onChange={(e) => setForm({ ...form, headerTitle: e.target.value })} dir="auto" /></Field>
          <Field label={t("tpl.branch")}><Select value={form.labId} onChange={(e) => setForm({ ...form, labId: e.target.value })}><option value="">{t("tpl.allBranches")}</option>{(labs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label={t("tpl.headerSubtitle")} className="sm:col-span-2"><Input value={form.headerSubtitle} onChange={(e) => setForm({ ...form, headerSubtitle: e.target.value })} dir="auto" /></Field>
          <Field label={t("tpl.footer")} className="sm:col-span-2"><Textarea rows={2} value={form.footerText} onChange={(e) => setForm({ ...form, footerText: e.target.value })} dir="auto" /></Field>
          <Field label={t("tpl.accent")}><div className="flex items-center gap-2"><input type="color" aria-label={t("tpl.accent")} value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} className="h-10 w-14 rounded border border-input bg-card" /><Input value={form.accentColor} onChange={(e) => setForm({ ...form, accentColor: e.target.value })} className="font-mono" /></div></Field>
          <div className="flex flex-wrap items-center gap-4"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.showQr} onChange={(e) => setForm({ ...form, showQr: e.target.checked })} />{t("tpl.showQr")}</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.showRanges} onChange={(e) => setForm({ ...form, showRanges: e.target.checked })} />{t("tpl.showRanges")}</label></div>
          <div className="sm:col-span-2 space-y-2"><ErrorNote error={save.error} /><Button disabled={form.name.length < 2 || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button></div>
        </div> : null}
      </Modal>
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={`${t("tpl.preview")} · ${preview?.name ?? ""}`} xl>{preview ? <PdfPreview path={`/report-templates/${preview.id}/preview.pdf`} title={preview.name} filename={`${preview.name}.pdf`} onDownload={() => void download(`/report-templates/${preview.id}/preview.pdf`, `${preview.name}.pdf`)} /> : null}</Modal>
    </div>
  );
}

/** Test catalogue CSV import (analytes with ranges / tests): template download, dry-run validation with per-row errors, then apply. */
export function ImportTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"analytes" | "tests">("tests");
  const [csv, setCsv] = useState("");
  const [rep, setRep] = useState<any>(null);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => api<any>("/catalogue/import", { body: { kind, csv, dryRun } }),
    onSuccess: (r) => { setRep(r); if (r.applied) { void qc.invalidateQueries(); toast(t("imp.applied", { n: r.rows })); } },
    onError: (e: any) => { if (e?.body?.errors) setRep(e.body); },
  });
  const units = useQuery({ queryKey: ["units"], queryFn: () => api<any[]>("/catalogue/units") });
  const rename = useMutation({ mutationFn: (v: { from: string; to: string }) => api("/catalogue/units/rename", { method: "PUT", body: v }), onSuccess: () => { void qc.invalidateQueries(); toast(t("common.saved")); } });
  const onFile = (f?: File) => { if (!f) return; const r = new FileReader(); r.onload = () => { setCsv(String(r.result)); setRep(null); }; r.readAsText(f); };
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <CardTitle><FileUp aria-hidden className="me-2 inline size-4" />{t("imp.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("imp.note")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("imp.kind")}><Select value={kind} onChange={(e) => { setKind(e.target.value as "analytes" | "tests"); setRep(null); }}><option value="analytes">{t("imp.analytes")}</option><option value="tests">{t("imp.tests")}</option></Select></Field>
          <Button variant="outline" size="sm" onClick={() => void download(`/catalogue/import-template/${kind}`, `${kind}-template.csv`)}><Download aria-hidden className="size-4" />{t("imp.template")}</Button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-medium hover:bg-accent"><FileUp aria-hidden className="size-4" />{t("imp.chooseFile")}<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
        <Textarea rows={6} className="font-mono text-xs" value={csv} onChange={(e) => { setCsv(e.target.value); setRep(null); }} placeholder={t("imp.paste")} aria-label={t("imp.paste")} dir="ltr" />
        <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={csv.length < 5 || run.isPending} onClick={() => run.mutate(true)}>{t("imp.validate")}</Button><Button disabled={csv.length < 5 || run.isPending || !rep || rep.errors.length > 0 || rep.applied} onClick={() => run.mutate(false)}>{t("imp.apply")}</Button></div>
        {run.error && !rep ? <ErrorNote error={run.error} /> : null}
        {rep ? (
          <div role="status" className="space-y-2 rounded-lg bg-muted/60 p-3 text-sm">
            <div className="flex flex-wrap gap-2"><Badge tone="info">{t("imp.rows", { n: rep.rows })}</Badge><Badge tone="ok">{t("imp.created", { n: rep.created })}</Badge><Badge tone="info">{t("imp.updated", { n: rep.updated })}</Badge><Badge tone={rep.errors.length ? "crit" : "ok"}>{t("imp.errors", { n: rep.errors.length })}</Badge>{rep.applied ? <Badge tone="ok">{t("imp.done")}</Badge> : null}</div>
            {rep.errors.length ? <ul className="max-h-48 overflow-auto text-xs">{rep.errors.map((e: any, i: number) => <li key={i}><span className="font-mono">{t("imp.rowN", { n: e.row })}</span> · <span className="font-mono">{e.field}</span>: {e.message}</li>)}</ul> : null}
          </div>
        ) : null}
      </Card>
      <Card>
        <CardTitle>{t("imp.units")}</CardTitle>
        <p className="mb-2 text-xs text-muted-foreground">{t("imp.unitsNote")}</p>
        <Table head={[t("imp.unit"), t("imp.analytesUsing"), ""]}>{(units.data ?? []).map((u) => <tr key={u.unit}><Td className="font-mono"><bdi dir="ltr">{u.unit}</bdi></Td><Td className="tabular-nums">{u.analytes}</Td><Td><Button size="sm" variant="ghost" onClick={() => { const to = window.prompt(t("imp.renamePrompt", { unit: u.unit }), u.unit); if (to && to !== u.unit) rename.mutate({ from: u.unit, to }); }}>{t("imp.rename")}</Button></Td></tr>)}</Table>
      </Card>
    </div>
  );
}

/** Audit viewer with filters (entity, action, actor, period) and CSV-ready table. No PHI is ever in these rows (ids and field names only). */
export function AuditViewer() {
  const { t, i18n } = useTranslation();
  const [f, setF] = useState({ action: "", entityType: "", from: "", to: "" });
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const q = useQuery({ queryKey: ["audit-view", qs], queryFn: () => api<any[]>(`/audit-logs?limit=200${qs ? `&${qs}` : ""}`) });
  return (
    <div className="space-y-3">
      <Card className="grid gap-3 sm:grid-cols-4">
        <Field label={t("set.action")}><Input value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })} placeholder="order.cancel" /></Field>
        <Field label={t("set.entity")}><Input value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} placeholder="LabOrder" /></Field>
        <Field label={t("common.from")}><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label={t("common.to")}><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      </Card>
      {q.data?.length ? <Table head={[t("common.date"), t("set.action"), t("set.entity"), t("set.actor"), t("set.details")]}>{q.data.map((a) => <tr key={a.id}><Td className="whitespace-nowrap text-xs">{dt(a.at, i18n.language)}</Td><Td className="font-mono text-xs">{a.action}</Td><Td className="text-xs">{a.entityType}<span className="block font-mono text-[10px] text-muted-foreground">{a.entityId}</span></Td><Td className="font-mono text-[10px]">{a.actorId ?? "system"}</Td><Td className="max-w-xs truncate font-mono text-[10px] text-muted-foreground">{a.meta ? JSON.stringify(a.meta) : ""}</Td></tr>)}</Table> : <EmptyState title={t("common.none")} />}
    </div>
  );
}
