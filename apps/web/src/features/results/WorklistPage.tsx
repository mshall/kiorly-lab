import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, Empty, Input, Select, Spinner, useToast } from "@/components/ui";
import { ErrorNote, PageHeader, ResultValue, StatusBadge } from "@/components/common";

function ResultCell({ item, analyte, result, instrumentId, canEnter, canSecond, canTech }: { item: any; analyte: any; result: any; instrumentId: string; canEnter: boolean; canSecond: boolean; canTech: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState("");
  const [v2, setV2] = useState("");
  const refresh = () => void qc.invalidateQueries();
  const enter = useMutation({ mutationFn: () => api("/results", { body: { orderItemId: item.id, analyteId: analyte.id, instrumentId, value: Number(v) } }), onSuccess: () => { setV(""); refresh(); } });
  const second = useMutation({ mutationFn: () => api(`/results/${result.id}/second-entry`, { body: { value: Number(v2) } }), onSuccess: () => { setV2(""); refresh(); toast(t("work.confirmed")); } });
  const tech = useMutation({ mutationFn: () => api(`/results/${result.id}/tech-validate`, { body: {} }), onSuccess: refresh });
  const err = enter.error ?? second.error ?? tech.error;
  return (
    <div className="space-y-1 rounded-md bg-muted/60 p-2">
      <div className="flex items-center justify-between text-sm"><span className="font-medium">{analyte.nameEn} <span className="text-xs text-muted-foreground">({analyte.code})</span></span><span className="text-xs text-muted-foreground">{analyte.unit}</span></div>
      {!result ? (
        canEnter ? <div className="flex gap-2"><Input type="number" step="any" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label={`${analyte.code} ${t("work.value")}`} disabled={!instrumentId} /><Button size="sm" disabled={!v || !instrumentId || enter.isPending} onClick={() => enter.mutate()}>{t("work.enter")}</Button></div> : <span className="text-xs text-muted-foreground">-</span>
      ) : (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm"><ResultValue value={result.valueNumeric ?? result.valueText} flag={result.flag} /><StatusBadge value={result.status} />{result.autoVerified ? <Badge tone="info">{t("order.auto")}</Badge> : null}{result.deltaCheckFailed ? <Badge tone="warn">Δ {result.deltaPercent}%</Badge> : null}<span className="text-xs text-muted-foreground"><bdi dir="ltr">{result.refLow ?? ""}–{result.refHigh ?? ""}</bdi></span></div>
          {result.status === "ENTERED" && result.source === "MANUAL" && !result.secondEntryBy && canSecond ? (
            <div className="flex gap-2"><Input type="number" step="any" value={v2} onChange={(e) => setV2(e.target.value)} placeholder={t("work.rekey")} aria-label={t("work.rekey")} /><Button size="sm" variant="secondary" disabled={!v2} onClick={() => second.mutate()}>{t("work.confirm")}</Button></div>
          ) : null}
          {result.status === "ENTERED" && (result.source !== "MANUAL" || result.secondEntryBy) && canTech && !result.deltaCheckFailed ? <Button size="sm" onClick={() => tech.mutate()}>{t("work.techValidate")}</Button> : null}
          {result.status === "ENTERED" && result.source === "MANUAL" && !result.secondEntryBy ? <Badge tone="warn">{t("work.dualPending")}</Badge> : null}
          {result.deltaCheckFailed && result.status === "ENTERED" ? <Link className="text-xs text-primary underline" to="/validation">{t("work.deltaReview")}</Link> : null}
        </div>
      )}
      <ErrorNote error={err} />
    </div>
  );
}

/** Technologist bench: results entry with dual control; analyzer simulator when interfaces are enabled. */
export function WorklistPage() {
  const { t } = useTranslation();
  const { can, flagOn, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [instrumentId, setInstrumentId] = useState("");
  const [mode, setMode] = useState("normal");
  const instruments = useQuery({ queryKey: ["instruments"], queryFn: () => api<any[]>("/instruments") });
  const wl = useQuery({ queryKey: ["worklist"], queryFn: () => api<any[]>("/worklist"), refetchInterval: 20_000 });
  const inst = instruments.data?.filter((i) => i.active) ?? [];
  const chosen = instrumentId || inst[0]?.id || "";
  const cur = inst.find((i) => i.id === chosen);
  const analyzersOn = flagOn("lab.analyzer_interfaces") && (me?.capabilities.includes("analyzer_interfaces") ?? false);
  const sim = useMutation({ mutationFn: (specimenId: string) => api<any>("/analyzers/simulate", { body: { instrumentId: chosen, specimenId, mode } }), onSuccess: (r) => { void qc.invalidateQueries(); toast(t("work.simDone", { n: r.outcome.accepted })); } });
  return (
    <>
      <PageHeader title={t("work.title")} sub={t("work.sub")} />
      <Card className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem]"><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="inst">{t("work.instrument")}</label><Select id="inst" value={chosen} onChange={(e) => setInstrumentId(e.target.value)}>{inst.map((i) => <option key={i.id} value={i.id}>{i.name}{i.protocol ? ` (${i.protocol})` : ""}</option>)}</Select></div>
        {analyzersOn && cur?.protocol ? <div><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="mode">{t("work.simMode")}</label><Select id="mode" value={mode} onChange={(e) => setMode(e.target.value)}>{["normal", "abnormal", "critical"].map((m) => <option key={m} value={m}>{t(`work.modes.${m}`)}</option>)}</Select></div> : null}
        {!analyzersOn ? <Badge tone="warn">{t("work.manualOnly")}</Badge> : null}
        <p className="text-xs text-muted-foreground">{t("work.qcNote")}</p>
      </Card>
      <ErrorNote error={sim.error} />
      {wl.isLoading ? <Spinner /> : !wl.data?.length ? <Empty>{t("work.empty")}</Empty> : (
        <div className="space-y-4">
          {wl.data.map((s) => (
            <Card key={s.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Link to={`/orders/${s.order.id}`} className="font-mono text-base font-bold text-primary underline">{s.accessionNumber}</Link>
                <span className="text-sm">{s.order.patient.fullName}</span>
                {s.order.priority !== "ROUTINE" ? <Badge tone="crit">{s.order.priority}</Badge> : null}
                {analyzersOn && cur?.protocol && can("analyzers.ingest") ? <Button size="sm" variant="outline" className="ms-auto" disabled={sim.isPending} onClick={() => sim.mutate(s.id)}>{t("work.runAnalyzer")}</Button> : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {s.items.flatMap((it: any) => it.analytes.map((a: any) => (
                  <ResultCell key={`${it.id}-${a.id}`} item={it} analyte={a} result={it.results.find((r: any) => r.analyteId === a.id)} instrumentId={chosen} canEnter={can("results.enter")} canSecond={can("results.second_entry")} canTech={can("results.tech_validate")} />
                )))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
