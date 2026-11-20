import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertOctagon, BookOpen, CalendarClock, ClipboardCheck, Gauge, Plus, Wrench } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly, dt } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Tabs, Td, Textarea, useToast } from "@/components/ui";
import { EmptyState, StatCard, Surface } from "@/brand/ui-kit";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";

const NC_NEXT: Record<string, string> = { OPEN: "INVESTIGATING", INVESTIGATING: "ACTION", ACTION: "VERIFIED", VERIFIED: "CLOSED" };

/** M5 quality management: overview, QC lots, calibration, EQA, maintenance, NCR/CAPA, SOP library. */
export function QualityPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [form, setForm] = useState<{ kind: string; data: any } | null>(null);
  const [ncr, setNcr] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [rc, setRc] = useState("");
  const sum = useQuery({ queryKey: ["quality-summary"], queryFn: () => api<any>("/quality/summary"), enabled: can("quality.read") });
  const lots = useQuery({ queryKey: ["qc-lots"], queryFn: () => api<any[]>("/qc/lots"), enabled: tab === "lots" });
  const cal = useQuery({ queryKey: ["calibrations"], queryFn: () => api<any[]>("/calibrations"), enabled: tab === "calib" });
  const eqa = useQuery({ queryKey: ["eqa"], queryFn: () => api<any[]>("/eqa"), enabled: tab === "eqa" });
  const sched = useQuery({ queryKey: ["maint-sched"], queryFn: () => api<any[]>("/maintenance/schedules"), enabled: tab === "maint" });
  const logs = useQuery({ queryKey: ["maint-logs"], queryFn: () => api<any[]>("/maintenance/logs"), enabled: tab === "maint" });
  const ncrs = useQuery({ queryKey: ["ncrs"], queryFn: () => api<any[]>("/ncrs"), enabled: tab === "ncr" });
  const ncrD = useQuery({ queryKey: ["ncr", ncr], queryFn: () => api<any>(`/ncrs/${ncr}`), enabled: Boolean(ncr) });
  const docs = useQuery({ queryKey: ["documents"], queryFn: () => api<any[]>("/documents"), enabled: tab === "docs" });
  const pend = useQuery({ queryKey: ["pending-acks"], queryFn: () => api<any[]>("/documents/pending-acks"), enabled: tab === "docs" || tab === "overview" });
  const docD = useQuery({ queryKey: ["document", doc], queryFn: () => api<any>(`/documents/${doc}`), enabled: Boolean(doc) });
  const insts = useQuery({ queryKey: ["instruments"], queryFn: () => api<any[]>("/instruments"), enabled: Boolean(form) });
  const analytes = useQuery({ queryKey: ["analytes"], queryFn: () => api<any[]>("/catalogue/analytes"), enabled: form?.kind === "eqa" || form?.kind === "calib" });
  const refresh = () => void qc.invalidateQueries();
  const post = useMutation({ mutationFn: (v: { path: string; body?: object; method?: string }) => api(v.path, { method: v.method, body: v.body ?? {} }), onSuccess: () => { setForm(null); refresh(); toast(t("common.saved")); } });
  const s = sum.data;
  const tabs = [{ id: "overview", label: t("qm.overview") }, { id: "lots", label: t("qm.lots") }, { id: "calib", label: t("qm.calibration") }, { id: "eqa", label: t("qm.eqa") }, { id: "maint", label: t("qm.maintenance") }, { id: "ncr", label: t("qm.ncr") }, { id: "docs", label: t("qm.docs") }];
  const f = form?.data;
  const set = (k: string, v: unknown) => setForm({ ...form!, data: { ...f, [k]: v } });
  const submit = () => {
    if (!form) return;
    const d = { ...f };
    if (form.kind === "calib") post.mutate({ path: "/calibrations", body: { instrumentId: d.instrumentId, analyteId: d.analyteId || undefined, calibratorLot: d.lot, status: d.status, nextDueDays: d.nextDueDays ? Number(d.nextDueDays) : undefined, note: d.note || undefined } });
    if (form.kind === "eqa") post.mutate({ path: "/eqa", body: { scheme: d.scheme, cycle: d.cycle, sampleCode: d.sample, analyteId: d.analyteId, reportedValue: Number(d.reported), assignedValue: Number(d.assigned), groupSd: Number(d.sd) } });
    if (form.kind === "sched") post.mutate({ path: "/maintenance/schedules", body: { instrumentId: d.instrumentId, task: d.task, frequencyDays: Number(d.days) } });
    if (form.kind === "mlog") post.mutate({ path: "/maintenance/logs", body: { instrumentId: d.instrumentId, scheduleId: d.scheduleId || undefined, kind: d.kind, notes: d.notes || undefined, downtimeMinutes: Number(d.downtime || 0) } });
    if (form.kind === "ncr") post.mutate({ path: "/ncrs", body: { title: d.title, description: d.description, area: d.area, severity: d.severity } });
    if (form.kind === "doc") post.mutate({ path: "/documents", body: { code: d.code, title: d.title, category: d.category, section: d.section || undefined, body: d.body } });
  };
  const kpi = (k: string, tone: "neutral" | "warn" | "bad" | "good" = "neutral") => <StatCard key={k} label={t(`qm.kpi.${k}`)} value={String(s?.[k] ?? 0)} tone={(s?.[k] ?? 0) > 0 && tone !== "neutral" ? tone : "neutral"} />;
  return (
    <>
      <PageHeader title={t("qm.title")} sub={t("qm.sub")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{kpi("lotsExpired", "bad")}{kpi("lotsExpiringSoon", "warn")}{kpi("maintenanceOverdue", "bad")}{kpi("calibrationsDue", "warn")}{kpi("ncrOpen", "warn")}{kpi("capaOverdue", "bad")}{kpi("documentsReviewOverdue", "warn")}{kpi("eqaUnacceptable90d", "bad")}</div>
          {pend.data?.length ? <Card><CardTitle>{t("qm.pendingAcks")}</CardTitle><ul className="space-y-1 text-sm">{pend.data.map((p) => <li key={p.versionId}><button type="button" className="text-primary hover:underline" onClick={() => { setTab("docs"); setDoc(p.documentId); }}>{p.code} · {p.title} (v{p.version})</button></li>)}</ul></Card> : null}
          <Link to="/qc" className="inline-flex items-center gap-2 text-sm text-primary hover:underline"><Gauge aria-hidden className="size-4" />{t("qm.goQc")}</Link>
        </div>
      ) : null}
      {tab === "lots" ? (
        <Table head={[t("qc.analyte"), t("qc.level"), t("qc.lot"), t("qm.expires"), t("common.status"), t("qm.runs"), t("qm.lastRun"), ""]}>
          {(lots.data ?? []).map((l) => <tr key={l.id}><Td>{l.analyte.code}</Td><Td>{t(`qc.levels.${l.level}`)}</Td><Td className="font-mono text-xs">{l.lot}</Td><Td>{l.expiresAt ? dOnly(l.expiresAt, i18n.language) : "-"} {l.state !== "OK" ? <Badge tone={l.state === "EXPIRED" ? "crit" : "warn"}>{t(`qm.lotState.${l.state}`)}</Badge> : null}</Td><Td><Badge tone={l.status === "ACTIVE" ? "ok" : "muted"}>{t(`qm.lotStatus.${l.status}`)}</Badge></Td><Td className="tabular-nums">{l.runCount}</Td><Td className="text-xs text-muted-foreground">{l.lastRunAt ? dt(l.lastRunAt, i18n.language) : "-"}</Td><Td>{can("quality.manage") && l.status === "ACTIVE" ? <Button size="sm" variant="ghost" onClick={() => post.mutate({ path: `/qc/lots/${l.id}`, method: "PUT", body: { status: "RETIRED" } })}>{t("qm.retire")}</Button> : null}</Td></tr>)}
        </Table>
      ) : null}
      {tab === "calib" ? (
        <div className="space-y-3">{can("quality.log") ? <Button size="sm" onClick={() => setForm({ kind: "calib", data: { instrumentId: "", analyteId: "", lot: "", status: "PASS", nextDueDays: "30", note: "" } })}><Plus aria-hidden className="size-4" />{t("qm.addCalibration")}</Button> : null}
          <Table head={[t("common.date"), t("qc.instrument"), t("qm.calLot"), t("common.status"), t("qm.nextDue"), t("common.note")]}>{(cal.data ?? []).map((c) => <tr key={c.id}><Td>{dt(c.performedAt, i18n.language)}</Td><Td>{insts.data?.find((i) => i.id === c.instrumentId)?.name ?? c.instrumentId.slice(-6)}</Td><Td className="font-mono text-xs">{c.calibratorLot}</Td><Td><StatusBadge value={c.status} /></Td><Td>{c.nextDueAt ? dOnly(c.nextDueAt, i18n.language) : "-"}</Td><Td className="max-w-xs truncate text-xs text-muted-foreground">{c.note}</Td></tr>)}</Table>
        </div>
      ) : null}
      {tab === "eqa" ? (
        <div className="space-y-3">{can("quality.log") ? <Button size="sm" onClick={() => setForm({ kind: "eqa", data: { scheme: "", cycle: "", sample: "", analyteId: "", reported: "", assigned: "", sd: "" } })}><Plus aria-hidden className="size-4" />{t("qm.addEqa")}</Button> : null}
          <Table head={[t("qm.scheme"), t("qm.cycle"), t("qc.analyte"), t("qm.reported"), t("qm.assigned"), "z", t("common.status")]}>{(eqa.data ?? []).map((e) => <tr key={e.id}><Td>{e.scheme}</Td><Td>{e.cycle}/{e.sampleCode}</Td><Td>{e.analyte}</Td><Td className="tabular-nums">{e.reportedValue}</Td><Td className="tabular-nums">{e.assignedValue}</Td><Td className="tabular-nums font-semibold">{e.zScore}</Td><Td><Badge tone={e.status === "ACCEPTABLE" ? "ok" : e.status === "WARNING" ? "warn" : "crit"}>{t(`qm.eqaStatus.${e.status}`)}</Badge>{e.ncrId ? <Badge tone="crit" className="ms-1">NCR</Badge> : null}</Td></tr>)}</Table>
        </div>
      ) : null}
      {tab === "maint" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">{can("quality.manage") ? <Button size="sm" variant="outline" onClick={() => setForm({ kind: "sched", data: { instrumentId: "", task: "", days: "7" } })}><CalendarClock aria-hidden className="size-4" />{t("qm.addSchedule")}</Button> : null}{can("quality.log") ? <Button size="sm" onClick={() => setForm({ kind: "mlog", data: { instrumentId: "", scheduleId: "", kind: "PREVENTIVE", notes: "", downtime: "0" } })}><Wrench aria-hidden className="size-4" />{t("qm.logMaintenance")}</Button> : null}</div>
          <Table head={[t("qc.instrument"), t("qm.task"), t("qm.every"), t("qm.lastDone"), t("qm.nextDue"), ""]}>{(sched.data ?? []).map((x) => <tr key={x.id} className={x.overdue ? "kx-row-crit" : undefined}><Td>{x.instrument}</Td><Td>{x.task}</Td><Td>{x.frequencyDays} {t("qm.days")}</Td><Td>{x.lastDoneAt ? dOnly(x.lastDoneAt, i18n.language) : "-"}</Td><Td>{dOnly(x.nextDueAt, i18n.language)} {x.overdue ? <Badge tone="crit">{t("qm.overdue")}</Badge> : null}</Td><Td>{can("quality.log") ? <Button size="sm" variant="outline" onClick={() => post.mutate({ path: "/maintenance/logs", body: { instrumentId: x.instrumentId, scheduleId: x.id, kind: "PREVENTIVE" } })}>{t("qm.markDone")}</Button> : null}</Td></tr>)}</Table>
          <Card><CardTitle>{t("qm.maintLog")}</CardTitle><ul className="space-y-1 text-sm">{(logs.data ?? []).slice(0, 12).map((l) => <li key={l.id}>{dt(l.performedAt, i18n.language)} · <Badge tone="muted">{t(`qm.maintKinds.${l.kind}`)}</Badge> {l.notes}{l.downtimeMinutes ? <span className="text-xs text-muted-foreground"> ({l.downtimeMinutes} {t("crit.min")})</span> : null}</li>)}</ul></Card>
        </div>
      ) : null}
      {tab === "ncr" ? (
        <div className="space-y-3">{can("quality.log") ? <Button size="sm" onClick={() => setForm({ kind: "ncr", data: { title: "", description: "", area: "OTHER", severity: "MINOR" } })}><AlertOctagon aria-hidden className="size-4" />{t("qm.raiseNcr")}</Button> : null}
          <Table head={[t("qm.number"), t("common.title"), t("qm.area"), t("qm.severity"), t("common.status"), t("qm.actions"), t("common.date")]}>{(ncrs.data ?? []).map((n) => <tr key={n.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setNcr(n.id)}><Td className="font-mono text-xs">{n.number}</Td><Td className="max-w-xs truncate" dir="auto">{n.title}</Td><Td>{t(`qm.areas.${n.area}`)}</Td><Td><Badge tone={n.severity === "MAJOR" || n.severity === "CRITICAL" ? "crit" : "warn"}>{t(`qm.severities.${n.severity}`)}</Badge></Td><Td><Badge tone={n.status === "CLOSED" ? "ok" : "info"}>{t(`qm.ncStatus.${n.status}`)}</Badge></Td><Td className="tabular-nums">{n.actionCount}</Td><Td>{dOnly(n.createdAt, i18n.language)}</Td></tr>)}</Table>
        </div>
      ) : null}
      {tab === "docs" ? (
        <div className="space-y-3">{can("quality.manage") ? <Button size="sm" onClick={() => setForm({ kind: "doc", data: { code: "", title: "", category: "SOP", section: "", body: "" } })}><BookOpen aria-hidden className="size-4" />{t("qm.newDoc")}</Button> : null}
          {!docs.data?.length ? <EmptyState title={t("common.none")} /> : <Table head={[t("qm.code"), t("common.title"), t("qm.category"), t("qm.effective"), t("common.status"), t("qm.reviewDue")]}>{docs.data.map((d) => <tr key={d.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setDoc(d.id)}><Td className="font-mono text-xs font-semibold">{d.code}</Td><Td dir="auto">{d.title}</Td><Td>{t(`qm.categories.${d.category}`)}</Td><Td>{d.effectiveVersion ? `v${d.effectiveVersion}` : "-"}</Td><Td><Badge tone={d.latestStatus === "APPROVED" ? "ok" : "warn"}>{t(`qm.docStatus.${d.latestStatus}`)}</Badge></Td><Td>{d.reviewDueAt ? dOnly(d.reviewDueAt, i18n.language) : "-"} {d.reviewOverdue ? <Badge tone="crit">{t("qm.overdue")}</Badge> : null}</Td></tr>)}</Table>}
        </div>
      ) : null}

      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form ? t(`qm.forms.${form.kind}`) : ""} wide>
        {form ? <div className="grid gap-3 sm:grid-cols-2">
          {["calib", "sched", "mlog"].includes(form.kind) ? <Field label={t("qc.instrument")}><Select value={f.instrumentId} onChange={(e) => set("instrumentId", e.target.value)}><option value="">-</option>{(insts.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field> : null}
          {["calib", "eqa"].includes(form.kind) ? <Field label={t("qc.analyte")}><Select value={f.analyteId} onChange={(e) => set("analyteId", e.target.value)}><option value="">-</option>{(analytes.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}</Select></Field> : null}
          {form.kind === "calib" ? <><Field label={t("qm.calLot")}><Input value={f.lot} onChange={(e) => set("lot", e.target.value)} /></Field><Field label={t("common.status")}><Select value={f.status} onChange={(e) => set("status", e.target.value)}><option value="PASS">{t("status.PASS")}</option><option value="FAIL">{t("status.FAIL")}</option></Select></Field><Field label={t("qm.nextDueDays")}><Input type="number" value={f.nextDueDays} onChange={(e) => set("nextDueDays", e.target.value)} /></Field><Field label={t("common.note")} hint={f.status === "FAIL" ? t("qm.failNote") : undefined}><Input value={f.note} onChange={(e) => set("note", e.target.value)} /></Field></> : null}
          {form.kind === "eqa" ? <><Field label={t("qm.scheme")}><Input value={f.scheme} onChange={(e) => set("scheme", e.target.value)} /></Field><Field label={t("qm.cycle")}><Input value={f.cycle} onChange={(e) => set("cycle", e.target.value)} /></Field><Field label={t("qm.sample")}><Input value={f.sample} onChange={(e) => set("sample", e.target.value)} /></Field><Field label={t("qm.reported")}><Input type="number" value={f.reported} onChange={(e) => set("reported", e.target.value)} /></Field><Field label={t("qm.assigned")}><Input type="number" value={f.assigned} onChange={(e) => set("assigned", e.target.value)} /></Field><Field label={t("qm.groupSd")}><Input type="number" value={f.sd} onChange={(e) => set("sd", e.target.value)} /></Field></> : null}
          {form.kind === "sched" ? <><Field label={t("qm.task")} className="sm:col-span-2"><Input value={f.task} onChange={(e) => set("task", e.target.value)} /></Field><Field label={t("qm.everyDays")}><Input type="number" value={f.days} onChange={(e) => set("days", e.target.value)} /></Field></> : null}
          {form.kind === "mlog" ? <><Field label={t("qm.kind")}><Select value={f.kind} onChange={(e) => set("kind", e.target.value)}>{["PREVENTIVE", "CORRECTIVE", "CLEANING", "CALIBRATION", "PARTS"].map((k) => <option key={k} value={k}>{t(`qm.maintKinds.${k}`)}</option>)}</Select></Field><Field label={t("qm.downtime")}><Input type="number" value={f.downtime} onChange={(e) => set("downtime", e.target.value)} /></Field><Field label={t("common.note")} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field></> : null}
          {form.kind === "ncr" ? <><Field label={t("common.title")} className="sm:col-span-2"><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></Field><Field label={t("qm.area")}><Select value={f.area} onChange={(e) => set("area", e.target.value)}>{["PRE_ANALYTICAL", "ANALYTICAL", "POST_ANALYTICAL", "EQUIPMENT", "DOCUMENT", "PERSONNEL", "SAFETY", "OTHER"].map((k) => <option key={k} value={k}>{t(`qm.areas.${k}`)}</option>)}</Select></Field><Field label={t("qm.severity")}><Select value={f.severity} onChange={(e) => set("severity", e.target.value)}>{["MINOR", "MAJOR", "CRITICAL"].map((k) => <option key={k} value={k}>{t(`qm.severities.${k}`)}</option>)}</Select></Field><Field label={t("common.description")} className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></Field></> : null}
          {form.kind === "doc" ? <><Field label={t("qm.code")}><Input value={f.code} onChange={(e) => set("code", e.target.value)} /></Field><Field label={t("qm.category")}><Select value={f.category} onChange={(e) => set("category", e.target.value)}>{["SOP", "POLICY", "FORM", "MANUAL", "WORK_INSTRUCTION"].map((k) => <option key={k} value={k}>{t(`qm.categories.${k}`)}</option>)}</Select></Field><Field label={t("common.title")} className="sm:col-span-2"><Input value={f.title} onChange={(e) => set("title", e.target.value)} /></Field><Field label={t("qm.body")} className="sm:col-span-2"><Textarea rows={8} value={f.body} onChange={(e) => set("body", e.target.value)} /></Field></> : null}
          <div className="sm:col-span-2 space-y-2"><ErrorNote error={post.error} /><Button disabled={post.isPending} onClick={submit}>{t("common.save")}</Button></div>
        </div> : null}
      </Modal>

      <Modal open={Boolean(ncr)} onClose={() => setNcr(null)} title={ncrD.data?.number ?? ""} wide>
        {ncrD.data ? (() => { const n = ncrD.data; const next = NC_NEXT[n.status]; return (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="text-base font-semibold" dir="auto">{n.title}</span><Badge tone="info">{t(`qm.ncStatus.${n.status}`)}</Badge><Badge tone={n.severity === "MINOR" ? "warn" : "crit"}>{t(`qm.severities.${n.severity}`)}</Badge></div>
            <p dir="auto">{n.description}</p>
            {n.rootCause ? <p><strong>{t("qm.rootCause")}:</strong> <span dir="auto">{n.rootCause}</span></p> : null}
            <Card><CardTitle>{t("qm.actions")}</CardTitle><ul className="space-y-2">{n.actions.map((a: any) => <li key={a.id} className="flex flex-wrap items-center justify-between gap-2"><span dir="auto">{a.description} <span className="text-xs text-muted-foreground">{a.dueAt ? `· ${dOnly(a.dueAt, i18n.language)}` : ""}</span></span><span className="flex items-center gap-2"><Badge tone={a.status === "VERIFIED" ? "ok" : a.status === "DONE" ? "info" : "warn"}>{t(`qm.capaStatus.${a.status}`)}</Badge>{a.status === "OPEN" && can("quality.log") ? <Button size="sm" variant="outline" onClick={() => post.mutate({ path: `/capa-actions/${a.id}/complete` })}>{t("qm.markDone")}</Button> : null}{a.status === "DONE" && can("quality.manage") ? <Button size="sm" variant="outline" onClick={() => { const e = window.prompt(t("qm.effectiveness")); if (e && e.length >= 3) post.mutate({ path: `/capa-actions/${a.id}/verify`, body: { effectiveness: e } }); }}>{t("qm.verify")}</Button> : null}</span></li>)}</ul>
              {can("quality.manage") && n.status !== "CLOSED" ? <Button size="sm" variant="outline" className="mt-2" onClick={() => { const d = window.prompt(t("qm.capaPrompt")); if (d && d.length >= 3) post.mutate({ path: `/ncrs/${n.id}/actions`, body: { description: d } }); }}>{t("qm.addAction")}</Button> : null}</Card>
            {can("quality.manage") && next ? <div className="flex flex-wrap items-end gap-2">{next === "ACTION" && !n.rootCause ? <Input className="max-w-sm" placeholder={t("qm.rootCause")} value={rc} onChange={(e) => setRc(e.target.value)} /> : null}<Button onClick={() => post.mutate({ path: `/ncrs/${n.id}/advance`, body: { to: next, ...(rc ? { rootCause: rc } : {}) } })}>{t("qm.moveTo", { status: t(`qm.ncStatus.${next}`) })}</Button></div> : null}
            <ErrorNote error={post.error} />
          </div>); })() : null}
      </Modal>

      <Modal open={Boolean(doc)} onClose={() => setDoc(null)} title={docD.data ? `${docD.data.code} · ${docD.data.title}` : ""} xl>
        {docD.data ? (
          <div className="space-y-4">
            {docD.data.versions.map((v: any) => (
              <Surface key={v.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">v{v.version} <Badge tone={v.status === "APPROVED" ? "ok" : v.status === "SUPERSEDED" ? "muted" : "warn"}>{t(`qm.docStatus.${v.status}`)}</Badge></span><span className="text-xs text-muted-foreground">{v.approvedAt ? `${t("qm.approved")}: ${dOnly(v.approvedAt, i18n.language)}` : ""} · {t("qm.acks")}: {v._count.acks}</span></div>
                {v.status !== "SUPERSEDED" ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-xs" dir="auto">{v.body}</pre> : null}
                <div className="flex flex-wrap gap-2">
                  {v.status === "DRAFT" && can("quality.manage") ? <Button size="sm" onClick={() => post.mutate({ path: `/documents/${docD.data.id}/versions/${v.id}/submit` })}>{t("qm.submitReview")}</Button> : null}
                  {v.status === "IN_REVIEW" && can("documents.approve") ? <><Button size="sm" onClick={() => post.mutate({ path: `/documents/${docD.data.id}/versions/${v.id}/approve`, body: {} })}>{t("qm.approve")}</Button><Button size="sm" variant="ghost" onClick={() => post.mutate({ path: `/documents/${docD.data.id}/versions/${v.id}/reject` })}>{t("qm.returnDraft")}</Button></> : null}
                  {v.status === "APPROVED" ? <Button size="sm" variant="outline" onClick={() => post.mutate({ path: `/documents/${docD.data.id}/versions/${v.id}/ack` })}><ClipboardCheck aria-hidden className="size-4" />{t("qm.ack")}</Button> : null}
                </div>
              </Surface>
            ))}
            {can("quality.manage") && !docD.data.versions.some((v: any) => ["DRAFT", "IN_REVIEW"].includes(v.status)) ? <Button variant="outline" size="sm" onClick={() => { const n = window.prompt(t("qm.changeNote")); if (n && n.length >= 3) post.mutate({ path: `/documents/${docD.data.id}/revisions`, body: { changeNote: n } }); }}>{t("qm.revise")}</Button> : null}
            <ErrorNote error={post.error} />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
