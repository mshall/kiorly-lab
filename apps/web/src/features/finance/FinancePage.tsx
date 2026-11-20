import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Plus } from "lucide-react";
import { api, download } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly, money, today } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Tabs, Td, useToast } from "@/components/ui";
import { BarChart, Donut } from "@/components/charts";
import { EmptyState, StatCard } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

const BUCKETS = ["current", "d1_30", "d31_60", "d61_90", "d90_plus"];
const CATS = ["RENT", "SALARIES", "UTILITIES", "REAGENTS", "CONSUMABLES", "EQUIPMENT", "MAINTENANCE", "TRANSPORT", "MARKETING", "PROFESSIONAL_FEES", "OTHER"];

/** M8 finance: income statement, receivables aging, expenses, referrer commissions, insurance / corporate contracts. */
export function FinancePage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const cur = me?.tenant.currency;
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("summary");
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(today());
  const [exp, setExp] = useState<any>(null);
  const [acc, setAcc] = useState<any>(null);
  const money_ = (n: unknown) => money(n as number, cur, i18n.language);
  const sum = useQuery({ queryKey: ["fin-summary", from, to], queryFn: () => api<any>(`/finance/summary?from=${from}&to=${to}`) });
  const aging = useQuery({ queryKey: ["fin-aging"], queryFn: () => api<any>("/finance/aging"), enabled: tab === "aging" });
  const exps = useQuery({ queryKey: ["fin-exp", from, to], queryFn: () => api<any[]>(`/expenses?from=${from}&to=${to}`), enabled: tab === "expenses" });
  const stmt = useQuery({ queryKey: ["fin-stmt", from, to], queryFn: () => api<any[]>(`/referrers/statement?from=${from}&to=${to}`), enabled: tab === "commissions" && can("finance.commissions") });
  const accounts = useQuery({ queryKey: ["b2b"], queryFn: () => api<any[]>("/b2b-accounts"), enabled: tab === "contracts" });
  const refresh = () => void qc.invalidateQueries();
  const addExp = useMutation({ mutationFn: () => api("/expenses", { body: { date: exp.date, category: exp.category, amount: Number(exp.amount), vendor: exp.vendor || undefined, paidVia: exp.paidVia, fromDrawer: exp.fromDrawer && exp.paidVia === "CASH", reference: exp.reference || undefined } }), onSuccess: () => { setExp(null); refresh(); toast(t("common.saved")); } });
  const voidExp = useMutation({ mutationFn: (id: string) => api(`/expenses/${id}/void`, { body: { reason: "entered in error" } }), onSuccess: refresh });
  const saveAcc = useMutation({ mutationFn: () => { const b: any = { name: acc.name, kind: acc.kind, discountPercent: Number(acc.discount || 0), coveragePercent: Number(acc.coverage || 0), paymentTermsDays: Number(acc.terms || 30), contractRef: acc.ref || undefined }; return acc.id ? api(`/b2b-accounts/${acc.id}`, { method: "PUT", body: b }) : api("/b2b-accounts", { body: b }); }, onSuccess: () => { setAcc(null); refresh(); toast(t("common.saved")); } });
  const s = sum.data;
  const tabs = [{ id: "summary", label: t("fin.summary") }, { id: "aging", label: t("fin.aging") }, { id: "expenses", label: t("fin.expenses") }, ...(can("finance.commissions") ? [{ id: "commissions", label: t("fin.commissions") }] : []), { id: "contracts", label: t("fin.contracts") }];
  const range = (
    <div className="mb-4 flex flex-wrap items-end gap-3"><Field label={t("common.from")}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label={t("common.to")}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field></div>
  );
  return (
    <>
      <PageHeader title={t("fin.title")} sub={t("fin.sub")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "summary" ? (
        <>
          {range}
          {s ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label={t("fin.revenue")} value={money_(s.revenue)} hint={`${s.invoices} ${t("fin.invoices")}`} /><StatCard label={t("fin.discounts")} value={money_(s.discounts)} /><StatCard label={t("fin.vatLines")} value={money_(s.vatLines)} hint={t("fin.vatNote")} /><StatCard label={t("fin.net")} value={money_(s.netOperating)} tone={s.netOperating >= 0 ? "good" : "bad"} hint={s.marginPercent != null ? `${s.marginPercent}%` : undefined} /></div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card><CardTitle>{t("fin.costs")}</CardTitle><BarChart label={t("fin.costs")} series={[t("fin.costs")]} data={[{ label: t("fin.sendOut"), values: [s.costs.sendOut] }, { label: t("fin.commissionsCost"), values: [s.costs.referrerCommissions] }, { label: t("fin.reagents"), values: [s.costs.reagents] }, ...Object.entries(s.costs.expensesByCategory).map(([k, v]) => ({ label: t(`fin.cat.${k}`), values: [v as number] }))].filter((x) => x.values[0]! > 0)} /></Card>
                <Card><CardTitle>{t("fin.collected")} ({money_(s.collectedTotal)})</CardTitle><Donut label={t("fin.collected")} data={Object.entries(s.collected).map(([k, v]) => ({ label: t(`fin.method.${k}`), value: v as number })).filter((x) => x.value > 0)} /><p className="mt-3 text-xs text-muted-foreground">{t("fin.refunds")}: {money_(s.refunds)}</p></Card>
              </div>
              <div className="flex gap-2">{["expenses", "refunds", "payments", "invoices"].map((k) => <Button key={k} variant="outline" size="sm" onClick={() => void download(`/exports/${k}.csv?from=${from}&to=${to}`, `${k}.csv`)}><Download aria-hidden className="size-4" />{t(`fin.export.${k}`)}</Button>)}</div>
            </div>
          ) : null}
        </>
      ) : null}
      {tab === "aging" ? (
        aging.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">{BUCKETS.map((b) => <StatCard key={b} label={t(`fin.bucket.${b}`)} value={money_(aging.data.totals[b])} tone={b === "d90_plus" && aging.data.totals[b] > 0 ? "bad" : b === "d61_90" && aging.data.totals[b] > 0 ? "warn" : "neutral"} />)}<StatCard label={t("bill.total")} value={money_(aging.data.totals.total)} /></div>
            <Button variant="outline" size="sm" onClick={() => void download("/finance/aging.pdf", "aging.pdf")}><Download aria-hidden className="size-4" />PDF</Button>
            {!aging.data.parties.length ? <EmptyState title={t("fin.noReceivables")} /> : <Table head={[t("fin.party"), t("common.type"), ...BUCKETS.map((b) => t(`fin.bucket.${b}`)), t("bill.total")]}>{aging.data.parties.map((p: any) => <tr key={`${p.kind}${p.partyId}`}><Td dir="auto" className="font-medium">{p.party}</Td><Td><Badge tone={p.kind === "PAYER" ? "info" : "muted"}>{t(`fin.partyKind.${p.kind}`)}</Badge></Td>{BUCKETS.map((b) => <Td key={b} className="tabular-nums">{p[b] ? money_(p[b]) : ""}</Td>)}<Td className="tabular-nums font-semibold">{money_(p.total)}</Td></tr>)}</Table>}
          </div>
        ) : null
      ) : null}
      {tab === "expenses" ? (
        <div className="space-y-3">
          {range}
          {can("expenses.manage") ? <Button size="sm" onClick={() => setExp({ date: today(), category: "UTILITIES", amount: "", vendor: "", paidVia: "BANK", fromDrawer: false, reference: "" })}><Plus aria-hidden className="size-4" />{t("fin.addExpense")}</Button> : null}
          <Table head={[t("common.date"), t("fin.category"), t("fin.vendor"), t("fin.paidVia"), t("common.amount"), ""]}>{(exps.data ?? []).map((e) => <tr key={e.id} className={e.voidedAt ? "opacity-50 line-through" : undefined}><Td>{dOnly(e.date, i18n.language)}</Td><Td>{t(`fin.cat.${e.category}`)}</Td><Td dir="auto">{e.vendor ?? ""}</Td><Td>{e.paidVia}{e.fromDrawer ? ` (${t("fin.drawer")})` : ""}</Td><Td className="tabular-nums">{money_(e.amount)}</Td><Td>{can("expenses.manage") && !e.voidedAt ? <Button size="sm" variant="ghost" onClick={() => voidExp.mutate(e.id)}>{t("bill.void")}</Button> : null}</Td></tr>)}</Table>
        </div>
      ) : null}
      {tab === "commissions" ? (
        <div className="space-y-3">{range}<Table head={[t("ref.name"), t("fin.accrued"), t("fin.reversed"), t("fin.paidOut"), t("fin.balance")]}>{(stmt.data ?? []).map((r) => <tr key={r.referrerId}><Td dir="auto">{r.referrer}</Td><Td className="tabular-nums">{money_(r.accrued)}</Td><Td className="tabular-nums">{money_(r.reversed)}</Td><Td className="tabular-nums">{money_(r.paid)}</Td><Td className="tabular-nums font-semibold">{money_(r.balance)}</Td></tr>)}</Table><Button variant="outline" size="sm" onClick={() => void download(`/exports/commissions.csv?from=${from}&to=${to}`, "commissions.csv")}><Download aria-hidden className="size-4" />CSV</Button></div>
      ) : null}
      {tab === "contracts" ? (
        <div className="space-y-3">
          {can("billing.pricing") ? <Button size="sm" onClick={() => setAcc({ name: "", kind: "INSURANCE", discount: "0", coverage: "80", terms: "30", ref: "" })}><Plus aria-hidden className="size-4" />{t("fin.newContract")}</Button> : null}
          <Table head={[t("common.name"), t("common.type"), t("fin.discount"), t("fin.coverage"), t("fin.terms"), t("fin.contractRef"), ""]}>{(accounts.data ?? []).map((a) => <tr key={a.id}><Td dir="auto" className="font-medium">{a.name}</Td><Td>{t(`fin.accountKind.${a.kind}`)}</Td><Td className="tabular-nums">{a.discountPercent}%</Td><Td className="tabular-nums">{a.coveragePercent}%</Td><Td className="tabular-nums">{a.paymentTermsDays}</Td><Td className="font-mono text-xs">{a.contractRef ?? ""}</Td><Td>{can("billing.pricing") ? <Button size="sm" variant="ghost" onClick={() => setAcc({ id: a.id, name: a.name, kind: a.kind, discount: String(a.discountPercent), coverage: String(a.coveragePercent), terms: String(a.paymentTermsDays), ref: a.contractRef ?? "" })}>{t("common.edit")}</Button> : null}</Td></tr>)}</Table>
          <p className="text-xs text-muted-foreground">{t("fin.contractNote")}</p>
        </div>
      ) : null}
      <Modal open={Boolean(exp)} onClose={() => setExp(null)} title={t("fin.addExpense")}>
        {exp ? <div className="grid gap-3 sm:grid-cols-2"><Field label={t("common.date")}><Input type="date" value={exp.date} onChange={(e) => setExp({ ...exp, date: e.target.value })} /></Field><Field label={t("fin.category")}><Select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{t(`fin.cat.${c}`)}</option>)}</Select></Field><Field label={t("common.amount")}><Input type="number" min="0" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} /></Field><Field label={t("fin.vendor")}><Input value={exp.vendor} onChange={(e) => setExp({ ...exp, vendor: e.target.value })} /></Field><Field label={t("fin.paidVia")}><Select value={exp.paidVia} onChange={(e) => setExp({ ...exp, paidVia: e.target.value })}>{["CASH", "BANK", "CARD"].map((c) => <option key={c}>{c}</option>)}</Select></Field><Field label={t("fin.reference")}><Input value={exp.reference} onChange={(e) => setExp({ ...exp, reference: e.target.value })} /></Field>{exp.paidVia === "CASH" ? <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={exp.fromDrawer} onChange={(e) => setExp({ ...exp, fromDrawer: e.target.checked })} />{t("fin.fromDrawer")}</label> : null}<div className="sm:col-span-2 space-y-2"><ErrorNote error={addExp.error} /><Button disabled={!Number(exp.amount) || addExp.isPending} onClick={() => addExp.mutate()}>{t("common.save")}</Button></div></div> : null}
      </Modal>
      <Modal open={Boolean(acc)} onClose={() => setAcc(null)} title={t("fin.newContract")}>
        {acc ? <div className="grid gap-3 sm:grid-cols-2"><Field label={t("common.name")} className="sm:col-span-2"><Input value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field><Field label={t("common.type")}><Select value={acc.kind} onChange={(e) => setAcc({ ...acc, kind: e.target.value })}>{["INSURANCE", "CORPORATE"].map((k) => <option key={k} value={k}>{t(`fin.accountKind.${k}`)}</option>)}</Select></Field><Field label={t("fin.contractRef")}><Input value={acc.ref} onChange={(e) => setAcc({ ...acc, ref: e.target.value })} /></Field><Field label={t("fin.discount")}><Input type="number" min="0" max="100" value={acc.discount} onChange={(e) => setAcc({ ...acc, discount: e.target.value })} /></Field><Field label={t("fin.coverage")} hint={t("fin.coverageHint")}><Input type="number" min="0" max="100" value={acc.coverage} onChange={(e) => setAcc({ ...acc, coverage: e.target.value })} /></Field><Field label={t("fin.terms")}><Input type="number" min="0" value={acc.terms} onChange={(e) => setAcc({ ...acc, terms: e.target.value })} /></Field><div className="sm:col-span-2 space-y-2"><ErrorNote error={saveAcc.error} /><Button disabled={acc.name.length < 2 || saveAcc.isPending} onClick={() => saveAcc.mutate()}>{t("common.save")}</Button></div></div> : null}
      </Modal>
    </>
  );
}
