import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, Select, Spinner, Table, Tabs, Td, useToast } from "@/components/ui";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";
import { LeveyJenningsChart, type LjData } from "./LeveyJenningsChart";

const RULES = ["1_2s", "1_3s", "2_2s", "R_4s", "4_1s", "10x"];

/** KLQC02: QC runs, Levey-Jennings, Westgard evaluation, QC blocks and documented clearance. */
export function QcPage() {
  const { t, i18n } = useTranslation();
  const { can, flagOn, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("charts");
  const [instrumentId, setInstrumentId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [value, setValue] = useState("");
  const [clear, setClear] = useState<any>(null);
  const [runId, setRunId] = useState("");
  const [note, setNote] = useState("");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<any[]>("/instruments") });
  const materials = useQuery({ queryKey: ["qc-materials"], queryFn: () => api<any[]>("/qc/materials") });
  const blocks = useQuery({ queryKey: ["qc-blocks"], queryFn: () => api<any[]>("/qc/blocks"), refetchInterval: 20_000 });
  const inst = instrumentId || instruments.data?.[0]?.id || "";
  const mat = materialId || materials.data?.[0]?.id || "";
  const lj = useQuery({ queryKey: ["lj", inst, mat], queryFn: () => api<LjData>(`/qc/levey-jennings?instrumentId=${inst}&materialId=${mat}`), enabled: Boolean(inst && mat) });
  const runs = useQuery({ queryKey: ["qc-runs", inst], queryFn: () => api<any[]>(`/qc/runs?instrumentId=${inst}&limit=30`), enabled: Boolean(inst) });
  const clearRuns = useQuery({ queryKey: ["clear-runs", clear?.id], queryFn: () => api<any[]>(`/qc/runs?instrumentId=${clear.instrumentId}&limit=30`), enabled: Boolean(clear) });
  const m = materials.data?.find((x) => x.id === mat);
  const [last, setLast] = useState<any>(null);
  useEffect(() => setLast(null), [inst, mat]);
  const submit = useMutation({ mutationFn: () => api<any>("/qc/runs", { body: { instrumentId: inst, materialId: mat, value: Number(value) } }), onSuccess: (r) => { setLast(r); setValue(""); void qc.invalidateQueries(); toast(t(`qc.result.${r.run.status}`), r.run.status === "PASS" ? "ok" : r.run.status === "WARNING" ? "warn" : "crit"); } });
  const analyzersOn = flagOn("lab.analyzer_interfaces") && (me?.capabilities.includes("analyzer_interfaces") ?? false);
  const sim = useMutation({ mutationFn: (z: number) => api<any>("/analyzers/simulate", { body: { instrumentId: inst, qc: { materialId: mat, z } } }), onSuccess: () => void qc.invalidateQueries() });
  const doClear = useMutation({ mutationFn: () => api(`/qc/blocks/${clear.id}/clear`, { body: { clearedByRunId: runId, note } }), onSuccess: () => { setClear(null); setNote(""); setRunId(""); void qc.invalidateQueries(); toast(t("qc.cleared")); } });
  const open = (blocks.data ?? []).filter((b) => b.status === "OPEN");
  const passing = (clearRuns.data ?? []).filter((r) => r.status === "PASS" && clear && new Date(r.runAt) > new Date(clear.openedByRun.runAt) && r.material.analyte.code && r.id !== clear.openedByRunId);
  return (
    <>
      <PageHeader title={t("qc.title")} sub={t("qc.sub")} />
      {open.length > 0 ? (
        <div role="alert" className="mb-4 rounded-lg border-s-4 border-red-500 bg-red-50 p-4 text-red-900 dark:bg-red-950 dark:text-red-100">
          <p className="font-semibold">{t("qc.blocked", { n: open.length })}</p>
          <p className="text-sm">{t("qc.blockedNote")}</p>
        </div>
      ) : null}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "charts", label: t("qc.charts") }, { id: "blocks", label: `${t("qc.blocks")} (${open.length})` }, { id: "rules", label: t("qc.rules") }]} />
      {tab === "charts" ? (
        <div className="space-y-4">
          <Card className="grid gap-3 md:grid-cols-4">
            <Field label={t("work.instrument")}><Select value={inst} onChange={(e) => setInstrumentId(e.target.value)}>{instruments.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
            <Field label={t("qc.material")} className="md:col-span-2"><Select value={mat} onChange={(e) => setMaterialId(e.target.value)}>{materials.data?.map((x) => <option key={x.id} value={x.id}>{x.analyte.code} · {t(`qc.levels.${x.level}`)} · {x.materialLot}</option>)}</Select></Field>
            {can("qc.run") ? (
              <div className="flex items-end gap-2">
                <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder={m ? `${Number(m.targetMean)} ± ${Number(m.targetSd)}` : ""} aria-label={t("qc.value")} />
                <Button disabled={!value || submit.isPending} onClick={() => submit.mutate()}>{t("qc.record")}</Button>
              </div>
            ) : null}
          </Card>
          <ErrorNote error={submit.error ?? sim.error} />
          {last ? (
            <Card className={last.run.status === "FAIL" ? "ring-2 ring-red-500" : last.run.status === "WARNING" ? "ring-2 ring-amber-400" : ""}>
              <div className="flex flex-wrap items-center gap-2"><StatusBadge value={last.run.status} /><span className="text-sm">z = {Number(last.run.zScore).toFixed(2)}</span>{last.evaluation.violated.map((r: string) => <Badge key={r} tone="crit">{r}</Badge>)}{last.evaluation.warnings.map((r: string) => <Badge key={r} tone="warn">{r}</Badge>)}</div>
              {last.blockId ? <p className="mt-2 text-sm font-medium text-red-700">{t("qc.blockOpened", { n: last.revokedResults })}</p> : null}
            </Card>
          ) : null}
          <Card>
            {lj.isLoading ? <Spinner /> : lj.data && lj.data.points.length ? <LeveyJenningsChart data={lj.data} /> : <Empty>{t("qc.noRuns")}</Empty>}
            {analyzersOn && can("analyzers.ingest") && instruments.data?.find((i) => i.id === inst)?.protocol ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm"><span className="text-muted-foreground">{t("qc.simulate")}</span>{[0, 1.5, 2.5, 3.5].map((z) => <Button key={z} size="sm" variant="outline" onClick={() => sim.mutate(z)}>z = {z}</Button>)}</div>
            ) : null}
          </Card>
          {runs.data?.length ? (
            <Table head={[t("qc.runAt"), t("qc.material"), t("qc.value"), "z", t("common.status"), t("qc.violations")]}>
              {runs.data.map((r) => <tr key={r.id}><Td>{dt(r.runAt, i18n.language)}</Td><Td>{r.material.analyte.code} · {t(`qc.levels.${r.material.level}`)}</Td><Td className="font-mono">{Number(r.value)}</Td><Td>{Number(r.zScore).toFixed(2)}</Td><Td><StatusBadge value={r.status} /></Td><Td>{r.violatedRules.join(", ") || "-"}</Td></tr>)}
            </Table>
          ) : null}
        </div>
      ) : null}
      {tab === "blocks" ? (
        blocks.data?.length ? (
          <Table head={[t("work.instrument"), t("qc.rule"), t("qc.openedAt"), t("common.status"), t("qc.clearNote"), ""]}>
            {blocks.data.map((b) => (
              <tr key={b.id}><Td>{b.instrument.name}</Td><Td><Badge tone="crit">{b.rule}</Badge></Td><Td>{dt(b.openedAt, i18n.language)}</Td><Td><StatusBadge value={b.status} /></Td><Td className="text-xs">{b.clearNote ?? "-"}</Td>
                <Td className="text-end">{b.status === "OPEN" && can("qc.clear_block") ? <Button size="sm" onClick={() => setClear(b)}>{t("qc.clear")}</Button> : null}</Td></tr>
            ))}
          </Table>
        ) : <Empty>{t("qc.noBlocks")}</Empty>
      ) : null}
      {tab === "rules" ? (
        <Card>
          <CardTitle>{t("qc.rulesTitle")}</CardTitle>
          <ul className="space-y-2 text-sm">{RULES.map((r) => <li key={r} className="flex gap-3"><Badge tone={r === "1_2s" ? "warn" : "crit"}>{r}</Badge><span>{t(`qc.ruleText.${r}`)}</span></li>)}</ul>
          <p className="mt-3 text-xs text-muted-foreground">{t("qc.rulesNote")}</p>
        </Card>
      ) : null}
      <Modal open={Boolean(clear)} onClose={() => setClear(null)} title={t("qc.clearTitle")}>
        <p className="mb-3 text-sm text-muted-foreground">{t("qc.clearBody")}</p>
        <Field label={t("qc.passingRun")}><Select value={runId} onChange={(e) => setRunId(e.target.value)}><option value="">-</option>{passing.map((r) => <option key={r.id} value={r.id}>{dt(r.runAt, i18n.language)} · {r.material.analyte.code} · {Number(r.value)}</option>)}</Select></Field>
        {passing.length === 0 ? <p className="mt-2 text-xs text-amber-700">{t("qc.needPassingRun")}</p> : null}
        <Field label={t("qc.clearNote")} className="mt-3"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("qc.clearPlaceholder")} /></Field>
        <div className="mt-4 space-y-2"><ErrorNote error={doClear.error} /><Button disabled={!runId || note.trim().length < 10 || doClear.isPending} onClick={() => doClear.mutate()}>{t("qc.clear")}</Button></div>
      </Modal>
    </>
  );
}
