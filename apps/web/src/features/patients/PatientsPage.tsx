import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { GitMerge, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Modal, Select, Table, Tabs, Td, Textarea, useToast } from "@/components/ui";
import { SearchBox } from "@/components/kit";
import { EmptyState, Surface, TableSkeleton } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

const BLOOD = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

/** M1 standalone patient registry: search, register, duplicate detection and merge. */
export function PatientsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: "", dateOfBirth: "", sex: "UNKNOWN", phone: "", nationalId: "", email: "", city: "", bloodGroup: "", notes: "" });
  const [merge, setMerge] = useState<{ members: any[]; target: string } | null>(null);
  const list = useQuery({ queryKey: ["patient-registry", q], queryFn: () => api<any[]>(`/patient-registry?search=${encodeURIComponent(q)}&limit=100`) });
  const dups = useQuery({ queryKey: ["patient-dups"], queryFn: () => api<any[]>("/patient-registry/duplicates"), enabled: tab === "dups" && can("patients.merge") });
  const create = useMutation({
    mutationFn: () => api<any>("/patients", { body: Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "")) }),
    onSuccess: (p) => { setOpen(false); void qc.invalidateQueries({ queryKey: ["patient-registry"] }); nav(`/patients/${p.id}`); },
  });
  const doMerge = useMutation({
    mutationFn: async () => { for (const m of merge!.members.filter((x) => x.id !== merge!.target)) await api(`/patients/${m.id}/merge`, { body: { targetId: merge!.target } }); },
    onSuccess: () => { setMerge(null); void qc.invalidateQueries(); toast(t("pat.merged")); },
  });
  const tabs = [{ id: "all", label: t("pat.all") }, ...(can("patients.merge") ? [{ id: "dups", label: t("pat.duplicates") }] : [])];
  return (
    <>
      <PageHeader title={t("pat.title")} sub={t("pat.sub")} actions={can("patients.write") ? <Button onClick={() => setOpen(true)}><UserPlus aria-hidden className="size-4" />{t("pat.new")}</Button> : null} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "all" ? (
        <>
          <div className="mb-3"><SearchBox value={q} onChange={setQ} placeholder={t("pat.searchHint")} /></div>
          {list.isLoading ? <Surface><TableSkeleton rows={8} cols={6} /></Surface> : !list.data?.length ? <EmptyState title={t("common.none")} /> : (
            <Table head={[t("pat.mrn"), t("orders.fullName"), t("orders.dob"), t("orders.sex"), t("orders.phone"), t("pat.visits")]}>
              {list.data.map((p) => (
                <tr key={p.id} className="hover:bg-accent/40">
                  <Td><Link className="font-mono text-xs font-semibold text-primary hover:underline" to={`/patients/${p.id}`}>{p.mrn ?? "-"}</Link></Td>
                  <Td><Link to={`/patients/${p.id}`} className="font-medium hover:underline" dir="auto">{p.fullName}</Link>{p.conditions?.length ? <Badge tone="info" className="ms-2">{p.conditions.join(", ")}</Badge> : null}</Td>
                  <Td>{p.dateOfBirth ? dOnly(p.dateOfBirth, i18n.language) : "-"}</Td>
                  <Td>{t(`orders.sexes.${p.sex}`, { defaultValue: p.sex })}</Td>
                  <Td><bdi dir="ltr" className="tabular-nums">{p.phone ?? "-"}</bdi></Td>
                  <Td className="tabular-nums">{p._count?.orders ?? 0}</Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("pat.dupNote")}</p>
          {dups.isLoading ? <Surface><TableSkeleton rows={3} cols={4} /></Surface> : !dups.data?.length ? <EmptyState title={t("pat.noDups")} /> : dups.data.map((g, i) => (
            <Card key={i} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">{g.reasons.map((r: string) => <Badge key={r} tone="warn">{t(`pat.reason.${r}`, { defaultValue: r })}</Badge>)}</div>
              <ul className="divide-y divide-border text-sm">{g.members.map((m: any) => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span><Link className="font-medium hover:underline" to={`/patients/${m.id}`} dir="auto">{m.fullName}</Link> <span className="font-mono text-xs text-muted-foreground">{m.mrn}</span></span><span className="text-xs text-muted-foreground">{m.dateOfBirth ? dOnly(m.dateOfBirth, i18n.language) : ""} · <bdi dir="ltr">{m.phone ?? ""}</bdi></span></li>)}</ul>
              <Button size="sm" variant="outline" onClick={() => setMerge({ members: g.members, target: g.members[0].id })}><GitMerge aria-hidden className="size-4" />{t("pat.merge")}</Button>
            </Card>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={t("pat.new")} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("orders.fullName")} className="sm:col-span-2"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} autoFocus /></Field>
          <Field label={t("orders.dob")}><Input type="date" value={f.dateOfBirth} onChange={(e) => setF({ ...f, dateOfBirth: e.target.value })} /></Field>
          <Field label={t("orders.sex")}><Select value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}>{["F", "M", "OTHER", "UNKNOWN"].map((s) => <option key={s} value={s}>{t(`orders.sexes.${s}`)}</option>)}</Select></Field>
          <Field label={t("orders.phone")}><Input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label={t("orders.nationalId")}><Input value={f.nationalId} inputMode="numeric" onChange={(e) => setF({ ...f, nationalId: e.target.value })} /></Field>
          <Field label={t("pat.email")}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label={t("pat.city")}><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label={t("pat.blood")}><Select value={f.bloodGroup} onChange={(e) => setF({ ...f, bloodGroup: e.target.value })}>{BLOOD.map((b) => <option key={b} value={b}>{b || "-"}</option>)}</Select></Field>
          <Field label={t("pat.notes")} className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-4 space-y-2"><ErrorNote error={create.error} /><Button disabled={f.fullName.length < 2 || create.isPending} onClick={() => create.mutate()}>{t("common.save")}</Button></div>
      </Modal>
      <Modal open={Boolean(merge)} onClose={() => setMerge(null)} title={t("pat.merge")}>
        {merge ? (
          <div className="space-y-3 text-sm">
            <p>{t("pat.mergeNote")}</p>
            <div className="space-y-1">{merge.members.map((m) => <label key={m.id} className="flex items-center gap-2"><input type="radio" name="keep" checked={merge.target === m.id} onChange={() => setMerge({ ...merge, target: m.id })} /><span dir="auto">{m.fullName}</span><span className="font-mono text-xs text-muted-foreground">{m.mrn}</span></label>)}</div>
            <ErrorNote error={doMerge.error} />
            <Button disabled={doMerge.isPending} onClick={() => doMerge.mutate()}>{t("pat.mergeConfirm")}</Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
