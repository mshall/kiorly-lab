import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api, download, newKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt, money, today } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, Select, Spinner, Table, Tabs, Td, useToast } from "@/components/ui";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";

/** KLBIZ01 reception/billing: invoices (VAT lines only), cash/card payments (mock PSP), cash close, price lists, payer contracts. */
export function BillingPage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const cur = me?.tenant.currency ?? "EGP";
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("invoices");
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
      {tab === "invoices" ? (inv.isLoading ? <Spinner /> : !inv.data?.length ? <Empty>{t("common.none")}</Empty> : (
        <Table head={[t("bill.number"), t("orders.patient"), t("bill.subtotal"), t("bill.vat"), t("bill.total"), t("bill.paidTotal"), t("common.status"), ""]}>
          {inv.data.map((i) => (
            <tr key={i.id}><Td className="font-mono">{i.number}</Td><Td>{i.order?.patient.fullName ?? i.b2bAccount?.name}</Td><Td>{money(i.subtotal, cur, i18n.language)}</Td><Td>{money(i.vatTotal, cur, i18n.language)} <span className="text-xs text-muted-foreground">({i.vatRatePercent}%)</span></Td><Td className="font-semibold">{money(i.total, cur, i18n.language)}</Td><Td>{money(i.paidTotal, cur, i18n.language)}</Td><Td><StatusBadge value={i.status} /></Td>
              <Td className="space-x-1 text-end rtl:space-x-reverse"><Button size="sm" variant="outline" onClick={() => void download(`/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>PDF</Button>{can("billing.payment") && ["ISSUED", "PARTIALLY_PAID"].includes(i.status) ? <Button size="sm" onClick={() => { setPay(i); setP({ method: "CASH", amount: String(Math.round((i.total - i.paidTotal) * 100) / 100), cardToken: "tok_visa" }); }}>{t("bill.pay")}</Button> : null}{i.order ? <Link to={`/orders/${i.orderId}`} className="text-xs text-primary underline">{t("spec.order")}</Link> : null}</Td></tr>
          ))}
        </Table>
      )) : null}
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
            <div className="text-sm">{t("bill.outstanding")}: <strong>{money(outstanding, cur, i18n.language)}</strong></div>
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
