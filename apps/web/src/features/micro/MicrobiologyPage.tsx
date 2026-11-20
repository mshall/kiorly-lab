import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bug, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Tabs, Td, Textarea, useToast } from "@/components/ui";
import { PriorityChip } from "@/components/kit";
import { EmptyState, Skeleton, Surface } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

const SI = ["S", "I", "R", "SDD", "NS"];
const tone = (x: string) => (x === "S" ? "ok" : x === "R" ? "crit" : "warn") as "ok" | "crit" | "warn";

/** M4 microbiology: culture & sensitivity cases (isolates, antibiotic panels, selective reporting) and histopathology / cytology reporting. */
export function MicrobiologyPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("micro");
  const [sel, setSel] = useState<string | null>(null);
  const [hsel, setHsel] = useState<string | null>(null);
  const [open, setOpen] = useState<any>(null);
  const [iso, setIso] = useState({ organismId: "", quantity: "" });
  const [fin, setFin] = useState({ instrumentId: "", comment: "" });
  const [sus, setSus] = useState<Record<string, { interpretation: string; reported: boolean }>>({});
  const cases = useQuery({ queryKey: ["micro-cases"], queryFn: () => api<any[]>("/microbiology/cases"), enabled: tab === "micro" });
  const c = useQuery({ queryKey: ["micro-case", sel], queryFn: () => api<any>(`/microbiology/cases/${sel}`), enabled: Boolean(sel) });
  const orgs = useQuery({ queryKey: ["organisms"], queryFn: () => api<any[]>("/microbiology/organisms"), enabled: Boolean(sel) });
  const abx = useQuery({ queryKey: ["antibiotics"], queryFn: () => api<any[]>("/microbiology/antibiotics"), enabled: Boolean(sel) });
  const panels = useQuery({ queryKey: ["panels"], queryFn: () => api<any[]>("/microbiology/panels"), enabled: Boolean(sel) });
  const insts = useQuery({ queryKey: ["instruments"], queryFn: () => api<any[]>("/instruments"), enabled: Boolean(sel || hsel) });
  const pending = useQuery({ queryKey: ["micro-pending"], queryFn: () => api<any[]>("/worklist?section=MICROBIOLOGY"), enabled: Boolean(open) });
  const hcases = useQuery({ queryKey: ["histo-cases"], queryFn: () => api<any[]>("/histopathology/cases"), enabled: tab === "histo" });
  const h = useQuery({ queryKey: ["histo-case", hsel], queryFn: () => api<any>(`/histopathology/cases/${hsel}`), enabled: Boolean(hsel) });
  const [hf, setHf] = useState<any>({});
  const refresh = () => void qc.invalidateQueries();
  const mc = (path: string, body: object, method = "POST") => api(`/microbiology/cases/${sel}${path}`, { method, body });
  const upd = useMutation({ mutationFn: (b: object) => mc("", b, "PUT"), onSuccess: refresh });
  const addIso = useMutation({ mutationFn: () => mc("/isolates", { organismId: iso.organismId, quantity: iso.quantity || undefined }), onSuccess: () => { setIso({ organismId: "", quantity: "" }); refresh(); } });
  const saveSus = useMutation({ mutationFn: (isolateId: string) => mc(`/isolates/${isolateId}/susceptibilities`, { rows: Object.entries(sus).map(([antibioticId, v]) => ({ antibioticId, interpretation: v.interpretation, reported: v.reported })) }, "PUT"), onSuccess: () => { setSus({}); refresh(); toast(t("common.saved")); } });
  const finalize = useMutation({ mutationFn: () => mc("/finalize", { instrumentId: fin.instrumentId, comment: fin.comment || undefined }), onSuccess: () => { refresh(); toast(t("mic.finalised")); } });
  const openCase = useMutation({ mutationFn: () => api("/microbiology/cases", { body: open }), onSuccess: (r: any) => { setOpen(null); setSel(r.id); refresh(); } });
  const hu = useMutation({ mutationFn: (b: object) => api(`/histopathology/cases/${hsel}`, { method: "PUT", body: b }), onSuccess: () => { refresh(); toast(t("common.saved")); } });
  const hadv = useMutation({ mutationFn: () => api(`/histopathology/cases/${hsel}/advance`, { body: {} }), onSuccess: refresh });
  const hsign = useMutation({ mutationFn: () => api(`/histopathology/cases/${hsel}/sign-out`, { body: { instrumentId: fin.instrumentId } }), onSuccess: () => { refresh(); toast(t("mic.signedOut")); } });
  const hadd = useMutation({ mutationFn: (text: string) => api(`/histopathology/cases/${hsel}/addenda`, { body: { text } }), onSuccess: refresh });
  const d = c.data;
  const panelFor = (organismGroup: string) => panels.data?.find((p) => p.organismGroup === organismGroup);
  const tabs = [{ id: "micro", label: t("mic.culture") }, { id: "histo", label: t("mic.histo") }];
  const hstat = ["RECEIVED", "GROSSING", "PROCESSING", "REPORTING", "SIGNED_OUT"];
  return (
    <>
      <PageHeader title={t("mic.title")} sub={t("mic.sub")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "micro" ? (
        <>
          {can("micro.enter") ? <div className="mb-3"><Button size="sm" onClick={() => setOpen({ orderItemId: "", site: "", gramStain: "" })}><Plus aria-hidden className="size-4" />{t("mic.open")}</Button></div> : null}
          {cases.isLoading ? <Skeleton className="h-48" /> : !cases.data?.length ? <EmptyState title={t("common.none")} /> : (
            <Table head={[t("order.number"), t("orders.patient"), t("cat.test"), t("mic.site"), t("common.status"), t("mic.isolates"), ""]}>
              {cases.data.map((x) => <tr key={x.id} className="cursor-pointer hover:bg-accent/40" onClick={() => setSel(x.id)}><Td className="font-mono text-xs">{x.item?.order.orderNumber}</Td><Td dir="auto">{x.item?.order.patient.fullName}</Td><Td>{x.item?.test.code} <PriorityChip priority={x.item?.order.priority} /></Td><Td>{x.site ?? "-"}</Td><Td><Badge tone={x.status === "FINAL" ? "ok" : "info"}>{t(`mic.status.${x.status}`)}</Badge>{x.growth === true ? <Badge tone="warn" className="ms-1">{t("mic.growth")}</Badge> : x.growth === false ? <Badge tone="ok" className="ms-1">{t("mic.noGrowth")}</Badge> : null}</Td><Td className="tabular-nums">{x.isolateCount}</Td><Td className="text-xs text-muted-foreground">{dt(x.createdAt, i18n.language)}</Td></tr>)}
            </Table>
          )}
        </>
      ) : (
        !hcases.data?.length ? <EmptyState title={t("common.none")} /> : (
          <Table head={[t("order.number"), t("orders.patient"), t("cat.test"), t("mic.site"), t("common.status"), ""]}>
            {hcases.data.map((x) => <tr key={x.id} className="cursor-pointer hover:bg-accent/40" onClick={() => { setHsel(x.id); setHf({}); }}><Td className="font-mono text-xs">{x.item?.order.orderNumber}</Td><Td dir="auto">{x.item?.order.patient.fullName}</Td><Td>{x.item?.test.code}</Td><Td>{x.site ?? "-"}</Td><Td><Badge tone={x.status === "SIGNED_OUT" ? "ok" : "info"}>{t(`mic.hstatus.${x.status}`)}</Badge></Td><Td className="text-xs text-muted-foreground">{dt(x.createdAt, i18n.language)}</Td></tr>)}
          </Table>
        )
      )}
      <Modal open={Boolean(sel)} onClose={() => setSel(null)} title={d ? `${d.item?.order.orderNumber} · ${d.item?.test.nameEn}` : t("mic.culture")} xl>
        {d ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2"><Bug aria-hidden className="size-4 text-primary" /><span dir="auto" className="font-medium">{d.item?.order.patient.fullName}</span><Badge tone={d.status === "FINAL" ? "ok" : "info"}>{t(`mic.status.${d.status}`)}</Badge>{d.site ? <span className="text-sm text-muted-foreground">{d.site}</span> : null}</div>
            {d.status !== "FINAL" && can("micro.enter") ? (
              <div className="flex flex-wrap gap-2">
                {d.status === "RECEIVED" ? <Button size="sm" variant="outline" onClick={() => upd.mutate({ status: "INCUBATING" })}>{t("mic.startIncubation")}</Button> : null}
                {d.growth !== false && !d.isolates.length ? <Button size="sm" variant="outline" onClick={() => upd.mutate({ growth: false })}>{t("mic.markNoGrowth")}</Button> : null}
              </div>
            ) : null}
            <ErrorNote error={upd.error} />
            {d.isolates.map((i: any) => {
              const panel = panelFor(i.organism.gram === "NEG" ? "Enterobacterales" : i.organism.gram === "POS" ? "Staphylococcus" : "");
              return (
                <Card key={i.id} className="space-y-2">
                  <CardTitle><span dir="auto">{i.isolateNo}. {i.organism.nameEn}</span> {i.quantity ? <span className="text-xs font-normal text-muted-foreground">({i.quantity})</span> : null}</CardTitle>
                  {i.susceptibilities.length ? <div className="flex flex-wrap gap-1.5">{i.susceptibilities.map((s: any) => <Badge key={s.id} tone={tone(s.interpretation)} className={s.reported ? "" : "opacity-50"}>{s.antibiotic.nameEn}: {s.interpretation}</Badge>)}</div> : <p className="text-xs text-muted-foreground">{t("mic.noSusc")}</p>}
                  {d.status !== "FINAL" && can("micro.enter") ? (
                    <details className="rounded-lg bg-muted/50 p-2"><summary className="cursor-pointer text-sm font-medium">{t("mic.enterSusc")}</summary>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{(panel?.antibiotics ?? abx.data ?? []).map((a: any) => { const v = sus[a.id]; return <div key={a.id} className="flex items-center gap-2 text-xs"><span className="w-40 truncate" dir="auto">{a.nameEn}</span><Select className="h-8 w-20" value={v?.interpretation ?? ""} onChange={(e) => setSus({ ...sus, [a.id]: { interpretation: e.target.value, reported: v?.reported ?? true } })}><option value="">-</option>{SI.map((s) => <option key={s}>{s}</option>)}</Select><label className="flex items-center gap-1"><input type="checkbox" checked={v?.reported ?? true} onChange={(e) => setSus({ ...sus, [a.id]: { interpretation: v?.interpretation ?? "S", reported: e.target.checked } })} />{t("mic.report")}</label></div>; })}</div>
                      <p className="mt-2 text-xs text-muted-foreground">{t("mic.breakpointNote")}</p>
                      <Button size="sm" className="mt-2" disabled={!Object.values(sus).some((v) => v.interpretation)} onClick={() => saveSus.mutate(i.id)}>{t("common.save")}</Button>
                    </details>
                  ) : null}
                </Card>
              );
            })}
            {d.status !== "FINAL" && can("micro.enter") && d.growth !== false ? (
              <Card className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><Field label={t("mic.organism")}><Select value={iso.organismId} onChange={(e) => setIso({ ...iso, organismId: e.target.value })}><option value="">-</option>{(orgs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.nameEn}</option>)}</Select></Field><Field label={t("mic.quantity")}><Input value={iso.quantity} onChange={(e) => setIso({ ...iso, quantity: e.target.value })} placeholder=">10^5 CFU/mL" /></Field><div className="flex items-end"><Button size="sm" disabled={!iso.organismId} onClick={() => addIso.mutate()}>{t("mic.addIsolate")}</Button></div></Card>
            ) : null}
            {d.status !== "FINAL" && can("micro.enter") && (d.growth !== null) ? (
              <Card className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"><Field label={t("qc.instrument")}><Select value={fin.instrumentId} onChange={(e) => setFin({ ...fin, instrumentId: e.target.value })}><option value="">-</option>{(insts.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field><Field label={t("common.note")}><Input value={fin.comment} onChange={(e) => setFin({ ...fin, comment: e.target.value })} /></Field><div className="flex items-end"><Button disabled={!fin.instrumentId || finalize.isPending} onClick={() => finalize.mutate()}>{t("mic.finalise")}</Button></div><div className="sm:col-span-3"><ErrorNote error={finalize.error ?? addIso.error ?? saveSus.error} /></div></Card>
            ) : null}
            {d.status === "FINAL" ? <Surface className="p-3 text-sm">{t("mic.finalNote")} <Link className="text-primary underline" to={`/orders/${d.item?.order.id}`}>{d.item?.order.orderNumber}</Link></Surface> : null}
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(hsel)} onClose={() => setHsel(null)} title={h.data ? `${h.data.item?.order.orderNumber} · ${h.data.item?.test.nameEn}` : t("mic.histo")} xl>
        {h.data ? (() => {
          const x = h.data;
          const ro = x.status === "SIGNED_OUT" || !can("histo.report");
          const val = (k: string) => hf[k] ?? x[k] ?? "";
          const idx = hstat.indexOf(x.status);
          return (
            <div className="space-y-4">
              <ol className="flex flex-wrap gap-2 text-xs">{hstat.map((s, i) => <li key={s} className={`rounded-full px-3 py-1 ${i <= idx ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{t(`mic.hstatus.${s}`)}</li>)}</ol>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("mic.site")}><Input disabled={ro} value={val("site")} onChange={(e) => setHf({ ...hf, site: e.target.value })} /></Field>
                <Field label={t("mic.morph")}><Input disabled={ro} value={val("morphologyCode")} onChange={(e) => setHf({ ...hf, morphologyCode: e.target.value })} /></Field>
                <Field label={t("mic.clinical")} className="sm:col-span-2"><Textarea rows={2} disabled={ro} value={val("clinicalHistory")} onChange={(e) => setHf({ ...hf, clinicalHistory: e.target.value })} /></Field>
                <Field label={t("mic.gross")} className="sm:col-span-2"><Textarea rows={3} disabled={ro} value={val("grossDescription")} onChange={(e) => setHf({ ...hf, grossDescription: e.target.value })} /></Field>
                <Field label={t("mic.micro")} className="sm:col-span-2"><Textarea rows={3} disabled={ro} value={val("microscopicDescription")} onChange={(e) => setHf({ ...hf, microscopicDescription: e.target.value })} /></Field>
                <Field label={t("mic.diagnosis")} className="sm:col-span-2"><Textarea rows={2} disabled={ro} value={val("diagnosis")} onChange={(e) => setHf({ ...hf, diagnosis: e.target.value })} /></Field>
                <Field label={t("mic.blocks")}><Input type="number" disabled={ro} value={val("blocks")} onChange={(e) => setHf({ ...hf, blocks: Number(e.target.value) })} /></Field>
                <Field label={t("mic.slides")}><Input type="number" disabled={ro} value={val("slides")} onChange={(e) => setHf({ ...hf, slides: Number(e.target.value) })} /></Field>
              </div>
              {x.addenda.length ? <Card><CardTitle>{t("mic.addenda")}</CardTitle><ul className="space-y-1 text-sm">{x.addenda.map((a: any) => <li key={a.id}>{dt(a.addedAt, i18n.language)}: <span dir="auto">{a.text}</span></li>)}</ul></Card> : null}
              <ErrorNote error={hu.error ?? hadv.error ?? hsign.error ?? hadd.error} />
              <div className="flex flex-wrap items-end gap-2">
                {!ro ? <Button variant="outline" onClick={() => { hu.mutate(hf); setHf({}); }} disabled={!Object.keys(hf).length}>{t("common.save")}</Button> : null}
                {!ro && x.status !== "REPORTING" ? <Button onClick={() => hadv.mutate()}>{t("mic.advance")}</Button> : null}
                {x.status === "REPORTING" && can("results.medical_validate") ? <><Select className="w-52" value={fin.instrumentId} onChange={(e) => setFin({ ...fin, instrumentId: e.target.value })}><option value="">{t("qc.instrument")}</option>{(insts.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select><Button variant="pulse" disabled={!fin.instrumentId} onClick={() => hsign.mutate()}>{t("mic.signOut")}</Button></> : null}
                {x.status === "SIGNED_OUT" && can("results.medical_validate") ? <Button variant="outline" onClick={() => { const text = window.prompt(t("mic.addendumPrompt")); if (text && text.length >= 5) hadd.mutate(text); }}>{t("mic.addAddendum")}</Button> : null}
              </div>
            </div>
          );
        })() : null}
      </Modal>
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={t("mic.open")}>
        {open ? <div className="space-y-3"><Field label={t("mic.orderItem")} hint={t("mic.orderItemHint")}><Select value={open.orderItemId} onChange={(e) => setOpen({ ...open, orderItemId: e.target.value })}><option value="">-</option>{(pending.data ?? []).flatMap((sp: any) => sp.items.filter((i: any) => !(cases.data ?? []).some((c) => c.orderItemId === i.id)).map((i: any) => <option key={i.id} value={i.id}>{sp.order.orderNumber} · {sp.order.patient.fullName} · {i.test.code}</option>))}</Select></Field><Field label={t("mic.site")}><Input value={open.site} onChange={(e) => setOpen({ ...open, site: e.target.value })} /></Field><Field label={t("mic.gram")}><Input value={open.gramStain} onChange={(e) => setOpen({ ...open, gramStain: e.target.value })} /></Field><ErrorNote error={openCase.error} /><Button disabled={!open.orderItemId} onClick={() => openCase.mutate()}>{t("mic.open")}</Button></div> : null}
      </Modal>
    </>
  );
}
