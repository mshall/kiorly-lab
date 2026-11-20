import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download, newKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt, money, today } from "@/lib/format";
import { Banknote, CreditCard, Receipt } from "lucide-react";
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, Select, Spinner, Table, Tabs, Td, useToast } from "@/components/ui";
import { SearchBox, Segmented } from "@/components/kit";
import { EmptyState, StatCard, Surface, TableSkeleton } from "@/brand/ui-kit";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";

/** KLBIZ01 reception/billing: invoices (VAT lines only), cash/card payments (mock PSP), cash close, price lists, payer contracts. */
export function BillingPage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const cur = me?.tenant.currency ?? "EGP";
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("invoices");
  const [invQ, setInvQ] = useState("");
  const [invSt, setInvSt] = useState("");
  const [pay, setPay] = useState<any>(null);
  const [p, setP] = useState({ method: "CASH", amount: "", cardToken: "tok_visa" });
  const [key, setKey] = useState(newKey());
  const [counted, setCounted] = useState("");
  const [plName, setPlName] = useState("");
  const [acc, setAcc] = useState({ name: "", priceListId: "", days: "30" });
  const inv = useQuery({ queryKey: ["invoices"], queryFn: () => api<any[]>("/invoices") });
  const closes = useQuery({ queryKey: ["cash-closes"], queryFn: () => api<any[]>("/cash-closes"), enabled: tab === "cash" });
  const lists = useQuery({ queryKey: ["price-lists"], queryFn: () => api<any[]>("/price-lists"), enabled: tab === "prices" || tab === "b2b" });
  const accounts = useQuery({ queryKey: ["b2b"], queryFn: () => api<any[]>("/b2b-accounts"), enabled: tab === "b2b" });
  const rec = useQuery({ queryKey: ["reconciliation"], queryFn: () => api<any>("/billing/reconciliation"), enabled: tab === "recon" });
  const detail = useQuery({ queryKey: ["invoice", pay?.id], queryFn: () => api<any>(`/invoices/${pay.id}`), enabled: Boolean(pay) });
  const refresh = () => void qc.invalidateQueries();
  const doPay = useMutation({
    mutationFn: () => api<any>(`/invoices/${pay.id}/payments`, { idempotencyKey: key, body: { method: p.method, amount: Number(p.amount), ...(p.method === "CARD" ? { cardToken: p.cardToken } : {}) } }),
    onSuccess: () => { setKey(newKey()); setP({ ...p, amount: "" }); refresh(); toast(t("bill.paid")); },
  });
  const refund = useMutation({ mutationFn: (id: string) => api(`/payments/${id}/refund`, { body: {} }), onSuccess: () => { refresh(); toast(t("bill.refunded")); } });
  const close = useMutation({ mutationFn: () => api("/cash-closes", { body: { businessDate: today(), countedCash: Number(counted) } }), onSuccess: () => { setCounted(""); refresh(); toast(t("common.saved")); } });
  const newPl = useMutation({ mutationFn: () => api("/price-lists", { body: { name: plName } }), onSuccess: () => { setPlName(""); refresh(); } });
  const newAcc = useMutation({ mutationFn: () => api("/b2b-accounts", { body: { name: acc.name, priceListId: acc.priceListId || undefined, paymentTermsDays: Number(acc.days) } }), onSuccess: () => { setAcc({ name: "", priceListId: "", days: "30" }); refresh(); } });
  const d = detail.data;
  const outstanding = d ? Math.round((d.total - d.paidTotal) * 100) / 100 : 0;
  return (
    <>
      <PageHeader title={t("bill.title")} sub={t("bill.sub")} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "invoices", label: t("bill.invoices") }, { id: "cash", label: t("bill.cashClose") }, { id: "prices", label: t("bill.priceLists") }, { id: "b2b", label: t("bill.b2b") }, { id: "recon", label: t("bill.recon") }]} />
      {tab === "invoices" ? (inv.isLoading ? <Surface><TableSkeleton rows={7} cols={6} /></Surface> : !inv.data?.length ? <EmptyState title={t("common.none")} /> : (() => {
        const all = inv.data;
        const open = all.filter((i) => ["ISSUED", "PARTIALLY_PAID"].includes(i.status));
        const outstandingSum = open.reduce((a, i) => a + (Number(i.total) - Number(i.paidTotal)), 0);
        const vatSum = all.filter((i) => i.status !== "VOID").reduce((a, i) => a + Number(i.vatTotal), 0);
        const paidSum = all.reduce((a, i) => a + Number(i.paidTotal), 0);
        const needle = invQ.trim().toLowerCase();
        const shown = all.filter((i) => (!invSt || i.status === invSt) && (!needle || `${i.number} ${i.order?.patient.fullName ?? i.b2bAccount?.name ?? ""}`.toLowerCase().includes(needle)));
        const payBtn = (i: any) => can("billing.payment") && ["ISSUED", "PARTIALLY_PAID"].includes(i.status) ? <Button size="sm" onClick={() => { setPay(i); setP({ method: "CASH", amount: String(Math.round((i.total - i.paidTotal) * 100) / 100), cardToken: "tok_visa" }); }}>{t("bill.pay")}</Button> : null;
        return (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label={t("bill.outstanding")} value={money(outstandingSum, cur, i18n.language)} tone={outstandingSum ? "warn" : "good"} icon={<Receipt className="size-4" />} hint={t("ux.bill.openCount", { n: open.length })} />
              <StatCard label={t("bill.paidTotal")} value={money(paidSum, cur, i18n.language)} tone="good" icon={<Banknote className="size-4" />} />
              <StatCard label={t("bill.vat")} value={money(vatSum, cur, i18n.language)} tone="info" hint={t("ux.bill.vatLine")} />
              <StatCard label={t("bill.invoices")} value={all.length} icon={<CreditCard className="size-4" />} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1"><Segmented label={t("common.status")} value={invSt} onChange={setInvSt} className="flex-nowrap" items={[{ id: "", label: t("common.all") }, ...["ISSUED", "PARTIALLY_PAID", "PAID", "VOID"].map((x) => ({ id: x, label: t(`status.${x}`) }))]} /></div>
              <SearchBox value={invQ} onChange={setInvQ} placeholder={t("ux.bill.search")} className="ms-auto" />
            </div>
            {shown.length === 0 ? <EmptyState compact title={t("common.none")} /> : (
              <>
                <div className="hidden md:block">
                  <Table head={[t("bill.number"), t("orders.patient"), t("bill.subtotal"), t("bill.vat"), t("bill.total"), t("bill.paidTotal"), t("common.status"), ""]}>
                    {shown.map((i) => (
                      <tr key={i.id}><Td className="font-mono font-semibold">{i.number}</Td><Td><span dir="auto">{i.order?.patient.fullName ?? i.b2bAccount?.name}</span></Td><Td className="tabular-nums">{money(i.subtotal, cur, i18n.language)}</Td><Td className="whitespace-nowrap tabular-nums">{money(i.vatTotal, cur, i18n.language)} <span className="text-xs text-muted-foreground">({i.vatRatePercent}%)</span></Td><Td className="font-semibold tabular-nums">{money(i.total, cur, i18n.language)}</Td><Td className="tabular-nums">{money(i.paidTotal, cur, i18n.language)}</Td><Td><StatusBadge value={i.status} /></Td>
                        <Td className="space-x-1 whitespace-nowrap text-end rtl:space-x-reverse"><Button size="sm" variant="outline" onClick={() => void download(`/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>PDF</Button>{payBtn(i)}{i.order ? <Link to={`/orders/${i.orderId}`} className="ms-1 text-xs text-primary underline-offset-4 hover:underline">{t("spec.order")}</Link> : null}</Td></tr>
                    ))}
                  </Table>
                </div>
                <ul className="space-y-3 md:hidden">
                  {shown.map((i) => (
                    <li key={i.id} className="rounded-xl border border-border/80 bg-card p-3 shadow-[var(--kx-shadow-1)]">
                      <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm font-semibold">{i.number}</span><StatusBadge value={i.status} /></div>
                      <div className="mt-0.5 text-sm text-muted-foreground" dir="auto">{i.order?.patient.fullName ?? i.b2bAccount?.name}</div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-muted-foreground">{t("bill.subtotal")}</dt><dd className="tabular-nums">{money(i.subtotal, cur, i18n.language)}</dd></div><div><dt className="text-muted-foreground">{t("bill.vat")} {i.vatRatePercent}%</dt><dd className="tabular-nums">{money(i.vatTotal, cur, i18n.language)}</dd></div><div><dt className="text-muted-foreground">{t("bill.total")}</dt><dd className="font-semibold tabular-nums">{money(i.total, cur, i18n.language)}</dd></div></dl>
                      <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => void download(`/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>PDF</Button>{payBtn(i)}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        );
      })()) : null}
      {tab === "cash" ? (
        <div className="space-y-4">
          {can("billing.cashclose") ? <Card className="flex flex-wrap items-end gap-3"><Field label={t("bill.counted", { date: today() })}><Input type="number" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} /></Field><Button disabled={!counted || close.isPending} onClick={() => close.mutate()}>{t("bill.closeDay")}</Button><div className="w-full"><ErrorNote error={close.error} /></div></Card> : null}
          {closes.data?.length ? <Table head={[t("common.date"), t("bill.expected"), t("bill.counted2"), t("bill.variance")]}>{closes.data.map((c) => <tr key={c.id}><Td>{c.businessDate.slice(0, 10)}</Td><Td>{money(c.expectedCash, cur, i18n.language)}</Td><Td>{money(c.countedCash, cur, i18n.language)}</Td><Td><Badge tone={c.variance === 0 ? "ok" : "warn"}>{money(c.variance, cur, i18n.language)}</Badge></Td></tr>)}</Table> : <Empty>{t("common.none")}</Empty>}
        </div>
      ) : null}
      {tab === "prices" ? (
        <div className="space-y-4">
          {can("billing.pricing") ? <Card className="flex flex-wrap items-end gap-3"><Field label={t("bill.newPriceList")}><Input value={plName} onChange={(e) => setPlName(e.target.value)} /></Field><Button disabled={!plName} onClick={() => newPl.mutate()}>{t("common.add")}</Button></Card> : null}
          <Table head={[t("common.name"), t("bill.default"), t("bill.currency")]}>{lists.data?.map((l) => <tr key={l.id}><Td>{l.name}</Td><Td>{l.isDefault ? <Badge tone="ok">{t("bill.default")}</Badge> : "-"}</Td><Td>{l.currency}</Td></tr>)}</Table>
          <p className="text-xs text-muted-foreground">{t("bill.priceNote")}</p>
        </div>
      ) : null}
      {tab === "b2b" ? (
        <div className="space-y-4">
          {can("billing.pricing") ? <Card className="grid gap-3 sm:grid-cols-4"><Field label={t("common.name")}><Input value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} /></Field><Field label={t("bill.priceList")}><Select value={acc.priceListId} onChange={(e) => setAcc({ ...acc, priceListId: e.target.value })}><option value="">-</option>{lists.data?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field><Field label={t("bill.terms")}><Input type="number" value={acc.days} onChange={(e) => setAcc({ ...acc, days: e.target.value })} /></Field><div className="flex items-end"><Button disabled={!acc.name} onClick={() => newAcc.mutate()}>{t("common.add")}</Button></div></Card> : null}
          <ErrorNote error={newAcc.error} />
          <Table head={[t("common.name"), t("bill.priceList"), t("bill.terms")]}>{accounts.data?.map((a) => <tr key={a.id}><Td>{a.name}</Td><Td>{a.priceList?.name ?? "-"}</Td><Td>{a.paymentTermsDays} {t("bill.days")}</Td></tr>)}</Table>
        </div>
      ) : null}
      {tab === "recon" ? (
        <Card>
          <CardTitle>{t("bill.recon")}</CardTitle>
          {rec.isLoading ? <Spinner /> : <><Badge tone={rec.data?.reconciled ? "ok" : "crit"}>{rec.data?.reconciled ? t("bill.reconciled") : t("bill.notReconciled")}</Badge><dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">{Object.entries(rec.data?.balances ?? {}).map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-mono">{money(v as number, cur, i18n.language)}</dd></div>)}</dl></>}
          <p className="mt-3 text-xs text-muted-foreground">{t("bill.noTaxNote")}</p>
        </Card>
      ) : null}
      <Modal open={Boolean(pay)} onClose={() => setPay(null)} title={`${t("bill.pay")} ${pay?.number ?? ""}`}>
        {d ? (
          <div className="space-y-3">
            <dl className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("bill.subtotal")}</dt><dd className="tabular-nums">{money(d.subtotal, cur, i18n.language)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("bill.vat")} ({d.vatRatePercent}%)</dt><dd className="tabular-nums">{money(d.vatTotal, cur, i18n.language)}</dd></div>
              <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>{t("bill.total")}</dt><dd className="tabular-nums">{money(d.total, cur, i18n.language)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("bill.paidTotal")}</dt><dd className="tabular-nums">{money(d.paidTotal, cur, i18n.language)}</dd></div>
              <div className="flex justify-between text-base font-bold"><dt>{t("bill.outstanding")}</dt><dd className="tabular-nums">{money(outstanding, cur, i18n.language)}</dd></div>
            </dl>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t("bill.method")}><Select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}><option value="CASH">{t("bill.cash")}</option><option value="CARD">{t("bill.card")}</option></Select></Field>
              <Field label={t("bill.amount")}><Input type="number" step="0.01" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></Field>
              {p.method === "CARD" ? <Field label={t("bill.cardToken")} hint={t("bill.cardHint")}><Input value={p.cardToken} onChange={(e) => setP({ ...p, cardToken: e.target.value })} /></Field> : null}
            </div>
            <ErrorNote error={doPay.error ?? refund.error} />
            <Button disabled={!p.amount || doPay.isPending} onClick={() => doPay.mutate()}>{t("bill.recordPayment")}</Button>
            {d.payments.length ? <ul className="space-y-1 text-sm">{d.payments.map((x: any) => <li key={x.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-1"><span>{dt(x.createdAt, i18n.language)} · {x.method} · {money(x.amount, cur, i18n.language)}</span><span className="flex items-center gap-2"><StatusBadge value={x.status} />{x.status === "SUCCEEDED" && can("billing.payment") ? <Button size="sm" variant="ghost" onClick={() => refund.mutate(x.id)}>{t("bill.refund")}</Button> : null}</span></li>)}</ul> : null}
          </div>
        ) : <Spinner />}
      </Modal>
    </>
  );
}
