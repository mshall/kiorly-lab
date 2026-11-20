import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Box, Truck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Field, Input, Modal, Select, Table, Tabs, Td, useToast } from "@/components/ui";
import { EmptyState } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

const KINDS = ["FRIDGE", "FREEZER_MINUS20", "FREEZER_MINUS80", "ROOM_TEMP", "RACK"];

/** M3 pre-analytics: storage units + retention/disposal, recollections, transport manifests with courier tracking. */
export function StoragePage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("storage");
  const [unit, setUnit] = useState<string | null>(null);
  const [newUnit, setNewUnit] = useState<any>(null);
  const [man, setMan] = useState<any>(null);
  const [recv, setRecv] = useState<any>(null);
  const [ev, setEv] = useState<{ id: string; status: string; location: string } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const units = useQuery({ queryKey: ["storage-units"], queryFn: () => api<any[]>("/storage/units") });
  const grid = useQuery({ queryKey: ["storage-unit", unit], queryFn: () => api<any>(`/storage/units/${unit}`), enabled: Boolean(unit) });
  const due = useQuery({ queryKey: ["disposal-due"], queryFn: () => api<any[]>("/storage/disposal-due"), enabled: tab === "disposal" });
  const recol = useQuery({ queryKey: ["recollections"], queryFn: () => api<any[]>("/recollections"), enabled: tab === "recol" });
  const mans = useQuery({ queryKey: ["manifests"], queryFn: () => api<any[]>("/manifests"), enabled: tab === "transport" });
  const stored = useQuery({ queryKey: ["stored-specimens"], queryFn: () => api<any[]>("/specimens?status=STORED&limit=100"), enabled: Boolean(man) });
  const labs = useQuery({ queryKey: ["labs"], queryFn: () => api<any[]>("/labs"), enabled: Boolean(man) });
  const refresh = () => void qc.invalidateQueries();
  const mkUnit = useMutation({ mutationFn: () => api("/storage/units", { body: { name: newUnit.name, kind: newUnit.kind, rows: Number(newUnit.rows), cols: Number(newUnit.cols) } }), onSuccess: () => { setNewUnit(null); refresh(); toast(t("common.saved")); } });
  const dispose = useMutation({ mutationFn: () => api("/storage/dispose", { body: { specimenIds: picked } }), onSuccess: () => { setPicked([]); refresh(); toast(t("sto.disposed")); } });
  const notify = useMutation({ mutationFn: (id: string) => api(`/recollections/${id}/notify`, { body: {} }), onSuccess: () => { refresh(); toast(t("sto.notified")); } });
  const mkMan = useMutation({ mutationFn: () => api("/manifests", { body: { kind: man.kind, ...(man.kind === "INTER_BRANCH" ? { toLabId: man.toLabId } : { destinationName: man.destinationName }), specimenIds: man.specimenIds, courierName: man.courierName || undefined } }), onSuccess: () => { setMan(null); refresh(); toast(t("common.saved")); } });
  const step = useMutation({ mutationFn: (v: { id: string; act: string; body?: object }) => api(`/manifests/${v.id}/${v.act}`, { body: v.body ?? {} }), onSuccess: () => { setEv(null); setRecv(null); refresh(); } });
  const tabs = [{ id: "storage", label: t("sto.units") }, { id: "disposal", label: t("sto.disposal") }, { id: "recol", label: t("sto.recollections") }, { id: "transport", label: t("sto.transport") }];
  return (
    <>
      <PageHeader title={t("sto.title")} sub={t("sto.sub")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "storage" ? (
        <>
          {can("storage.manage") ? <div className="mb-3"><Button size="sm" onClick={() => setNewUnit({ name: "", kind: "FRIDGE", rows: 6, cols: 10 })}>{t("sto.newUnit")}</Button></div> : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(units.data ?? []).map((u) => {
              const pct = Math.round((u.occupied / u.capacity) * 100);
              return <button key={u.id} type="button" onClick={() => setUnit(u.id)} className="rounded-xl border border-border bg-card p-4 text-start shadow-[var(--kx-shadow-1)] transition hover:border-primary">
                <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><Box aria-hidden className="size-4 text-primary" /><span dir="auto">{u.name}</span></span><Badge tone="info">{t(`sto.kinds.${u.kind}`)}</Badge></div>
                <div className="mb-1 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${pct > 85 ? "bg-[hsl(var(--danger-text))]" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div>
                <div className="flex justify-between text-xs text-muted-foreground"><span className="tabular-nums">{u.occupied}/{u.capacity}</span><span>{u.tempMinC != null ? `${u.tempMinC}…${u.tempMaxC} °C` : ""}</span></div>
              </button>;
            })}
          </div>
          {units.data && !units.data.length ? <EmptyState title={t("common.none")} /> : null}
        </>
      ) : null}
      {tab === "disposal" ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("sto.disposalNote")}</p>
          {can("specimens.process") && picked.length ? <Button size="sm" onClick={() => dispose.mutate()} disabled={dispose.isPending}>{t("sto.disposeN", { n: picked.length })}</Button> : null}
          <ErrorNote error={dispose.error} />
          {!due.data?.length ? <EmptyState title={t("sto.noneDue")} /> : (
            <Table head={["", t("spec.accession"), t("spec.type"), t("sto.location"), t("sto.retentionUntil")]}>
              {due.data.map((s) => <tr key={s.id}><Td><input aria-label={s.accessionNumber} type="checkbox" checked={picked.includes(s.id)} onChange={() => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id])} /></Td><Td className="font-mono text-xs font-semibold">{s.accessionNumber}</Td><Td>{s.specimenType}</Td><Td>{s.location ?? "-"}</Td><Td>{dt(s.retentionUntil, i18n.language)}</Td></tr>)}
            </Table>
          )}
        </div>
      ) : null}
      {tab === "recol" ? (
        !recol.data?.length ? <EmptyState title={t("common.none")} /> : (
          <Table head={[t("order.number"), t("orders.patient"), t("spec.rejectReason"), t("common.status"), t("common.date"), ""]}>
            {recol.data.map((r) => <tr key={r.id}><Td className="font-mono text-xs">{r.order?.orderNumber}</Td><Td dir="auto">{r.order?.patient.fullName}</Td><Td>{t(`spec.reasons.${r.reason}`, { defaultValue: r.reason })}{r.note ? <span className="block text-xs text-muted-foreground">{r.note}</span> : null}</Td><Td><Badge tone={r.status === "COLLECTED" ? "ok" : r.status === "CANCELLED" ? "muted" : "warn"}>{t(`sto.recolStatus.${r.status}`)}</Badge></Td><Td>{dt(r.createdAt, i18n.language)}</Td><Td>{can("specimens.reject") && !["COLLECTED", "CANCELLED"].includes(r.status) ? <Button size="sm" variant="outline" onClick={() => notify.mutate(r.id)}>{t("sto.notifyAgain")}</Button> : null}</Td></tr>)}
          </Table>
        )
      ) : null}
      {tab === "transport" ? (
        <div className="space-y-3">
          {can("manifests.manage") ? <Button size="sm" onClick={() => setMan({ kind: "INTER_BRANCH", toLabId: "", destinationName: "", courierName: "", specimenIds: [] })}><Truck aria-hidden className="size-4" />{t("sto.newManifest")}</Button> : null}
          {!mans.data?.length ? <EmptyState title={t("common.none")} /> : (
            <Table head={[t("sto.manifest"), t("sto.kind"), t("common.status"), t("sto.courier"), t("sto.specimens"), t("sto.tracking"), ""]}>
              {mans.data.map((m) => <tr key={m.id}><Td className="font-mono text-xs font-semibold">{m.number}</Td><Td>{t(`sto.manifestKinds.${m.kind}`)}</Td><Td><Badge tone={m.status === "RECEIVED" ? "ok" : m.status === "CANCELLED" ? "muted" : "info"}>{t(`sto.manifestStatus.${m.status}`)}</Badge></Td><Td>{m.courierName ?? "-"}</Td><Td className="tabular-nums">{m.itemCount}</Td><Td className="font-mono text-xs">{m.trackingRef}</Td>
                <Td>{can("manifests.manage") ? <div className="flex flex-wrap gap-1">
                  {m.status === "DRAFT" ? <Button size="sm" onClick={() => step.mutate({ id: m.id, act: "dispatch" })}>{t("sto.dispatch")}</Button> : null}
                  {["DISPATCHED", "IN_TRANSIT"].includes(m.status) ? <><Button size="sm" variant="outline" onClick={() => setEv({ id: m.id, status: "IN_TRANSIT", location: "" })}>{t("sto.addEvent")}</Button><Button size="sm" onClick={() => setRecv({ id: m.id, barcodes: "" })}>{t("sto.receive")}</Button></> : null}
                  {m.status === "DRAFT" ? <Button size="sm" variant="ghost" onClick={() => step.mutate({ id: m.id, act: "cancel" })}>{t("common.cancel")}</Button> : null}
                </div> : null}</Td></tr>)}
            </Table>
          )}
        </div>
      ) : null}
      <Modal open={Boolean(unit)} onClose={() => setUnit(null)} title={grid.data?.unit.name ?? ""} wide>
        {grid.data ? (() => {
          const u = grid.data.unit;
          const at = new Map<string, any>(grid.data.slots.map((s: any) => [s.slot, s]));
          return <div className="overflow-auto"><div className="inline-grid gap-1" style={{ gridTemplateColumns: `1.5rem repeat(${u.cols}, 2.4rem)`, direction: "ltr" }}>
            <span />{Array.from({ length: u.cols }, (_, c) => <span key={c} className="text-center text-[10px] text-muted-foreground">{c + 1}</span>)}
            {Array.from({ length: u.rows }, (_, r) => <>{<span key={`l${r}`} className="self-center text-[10px] text-muted-foreground">{String.fromCharCode(65 + r)}</span>}{Array.from({ length: u.cols }, (_, c) => { const s = at.get(`${String.fromCharCode(65 + r)}${c + 1}`); return <span key={`${r}-${c}`} title={s ? `${s.specimen?.accessionNumber ?? ""}` : ""} className={`grid h-8 place-items-center rounded text-[9px] font-mono ${s ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{s ? (s.specimen?.accessionNumber ?? "").slice(-4) : ""}</span>; })}</>)}
          </div></div>;
        })() : null}
      </Modal>
      <Modal open={Boolean(newUnit)} onClose={() => setNewUnit(null)} title={t("sto.newUnit")}>
        {newUnit ? <div className="space-y-3">
          <Field label={t("common.name")}><Input value={newUnit.name} onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })} autoFocus /></Field>
          <Field label={t("sto.kind")}><Select value={newUnit.kind} onChange={(e) => setNewUnit({ ...newUnit, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{t(`sto.kinds.${k}`)}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label={t("sto.rows")}><Input type="number" min="1" max="26" value={newUnit.rows} onChange={(e) => setNewUnit({ ...newUnit, rows: e.target.value })} /></Field><Field label={t("sto.cols")}><Input type="number" min="1" max="99" value={newUnit.cols} onChange={(e) => setNewUnit({ ...newUnit, cols: e.target.value })} /></Field></div>
          <ErrorNote error={mkUnit.error} /><Button disabled={!newUnit.name || mkUnit.isPending} onClick={() => mkUnit.mutate()}>{t("common.save")}</Button>
        </div> : null}
      </Modal>
      <Modal open={Boolean(man)} onClose={() => setMan(null)} title={t("sto.newManifest")} wide>
        {man ? <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("sto.kind")}><Select value={man.kind} onChange={(e) => setMan({ ...man, kind: e.target.value })}>{["INTER_BRANCH", "SEND_OUT"].map((k) => <option key={k} value={k}>{t(`sto.manifestKinds.${k}`)}</option>)}</Select></Field>
            {man.kind === "INTER_BRANCH" ? <Field label={t("sto.toBranch")}><Select value={man.toLabId} onChange={(e) => setMan({ ...man, toLabId: e.target.value })}><option value="">-</option>{(labs.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field> : <Field label={t("sto.destination")}><Input value={man.destinationName} onChange={(e) => setMan({ ...man, destinationName: e.target.value })} /></Field>}
            <Field label={t("sto.courier")}><Input value={man.courierName} onChange={(e) => setMan({ ...man, courierName: e.target.value })} /></Field>
          </div>
          <div className="max-h-56 space-y-1 overflow-auto rounded-lg border border-border p-2">{(stored.data ?? []).map((s: any) => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={man.specimenIds.includes(s.id)} onChange={() => setMan({ ...man, specimenIds: man.specimenIds.includes(s.id) ? man.specimenIds.filter((x: string) => x !== s.id) : [...man.specimenIds, s.id] })} /><span className="font-mono text-xs">{s.accessionNumber}</span><span className="text-muted-foreground">{s.specimenType}</span></label>)}{stored.data && !stored.data.length ? <p className="p-2 text-sm text-muted-foreground">{t("sto.noStored")}</p> : null}</div>
          <ErrorNote error={mkMan.error} /><Button disabled={!man.specimenIds.length || mkMan.isPending} onClick={() => mkMan.mutate()}>{t("common.save")}</Button>
        </div> : null}
      </Modal>
      <Modal open={Boolean(ev)} onClose={() => setEv(null)} title={t("sto.addEvent")}>
        {ev ? <div className="space-y-3"><Field label={t("common.status")}><Select value={ev.status} onChange={(e) => setEv({ ...ev, status: e.target.value })}>{["PICKED_UP", "IN_TRANSIT", "DELAYED", "DELIVERED", "NOTE"].map((s) => <option key={s} value={s}>{t(`sto.events.${s}`)}</option>)}</Select></Field><Field label={t("sto.location")}><Input value={ev.location} onChange={(e) => setEv({ ...ev, location: e.target.value })} /></Field><ErrorNote error={step.error} /><Button onClick={() => step.mutate({ id: ev.id, act: "events", body: { status: ev.status, location: ev.location || undefined } })}>{t("common.save")}</Button></div> : null}
      </Modal>
      <Modal open={Boolean(recv)} onClose={() => setRecv(null)} title={t("sto.receive")}>
        {recv ? <div className="space-y-3"><p className="text-sm text-muted-foreground">{t("sto.receiveNote")}</p><textarea className="min-h-28 w-full rounded-lg border border-input bg-card p-2 font-mono text-sm" value={recv.barcodes} onChange={(e) => setRecv({ ...recv, barcodes: e.target.value })} aria-label={t("sto.scanned")} /><ErrorNote error={step.error} /><Button onClick={() => step.mutate({ id: recv.id, act: "receive", body: { barcodes: recv.barcodes.split(/\s+/).filter(Boolean) } })}>{t("sto.receive")}</Button></div> : null}
      </Modal>
    </>
  );
}
