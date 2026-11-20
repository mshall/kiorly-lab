import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCheck, Play, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Input, Select, useToast } from "@/components/ui";
import { ErrorNote, PageHeader, ResultValue, StatusBadge } from "@/components/common";
import { BulkBar, PriorityChip, Progress, SearchBox, Segmented, priorityRank } from "@/components/kit";
import { EmptyState, Skeleton, Surface, kcn } from "@/brand/ui-kit";

type CellState = "enter" | "second" | "validate" | "review" | "done";
const stateOf = (r: any): CellState => {
  if (!r) return "enter";
  if (r.status !== "ENTERED") return "done";
  if (r.source === "MANUAL" && !r.secondEntryBy) return "second";
  if (r.deltaCheckFailed) return "review";
  return "validate";
};

function ResultRow({ item, analyte, result, instrumentId, canEnter, canSecond, canTech }: { item: any; analyte: any; result: any; instrumentId: string; canEnter: boolean; canSecond: boolean; canTech: boolean }) {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState("");
  const [v2, setV2] = useState("");
  const refresh = () => qc.invalidateQueries();
  /** Keyboard-first entry: after a value is saved, focus moves to the next empty value field. */
  const focusNext = (idx: number) => requestAnimationFrame(() => requestAnimationFrame(() => (document.querySelectorAll<HTMLInputElement>("input[data-entry]")[idx])?.focus()));
  const entryIndex = (el: Element | null) => (el ? Array.from(document.querySelectorAll("input[data-entry]")).indexOf(el) : -1);
  const textual = analyte.valueType && analyte.valueType !== "NUMERIC";
  const [dil, setDil] = useState("");
  const [rr, setRr] = useState<{ reason: string; factor: string } | null>(null);
  const enter = useMutation({ mutationFn: () => api("/results", { body: { orderItemId: item.id, analyteId: analyte.id, instrumentId, ...(textual ? { valueText: v } : { value: Number(v), ...(dil ? { dilutionFactor: Number(dil) } : {}) }) } }), onSuccess: async () => { const i = entryIndex(document.activeElement); setV(""); await refresh(); if (i >= 0) focusNext(i); } });
  const second = useMutation({ mutationFn: () => api(`/results/${result.id}/second-entry`, { body: textual ? { valueText: v2 } : { value: Number(v2) } }), onSuccess: async () => { const i = entryIndex(document.activeElement); setV2(""); await refresh(); toast(t("work.confirmed")); if (i >= 0) focusNext(i); } });
  const tech = useMutation({ mutationFn: () => api(`/results/${result.id}/tech-validate`, { body: {} }), onSuccess: refresh });
  const rerun = useMutation({ mutationFn: () => api(`/results/${result.id}/rerun`, { body: { reason: rr!.reason, ...(rr!.factor ? { dilutionFactor: Number(rr!.factor) } : {}) } }), onSuccess: () => { setRr(null); void refresh(); toast(t("work.rerunRequested")); } });
  const err = enter.error ?? second.error ?? tech.error ?? rerun.error;
  const st = stateOf(result);
  const submit = (fn: () => void) => (e: FormEvent) => { e.preventDefault(); fn(); };
  const crit = !!result?.flag?.startsWith("CRITICAL");
  return (
    <li className={kcn("grid items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(9rem,14rem)_minmax(0,1fr)_auto]", crit && "bg-[hsl(var(--danger-text)/0.07)]")}>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{i18n.language === "ar" && analyte.nameAr ? analyte.nameAr : analyte.nameEn}</div>
        <div className="text-xs text-muted-foreground"><span className="font-mono">{analyte.code}</span>{analyte.unit ? <> · <bdi dir="ltr">{analyte.unit}</bdi></> : null}{result ? <> · <bdi dir="ltr" className="tabular-nums">{result.refLow ?? ""}–{result.refHigh ?? ""}</bdi></> : null}</div>
      </div>
      <div className="min-w-0 text-sm">
        {!result ? (
          canEnter ? (
            <form className="flex max-w-xs gap-2" onSubmit={submit(() => v && instrumentId && enter.mutate())}>
              {analyte.calculated ? <span className="self-center text-xs text-muted-foreground">{t("work.calculated")}</span> : analyte.valueType === "CHOICE" || analyte.valueType === "SEMI_QUANT" ? (
                <Select data-entry="1" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${analyte.code} ${t("work.value")}`} disabled={!instrumentId}><option value="">{t("work.value")}</option>{(analyte.allowedValues ?? []).map((x: string) => <option key={x}>{x}</option>)}</Select>
              ) : analyte.valueType === "TEXT" ? <Input data-entry="1" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${analyte.code} ${t("work.value")}`} placeholder={t("work.value")} disabled={!instrumentId} dir="auto" />
              : <><Input data-entry="1" type="number" step="any" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${analyte.code} ${t("work.value")}`} placeholder={t("work.value")} disabled={!instrumentId} className="tabular-nums" /><Input type="number" step="any" min="1" value={dil} onChange={(e) => setDil(e.target.value)} aria-label={t("work.dilution")} placeholder={t("work.dilution")} title={t("work.dilutionHint")} className="w-20 tabular-nums" /></>}
              <Button type="submit" size="sm" className="h-10 shrink-0" disabled={!v || !instrumentId || enter.isPending}>{t("work.enter")}</Button>
            </form>
          ) : <span className="text-xs text-muted-foreground">-</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <ResultValue value={result.valueNumeric ?? result.valueText} flag={result.flag} />
            <StatusBadge value={result.status} />
            {result.autoVerified ? <Badge tone="info">{t("order.auto")}</Badge> : null}
            {result.deltaCheckFailed ? <Badge tone="warn">Δ {result.deltaPercent}%</Badge> : null}
            {st === "second" ? <Badge tone="warn">{t("work.dualPending")}</Badge> : null}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {st === "second" && canSecond ? (
          <form className="flex gap-2" onSubmit={submit(() => v2 && second.mutate())}>
            {textual ? <Input data-entry="1" value={v2} onChange={(e) => setV2(e.target.value)} placeholder={t("work.rekey")} aria-label={t("work.rekey")} className="w-32" dir="auto" /> : <Input data-entry="1" type="number" step="any" value={v2} onChange={(e) => setV2(e.target.value)} placeholder={t("work.rekey")} aria-label={t("work.rekey")} className="w-32 tabular-nums" />}
            <Button type="submit" size="sm" variant="secondary" className="h-10" disabled={!v2 || second.isPending}>{t("work.confirm")}</Button>
          </form>
        ) : null}
        {st === "validate" && canTech ? <Button size="sm" variant="outline" disabled={tech.isPending} onClick={() => tech.mutate()}><CheckCheck aria-hidden className="size-4" />{t("work.techValidate")}</Button> : null}
        {st === "review" ? <Link className="text-xs font-medium text-primary underline" to="/validation">{t("work.deltaReview")}</Link> : null}
        {result && result.status !== "RELEASED" && result.source !== "CALCULATED" && can("results.rerun") ? (rr ? (
          <span className="flex flex-wrap items-center gap-2"><Input className="h-8 w-40 text-xs" value={rr.reason} onChange={(e) => setRr({ ...rr, reason: e.target.value })} placeholder={t("work.rerunReason")} aria-label={t("work.rerunReason")} /><Input type="number" min="1" step="any" className="h-8 w-20 text-xs" value={rr.factor} onChange={(e) => setRr({ ...rr, factor: e.target.value })} placeholder={t("work.dilution")} aria-label={t("work.dilution")} /><Button size="sm" variant="outline" disabled={rr.reason.length < 3 || rerun.isPending} onClick={() => rerun.mutate()}>{t("work.rerun")}</Button></span>
        ) : <Button size="sm" variant="ghost" onClick={() => setRr({ reason: "", factor: "" })}><RefreshCw aria-hidden className="size-3.5" />{t("work.rerun")}</Button>) : null}
      </div>
      {err ? <div className="md:col-span-3"><ErrorNote error={err} /></div> : null}
    </li>
  );
}

/** Technologist bench: results entry with dual control; queue filters, STAT-first ordering, bulk technical validation; analyzer simulator when interfaces are enabled. */
export function WorklistPage() {
  const { t } = useTranslation();
  const { can, flagOn, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [instrumentId, setInstrumentId] = useState("");
  const [mode, setMode] = useState("normal");
  const [queue, setQueue] = useState("open");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<any[]>("/instruments") });
  const [section, setSection] = useState("");
  const [prio, setPrio] = useState("");
  const [onlyInst, setOnlyInst] = useState(false);
  const wl = useQuery({ queryKey: ["worklist", section, prio, onlyInst ? instrumentId : ""], queryFn: () => api<any[]>(`/worklist?${[section && `section=${section}`, prio && `priority=${prio}`, onlyInst && (instrumentId || "") && `instrumentId=${instrumentId}`].filter(Boolean).join("&")}`), refetchInterval: 20_000 });
  const inst = instruments.data?.filter((i) => i.active) ?? [];
  const chosen = instrumentId || inst[0]?.id || "";
  const cur = inst.find((i) => i.id === chosen);
  const analyzersOn = flagOn("lab.analyzer_interfaces") && (me?.capabilities.includes("analyzer_interfaces") ?? false);
  const canTech = can("results.tech_validate");
  const sim = useMutation({ mutationFn: (specimenId: string) => api<any>("/analyzers/simulate", { body: { instrumentId: chosen, specimenId, mode } }), onSuccess: (r) => { void qc.invalidateQueries(); toast(t("work.simDone", { n: r.outcome.accepted })); } });

  const rows = useMemo(() => (wl.data ?? []).map((s) => {
    const cells = s.items.flatMap((it: any) => it.analytes.map((a: any) => ({ it, a, r: it.results.find((r: any) => r.analyteId === a.id) })));
    const count = (st: CellState) => cells.filter((c: any) => stateOf(c.r) === st).length;
    const readyIds: string[] = cells.filter((c: any) => stateOf(c.r) === "validate").map((c: any) => c.r.id);
    return { s, cells, n: { enter: count("enter"), second: count("second"), validate: count("validate"), review: count("review"), done: count("done") }, readyIds };
  }).sort((a, b) => priorityRank(a.s.order.priority) - priorityRank(b.s.order.priority) || a.s.accessionNumber.localeCompare(b.s.accessionNumber)), [wl.data]);

  const counts = useMemo(() => ({
    open: rows.filter((r) => r.n.enter + r.n.second + r.n.validate + r.n.review > 0).length,
    enter: rows.filter((r) => r.n.enter > 0).length,
    second: rows.filter((r) => r.n.second > 0).length,
    validate: rows.filter((r) => r.n.validate > 0).length,
    all: rows.length,
  }), [rows]);
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((r) => {
    if (queue === "open" && r.n.enter + r.n.second + r.n.validate + r.n.review === 0) return false;
    if ((queue === "enter" || queue === "second" || queue === "validate") && r.n[queue] === 0) return false;
    return !needle || r.s.accessionNumber.toLowerCase().includes(needle) || (r.s.order.patient.fullName ?? "").toLowerCase().includes(needle) || (r.s.order.orderNumber ?? "").toLowerCase().includes(needle);
  });
  const ready = rows.filter((r) => r.readyIds.length);
  const selectedIds = rows.filter((r) => picked.includes(r.s.id)).flatMap((r) => r.readyIds);
  const bulk = useMutation({
    mutationFn: async () => { let ok = 0, failed = 0; for (const id of selectedIds) { try { await api(`/results/${id}/tech-validate`, { body: {} }); ok++; } catch { failed++; } } return { ok, failed }; },
    onSuccess: (r) => { setPicked([]); void qc.invalidateQueries(); toast(t("ux.worklist.bulkDone", { ok: r.ok, failed: r.failed }), r.failed ? "warn" : "ok"); },
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <>
      <PageHeader title={t("work.title")} sub={t("work.sub")} actions={canTech && ready.length ? <Button variant="outline" size="sm" onClick={() => setPicked(ready.map((r) => r.s.id))}><CheckCheck aria-hidden className="size-4" />{t("ux.worklist.selectReady", { n: ready.reduce((a, r) => a + r.readyIds.length, 0) })}</Button> : null} />
      <Surface className="mb-4 space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56"><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="inst">{t("work.instrument")}</label><Select id="inst" value={chosen} onChange={(e) => setInstrumentId(e.target.value)}>{inst.map((i) => <option key={i.id} value={i.id}>{i.name}{i.protocol ? ` (${i.protocol})` : ""}</option>)}</Select></div>
          {analyzersOn && cur?.protocol ? <div><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="mode">{t("work.simMode")}</label><Select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>{["normal", "abnormal", "critical"].map((m) => <option key={m} value={m}>{t(`work.modes.${m}`)}</option>)}</Select></div> : null}
          {!analyzersOn ? <Badge tone="warn" className="mb-2">{t("work.manualOnly")}</Badge> : null}
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="sec">{t("work.section")}</label><Select id="sec" value={section} onChange={(e) => setSection(e.target.value)}><option value="">{t("common.all")}</option>{["HEMATOLOGY", "CHEMISTRY", "IMMUNOLOGY", "SEROLOGY", "COAGULATION", "URINALYSIS", "MICROBIOLOGY", "GENERAL"].map((x) => <option key={x} value={x}>{t(`work.sections.${x}`)}</option>)}</Select></div>
          <div><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="prio">{t("orders.priority")}</label><Select id="prio" value={prio} onChange={(e) => setPrio(e.target.value)}><option value="">{t("common.all")}</option>{["STAT", "URGENT", "ROUTINE"].map((x) => <option key={x} value={x}>{t(`ux.priority.${x}`, { defaultValue: x })}</option>)}</Select></div>
          <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={onlyInst} onChange={(e) => setOnlyInst(e.target.checked)} />{t("work.onlyInstrument")}</label>
          <SearchBox value={search} onChange={setSearch} placeholder={t("ux.worklist.search")} className="ms-auto" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
          <Segmented label={t("ux.worklist.queues")} value={queue} onChange={setQueue} items={[
            { id: "open", label: t("ux.worklist.open"), count: counts.open },
            { id: "enter", label: t("ux.worklist.enter"), count: counts.enter },
            { id: "second", label: t("ux.worklist.second"), count: counts.second, tone: "warn" },
            { id: "validate", label: t("ux.worklist.validate"), count: counts.validate },
            { id: "all", label: t("common.all"), count: counts.all },
          ]} />
          <p className="max-w-md text-xs text-muted-foreground">{t("work.qcNote")}</p>
        </div>
      </Surface>
      <ErrorNote error={sim.error} />
      {wl.isLoading ? (
        <div role="status" aria-busy="true" className="space-y-4">{[0, 1, 2].map((i) => <Surface key={i} className="space-y-3 p-4"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-10" /><Skeleton className="h-10" /></Surface>)}</div>
      ) : !rows.length ? <EmptyState title={t("work.empty")} />
      : !shown.length ? <EmptyState compact title={t("ux.worklist.nothing")} description={queue !== "all" ? t("ux.worklist.nothingHint") : undefined} action={queue !== "all" || search ? <Button variant="outline" size="sm" onClick={() => { setQueue("all"); setSearch(""); }}>{t("ux.worklist.showAll")}</Button> : undefined} />
      : (
        <div className="space-y-4 pb-20">
          {shown.map(({ s, cells, n, readyIds }) => {
            const stat = s.order.priority === "STAT";
            const total = cells.length;
            return (
              <Surface key={s.id} className={kcn("overflow-hidden", stat && "kx-stat-card")}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 bg-muted/30 px-4 py-3">
                  {canTech ? <input type="checkbox" className="size-4 accent-[hsl(var(--primary))] disabled:opacity-40" disabled={!readyIds.length} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`${t("ux.worklist.selectSpecimen")} ${s.accessionNumber}`} /> : null}
                  <Link to={`/orders/${s.order.id}`} className="font-mono text-base font-bold text-primary underline-offset-4 hover:underline">{s.accessionNumber}</Link>
                  <span className="text-sm" dir="auto">{s.order.patient.fullName}</span>
                  <PriorityChip priority={s.order.priority} />
                  <div className="ms-auto flex items-center gap-3">
                    <Progress done={n.done} total={total} label={t("ux.worklist.progress")} />
                    {analyzersOn && cur?.protocol && can("analyzers.ingest") ? <Button size="sm" variant="outline" disabled={sim.isPending} onClick={() => sim.mutate(s.id)}><Play aria-hidden className="size-4" />{t("work.runAnalyzer")}</Button> : null}
                  </div>
                </div>
                <ul className="divide-y divide-border/70">
                  {cells.map((c: any) => <ResultRow key={`${c.it.id}-${c.a.id}`} item={c.it} analyte={c.a} result={c.r} instrumentId={chosen} canEnter={can("results.enter")} canSecond={can("results.second_entry")} canTech={canTech} />)}
                </ul>
              </Surface>
            );
          })}
        </div>
      )}
      <BulkBar count={picked.length} label={t("ux.worklist.selected", { n: selectedIds.length })} clearLabel={t("ux.clear")} onClear={() => setPicked([])}>
        <Button disabled={bulk.isPending || !selectedIds.length} onClick={() => bulk.mutate()}><CheckCheck aria-hidden className="size-4" />{t("ux.worklist.bulkValidate", { n: selectedIds.length })}</Button>
      </BulkBar>
    </>
  );
}
