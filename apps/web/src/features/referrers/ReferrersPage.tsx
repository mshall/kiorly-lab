import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BriefcaseMedical, Copy, Link2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt, money } from "@/lib/format";
import { Badge, Button, Card, Field, Input, Modal, Select, Table, Tabs, Td, useToast } from "@/components/ui";
import { SearchBox } from "@/components/kit";
import { EmptyState, StatCard, Surface, TableSkeleton } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

const CHANNELS = ["WHATSAPP", "EMAIL", "SMS"];
const empty = { name: "", kind: "DOCTOR", specialty: "", phone: "", email: "", deliveryChannels: [] as string[], deliverOnRelease: false, commissionType: "NONE", commissionValue: "0", creditLimit: "", paymentTermsDays: "30" };

/** M1 referring doctors / clinics: directory, delivery preferences, commission + credit accounts, doctor-portal link. */
export function ReferrersPage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const cur = me?.tenant.currency;
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [form, setForm] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState("ledger");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [portal, setPortal] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["referrers", q], queryFn: () => api<any[]>(`/referrers?search=${encodeURIComponent(q)}`) });
  const detail = useQuery({ queryKey: ["referrer", sel], queryFn: () => api<any>(`/referrers/${sel}`), enabled: Boolean(sel) });
  const ledger = useQuery({ queryKey: ["referrer-ledger", sel], queryFn: () => api<any[]>(`/referrers/${sel}/ledger`), enabled: Boolean(sel) && can("finance.commissions") });
  const refresh = () => void qc.invalidateQueries();
  const save = useMutation({
    mutationFn: () => {
      const b: any = { ...form, commissionValue: Number(form.commissionValue || 0), paymentTermsDays: Number(form.paymentTermsDays || 30), creditLimit: form.creditLimit === "" ? null : Number(form.creditLimit) };
      for (const k of ["specialty", "phone", "email"]) if (b[k] === "") delete b[k];
      const id = b.id; delete b.id; delete b.portalEnabled; delete b.balances; delete b.orderCount; delete b.recentOrders; delete b.createdAt; delete b.orgId; delete b._count; delete b.active;
      return id ? api(`/referrers/${id}`, { method: "PUT", body: b }) : api("/referrers", { body: b });
    },
    onSuccess: () => { setForm(null); refresh(); toast(t("common.saved")); },
  });
  const act = useMutation({
    mutationFn: (kind: string) => api(`/referrers/${sel}/${kind}`, { body: { amount: Number(amount), memo: memo || undefined } }),
    onSuccess: () => { setAmount(""); setMemo(""); refresh(); toast(t("common.saved")); },
  });
  const issue = useMutation({ mutationFn: () => api<{ token: string }>(`/referrers/${sel}/portal-token`, { body: {} }), onSuccess: (r) => { setPortal(`${window.location.origin}/portal/${r.token}`); refresh(); } });
  const revoke = useMutation({ mutationFn: () => api(`/referrers/${sel}/portal-token`, { method: "DELETE" }), onSuccess: () => { setPortal(null); refresh(); toast(t("ref.portalRevoked")); } });
  const d = detail.data;
  return (
    <>
      <PageHeader title={t("ref.title")} sub={t("ref.sub")} actions={can("referrers.write") ? <Button onClick={() => setForm({ ...empty })}><Plus aria-hidden className="size-4" />{t("ref.new")}</Button> : null} />
      <div className="mb-3"><SearchBox value={q} onChange={setQ} placeholder={t("common.search")} /></div>
      {list.isLoading ? <Surface><TableSkeleton rows={6} cols={6} /></Surface> : !list.data?.length ? <EmptyState title={t("common.none")} /> : (
        <Table head={[t("ref.name"), t("ref.kind"), t("ref.commission"), t("ref.delivery"), t("ref.orders"), t("ref.commissionBalance"), t("ref.creditBalance")]}>
          {list.data.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-accent/40" onClick={() => { setSel(r.id); setTab("ledger"); setPortal(null); }}>
              <Td><span className="flex items-center gap-2 font-medium" dir="auto"><BriefcaseMedical aria-hidden className="size-4 text-muted-foreground" />{r.name}{!r.active ? <Badge tone="muted">{t("common.inactive")}</Badge> : null}</span><span className="text-xs text-muted-foreground">{r.specialty}</span></Td>
              <Td>{t(`ref.kinds.${r.kind}`)}</Td>
              <Td className="text-xs">{r.commissionType === "NONE" ? "-" : r.commissionType === "PERCENT" ? `${r.commissionValue}%` : money(r.commissionValue, cur, i18n.language)}</Td>
              <Td className="text-xs">{r.deliverOnRelease && r.deliveryChannels.length ? r.deliveryChannels.map((c: string) => t(`ref.chan.${c}`)).join(", ") : "-"}</Td>
              <Td className="tabular-nums">{r.orderCount}</Td>
              <Td className="tabular-nums">{money(r.balances.COMMISSION, cur, i18n.language)}</Td>
              <Td className="tabular-nums">{r.creditLimit != null ? `${money(r.balances.CREDIT, cur, i18n.language)} / ${money(r.creditLimit, cur, i18n.language)}` : "-"}</Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={Boolean(sel)} onClose={() => setSel(null)} title={d?.name ?? t("ref.title")} xl>
        {d ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard label={t("ref.orders")} value={String(d.orderCount)} />
              <StatCard label={t("ref.commissionBalance")} value={money(d.balances.COMMISSION, cur, i18n.language)} tone={d.balances.COMMISSION > 0 ? "warn" : "neutral"} />
              <StatCard label={t("ref.creditBalance")} value={money(d.balances.CREDIT, cur, i18n.language)} hint={d.creditLimit != null ? `${t("ref.creditLimit")}: ${money(d.creditLimit, cur, i18n.language)}` : t("ref.creditOff")} />
              <Card className="flex flex-col justify-center gap-2 p-3 text-xs">
                <div className="font-medium">{t("ref.portal")}</div>
                {portal ? <div className="space-y-1"><div className="break-all rounded bg-muted px-2 py-1 font-mono">{portal}</div><Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(portal); toast(t("common.copied")); }}><Copy aria-hidden className="size-3.5" />{t("common.copy")}</Button></div> : <Badge tone={d.portalEnabled ? "ok" : "muted"}>{d.portalEnabled ? t("ref.portalOn") : t("ref.portalOff")}</Badge>}
                {can("referrers.write") ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => issue.mutate()}><Link2 aria-hidden className="size-3.5" />{t("ref.portalIssue")}</Button>{d.portalEnabled ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate()}>{t("ref.portalRevoke")}</Button> : null}</div> : null}
              </Card>
            </div>
            <div className="flex flex-wrap gap-2">{can("referrers.write") ? <Button size="sm" variant="outline" onClick={() => setForm({ ...d, commissionValue: String(d.commissionValue), creditLimit: d.creditLimit ?? "", paymentTermsDays: String(d.paymentTermsDays), specialty: d.specialty ?? "", phone: d.phone ?? "", email: d.email ?? "" })}>{t("common.edit")}</Button> : null}</div>
            <Tabs tabs={[{ id: "ledger", label: t("ref.ledger") }, { id: "orders", label: t("ref.recentOrders") }]} value={tab} onChange={setTab} />
            {tab === "ledger" ? (
              <div className="space-y-3">
                {can("finance.commissions") ? (
                  <Card className="grid gap-2 sm:grid-cols-[8rem_1fr_auto]">
                    <Field label={t("common.amount")}><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
                    <Field label={t("common.note")}><Input value={memo} onChange={(e) => setMemo(e.target.value)} /></Field>
                    <div className="flex flex-wrap items-end gap-2">
                      <Button size="sm" disabled={!Number(amount) || act.isPending} onClick={() => act.mutate("payout")}>{t("ref.payout")}</Button>
                      {d.creditLimit != null ? <><Button size="sm" variant="outline" disabled={!Number(amount) || act.isPending} onClick={() => act.mutate("credit/charge")}>{t("ref.creditCharge")}</Button><Button size="sm" variant="outline" disabled={!Number(amount) || act.isPending} onClick={() => act.mutate("credit/payment")}>{t("ref.creditPay")}</Button></> : null}
                    </div>
                    <div className="sm:col-span-3"><ErrorNote error={act.error} /></div>
                  </Card>
                ) : null}
                <Table head={[t("common.date"), t("ref.account"), t("common.type"), t("common.amount"), t("common.note")]}>
                  {(ledger.data ?? []).map((e) => <tr key={e.id}><Td>{dt(e.createdAt, i18n.language)}</Td><Td>{t(`ref.acct.${e.account}`)}</Td><Td className="text-xs">{t(`ref.ledgerType.${e.type}`, { defaultValue: e.type })}</Td><Td className={`tabular-nums ${e.amount < 0 ? "text-[hsl(var(--danger-text))]" : ""}`}>{money(e.amount, cur, i18n.language)}</Td><Td className="text-xs text-muted-foreground">{e.memo}</Td></tr>)}
                </Table>
              </div>
            ) : (
              <Table head={[t("order.number"), t("orders.patient"), t("common.status"), t("bill.total")]}>
                {d.recentOrders.map((o: any) => <tr key={o.id}><Td className="font-mono text-xs">{o.orderNumber}</Td><Td dir="auto">{o.patient.fullName}</Td><Td>{o.status}</Td><Td className="tabular-nums">{o.invoices[0] ? money(o.invoices[0].total, cur, i18n.language) : "-"}</Td></tr>)}
              </Table>
            )}
          </div>
        ) : null}
      </Modal>
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? t("common.edit") : t("ref.new")} wide>
        {form ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("ref.name")} className="sm:col-span-2"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
            <Field label={t("ref.kind")}><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{["DOCTOR", "CLINIC", "HOSPITAL", "CORPORATE"].map((k) => <option key={k} value={k}>{t(`ref.kinds.${k}`)}</option>)}</Select></Field>
            <Field label={t("ref.specialty")}><Input value={form.specialty} onChange={(e) => setForm({ ...form, specialty: e.target.value })} /></Field>
            <Field label={t("orders.phone")}><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label={t("pat.email")}><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label={t("ref.commissionType")}><Select value={form.commissionType} onChange={(e) => setForm({ ...form, commissionType: e.target.value })}>{["NONE", "PERCENT", "FIXED"].map((k) => <option key={k} value={k}>{t(`ref.commissionTypes.${k}`)}</option>)}</Select></Field>
            <Field label={t("ref.commissionValue")}><Input type="number" min="0" value={form.commissionValue} disabled={form.commissionType === "NONE"} onChange={(e) => setForm({ ...form, commissionValue: e.target.value })} /></Field>
            <Field label={t("ref.creditLimit")} hint={t("ref.creditHint")}><Input type="number" min="0" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></Field>
            <Field label={t("ref.terms")}><Input type="number" min="0" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })} /></Field>
            <div className="sm:col-span-2 space-y-2 rounded-lg bg-muted/60 p-3">
              <p className="text-xs font-medium text-muted-foreground">{t("ref.deliveryPrefs")}</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.deliverOnRelease} onChange={(e) => setForm({ ...form, deliverOnRelease: e.target.checked })} />{t("ref.deliverOnRelease")}</label>
              <div className="flex flex-wrap gap-4">{CHANNELS.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.deliveryChannels.includes(c)} onChange={() => setForm({ ...form, deliveryChannels: form.deliveryChannels.includes(c) ? form.deliveryChannels.filter((x: string) => x !== c) : [...form.deliveryChannels, c] })} />{t(`ref.chan.${c}`)}</label>)}</div>
              <p className="text-xs text-muted-foreground">{t("ref.deliveryNote")}</p>
            </div>
            <div className="sm:col-span-2 space-y-2"><ErrorNote error={save.error} /><Button disabled={form.name.length < 2 || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button></div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
