import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { PackagePlus, ShoppingCart } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly, money, num } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Modal, Select, Table, Tabs, Td, useToast } from "@/components/ui";
import { SearchBox } from "@/components/kit";
import { EmptyState, StatCard } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";

/** M6 inventory: stock position, lots/expiry, goods receipt, purchase orders, stock counts, consumption rules and cost per test. */
export function InventoryPage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const cur = me?.tenant.currency;
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("stock");
  const [q, setQ] = useState("");
  const [low, setLow] = useState(false);
  const [lotsOf, setLotsOf] = useState<any>(null);
  const [form, setForm] = useState<{ kind: string; d: any } | null>(null);
  const sum = useQuery({ queryKey: ["inv-summary"], queryFn: () => api<any>("/inventory/summary") });
  const stock = useQuery({ queryKey: ["inv-stock", q, low], queryFn: () => api<any[]>(`/inventory/stock?search=${encodeURIComponent(q)}${low ? "&low=true" : ""}`) });
  const lots = useQuery({ queryKey: ["inv-lots", lotsOf?.id], queryFn: () => api<any[]>(`/inventory/items/${lotsOf.id}/lots`), enabled: Boolean(lotsOf) });
  const suppliers = useQuery({ queryKey: ["inv-suppliers"], queryFn: () => api<any[]>("/inventory/suppliers") });
  const pos = useQuery({ queryKey: ["inv-pos"], queryFn: () => api<any[]>("/inventory/purchase-orders"), enabled: tab === "po" });
  const sugg = useQuery({ queryKey: ["inv-sugg"], queryFn: () => api<any[]>("/inventory/reorder-suggestions"), enabled: tab === "po" });
  const counts = useQuery({ queryKey: ["inv-counts"], queryFn: () => api<any[]>("/inventory/counts"), enabled: tab === "counts" });
  const cost = useQuery({ queryKey: ["inv-cost"], queryFn: () => api<any[]>("/inventory/cost-per-test"), enabled: tab === "cost" });
  const moves = useQuery({ queryKey: ["inv-moves"], queryFn: () => api<any[]>("/inventory/movements?limit=60"), enabled: tab === "moves" });
  const refresh = () => void qc.invalidateQueries();
  const post = useMutation({ mutationFn: (v: { path: string; body?: object; method?: string }) => api(v.path, { method: v.method, body: v.body ?? {} }), onSuccess: () => { setForm(null); refresh(); toast(t("common.saved")); } });
  const s = sum.data;
  const m = can("inventory.manage");
  const d = form?.d;
  const set = (k: string, v: unknown) => setForm({ ...form!, d: { ...d, [k]: v } });
  const submit = () => {
    if (!form) return;
    if (form.kind === "item") post.mutate({ path: "/inventory/items", body: { code: d.code, name: d.name, unit: d.unit, category: d.category, reorderLevel: Number(d.level || 0), reorderQty: Number(d.qty || 0), supplierId: d.supplierId || undefined } });
    if (form.kind === "supplier") post.mutate({ path: "/inventory/suppliers", body: { name: d.name, phone: d.phone || undefined, email: d.email || undefined, leadTimeDays: Number(d.lead || 7) } });
    if (form.kind === "receive") post.mutate({ path: "/inventory/receipts", body: { supplierId: d.supplierId, invoiceRef: d.invoiceRef || undefined, lines: [{ itemId: d.itemId, lotNumber: d.lot, expiryDate: d.expiry || undefined, qty: Number(d.qty), unitCost: Number(d.cost) }] } });
    if (form.kind === "po") post.mutate({ path: "/inventory/purchase-orders", body: { supplierId: d.supplierId, lines: [{ itemId: d.itemId, qty: Number(d.qty), unitCost: Number(d.cost) }] } });
    if (form.kind === "adjust") post.mutate({ path: "/inventory/adjustments", body: { lotId: d.lotId, qty: Number(d.qty), reason: d.reason } });
  };
  const tabs = [{ id: "stock", label: t("inv.stock") }, { id: "po", label: t("inv.po") }, { id: "counts", label: t("inv.counts") }, { id: "cost", label: t("inv.cost") }, { id: "moves", label: t("inv.moves") }];
  return (
    <>
      <PageHeader title={t("inv.title")} sub={t("inv.sub")} actions={m ? <><Button variant="outline" size="sm" onClick={() => setForm({ kind: "item", d: { code: "", name: "", unit: "pcs", category: "REAGENT", level: "", qty: "", supplierId: "" } })}>{t("inv.newItem")}</Button><Button size="sm" onClick={() => setForm({ kind: "receive", d: { supplierId: "", itemId: "", lot: "", expiry: "", qty: "", cost: "", invoiceRef: "" } })}><PackagePlus aria-hidden className="size-4" />{t("inv.receive")}</Button></> : null} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label={t("inv.kpi.items")} value={String(s?.items ?? 0)} /><StatCard label={t("inv.kpi.lowStock")} value={String(s?.lowStock ?? 0)} tone={s?.lowStock ? "warn" : "good"} /><StatCard label={t("inv.kpi.expiring")} value={String(s?.expiringLots ?? 0)} tone={s?.expiringLots ? "warn" : "good"} /><StatCard label={t("inv.kpi.value")} value={money(s?.stockValue ?? 0, cur, i18n.language)} /><StatCard label={t("inv.kpi.shortfalls")} value={String(s?.shortfalls30d ?? 0)} tone={s?.shortfalls30d ? "bad" : "good"} />
      </div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "stock" ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-3"><SearchBox value={q} onChange={setQ} placeholder={t("common.search")} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} />{t("inv.onlyLow")}</label>{m ? <Button size="sm" variant="ghost" onClick={() => post.mutate({ path: "/inventory/dispose-expired" })}>{t("inv.disposeExpired")}</Button> : null}</div>
          <ErrorNote error={post.error} />
          {!stock.data?.length ? <EmptyState title={t("common.none")} /> : (
            <Table head={[t("inv.code"), t("common.name"), t("inv.category"), t("inv.onHand"), t("inv.reorderLevel"), t("inv.nextExpiry"), t("inv.avgCost"), t("inv.value"), ""]}>
              {stock.data.map((i) => <tr key={i.id} className={i.low ? "kx-row-warn" : undefined}><Td className="font-mono text-xs font-semibold">{i.code}</Td><Td dir="auto">{i.name}</Td><Td>{t(`inv.categories.${i.category}`)}</Td><Td className="tabular-nums font-semibold">{num(i.onHand)} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span>{i.low ? <Badge tone="warn" className="ms-2">{t("inv.low")}</Badge> : null}</Td><Td className="tabular-nums">{num(i.reorderLevel)}</Td><Td>{i.nextExpiry ? dOnly(i.nextExpiry, i18n.language) : "-"}{i.expiringLots ? <Badge tone="warn" className="ms-1">{i.expiringLots}</Badge> : null}{i.expiredQty > 0 ? <Badge tone="crit" className="ms-1">{t("inv.expired")}</Badge> : null}</Td><Td className="tabular-nums">{money(i.avgUnitCost, cur, i18n.language)}</Td><Td className="tabular-nums">{money(i.value, cur, i18n.language)}</Td><Td><Button size="sm" variant="ghost" onClick={() => setLotsOf(i)}>{t("inv.lots")}</Button></Td></tr>)}
            </Table>
          )}
        </>
      ) : null}
      {tab === "po" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">{m ? <><Button size="sm" onClick={() => setForm({ kind: "po", d: { supplierId: "", itemId: "", qty: "", cost: "" } })}><ShoppingCart aria-hidden className="size-4" />{t("inv.newPo")}</Button><Button size="sm" variant="outline" onClick={() => setForm({ kind: "supplier", d: { name: "", phone: "", email: "", lead: "7" } })}>{t("inv.newSupplier")}</Button></> : null}</div>
          {sugg.data?.length ? <Card><CardTitle>{t("inv.suggestions")}</CardTitle><ul className="space-y-1 text-sm">{sugg.data.map((x) => <li key={x.itemId} className="flex flex-wrap justify-between gap-2"><span dir="auto">{x.name} <span className="font-mono text-xs text-muted-foreground">{x.code}</span></span><span className="tabular-nums text-muted-foreground">{t("inv.suggest", { qty: x.suggestedQty, unit: x.unit })} · {x.supplier?.name ?? "-"} · {money(x.estimatedCost, cur, i18n.language)}</span></li>)}</ul></Card> : null}
          <Table head={[t("inv.poNumber"), t("inv.supplier"), t("common.status"), t("inv.lines"), t("bill.total"), ""]}>
            {(pos.data ?? []).map((p) => <tr key={p.id}><Td className="font-mono text-xs font-semibold">{p.number}</Td><Td>{p.supplier.name}</Td><Td><Badge tone={p.status === "RECEIVED" ? "ok" : p.status === "CANCELLED" ? "muted" : "info"}>{t(`inv.poStatus.${p.status}`)}</Badge></Td><Td className="tabular-nums">{p.lineCount}</Td><Td className="tabular-nums">{money(p.total, cur, i18n.language)}</Td><Td>{m && p.status === "DRAFT" ? <Button size="sm" onClick={() => post.mutate({ path: `/inventory/purchase-orders/${p.id}/send` })}>{t("inv.send")}</Button> : null}{m && ["DRAFT", "SENT"].includes(p.status) ? <Button size="sm" variant="ghost" onClick={() => post.mutate({ path: `/inventory/purchase-orders/${p.id}/cancel` })}>{t("common.cancel")}</Button> : null}</Td></tr>)}
          </Table>
        </div>
      ) : null}
      {tab === "counts" ? (
        <div className="space-y-3">{m ? <Button size="sm" onClick={() => post.mutate({ path: "/inventory/counts", body: {} })}>{t("inv.startCount")}</Button> : null}<ErrorNote error={post.error} />
          <Table head={[t("inv.countNumber"), t("common.status"), t("inv.lines"), t("common.date"), ""]}>{(counts.data ?? []).map((c) => <tr key={c.id}><Td className="font-mono text-xs font-semibold">{c.number}</Td><Td><Badge tone={c.status === "COMPLETED" ? "ok" : "warn"}>{t(`inv.countStatus.${c.status}`)}</Badge></Td><Td className="tabular-nums">{c._count.lines}</Td><Td>{dOnly(c.createdAt, i18n.language)}</Td><Td>{m && c.status === "OPEN" ? <Button size="sm" variant="outline" onClick={() => post.mutate({ path: `/inventory/counts/${c.id}/complete` })}>{t("inv.completeCount")}</Button> : null}</Td></tr>)}</Table>
          <p className="text-xs text-muted-foreground">{t("inv.countNote")}</p>
        </div>
      ) : null}
      {tab === "cost" ? (
        <Table head={[t("cat.test"), t("common.price"), t("inv.reagentCost"), t("inv.margin"), t("inv.marginPct"), t("inv.runs"), t("inv.actualCost")]}>{(cost.data ?? []).map((c) => <tr key={c.testId}><Td><span className="font-mono text-xs">{c.code}</span> <span dir="auto">{c.name}</span></Td><Td className="tabular-nums">{money(c.price, cur, i18n.language)}</Td><Td className="tabular-nums">{money(c.reagentCost, cur, i18n.language)}</Td><Td className="tabular-nums">{money(c.margin, cur, i18n.language)}</Td><Td className="tabular-nums">{c.marginPercent != null ? `${c.marginPercent}%` : "-"}</Td><Td className="tabular-nums">{c.runs}</Td><Td className="tabular-nums">{money(c.actualCost, cur, i18n.language)}</Td></tr>)}</Table>
      ) : null}
      {tab === "moves" ? (
        <Table head={[t("common.date"), t("common.type"), t("inv.qty"), t("inv.shortfall"), t("common.note")]}>{(moves.data ?? []).map((x) => <tr key={x.id}><Td>{dOnly(x.createdAt, i18n.language)}</Td><Td>{t(`inv.moveTypes.${x.type}`)}</Td><Td className={`tabular-nums ${x.qty < 0 ? "text-[hsl(var(--danger-text))]" : ""}`}>{x.qty}</Td><Td className="tabular-nums">{x.shortfall || ""}</Td><Td className="text-xs text-muted-foreground">{x.memo ?? x.refType}</Td></tr>)}</Table>
      ) : null}

      <Modal open={Boolean(lotsOf)} onClose={() => setLotsOf(null)} title={lotsOf ? `${lotsOf.code} · ${lotsOf.name}` : ""} wide>
        <Table head={[t("inv.lot"), t("qm.expires"), t("inv.onHand"), t("inv.unitCost"), t("common.status"), ""]}>{(lots.data ?? []).map((l) => <tr key={l.id} className={l.expired && l.qtyOnHand > 0 ? "kx-row-crit" : undefined}><Td className="font-mono text-xs">{l.lotNumber}</Td><Td>{l.expiryDate ? dOnly(l.expiryDate, i18n.language) : "-"}</Td><Td className="tabular-nums">{num(l.qtyOnHand)}</Td><Td className="tabular-nums">{money(l.unitCost, cur, i18n.language)}</Td><Td><Badge tone={l.status === "ACTIVE" ? "ok" : "warn"}>{t(`inv.lotStatus.${l.status}`)}</Badge></Td><Td>{m ? <div className="flex gap-1">{l.status === "ACTIVE" ? <Button size="sm" variant="ghost" onClick={() => post.mutate({ path: `/inventory/lots/${l.id}/status`, method: "PUT", body: { status: "QUARANTINE" } })}>{t("inv.quarantine")}</Button> : l.status === "QUARANTINE" ? <Button size="sm" variant="ghost" onClick={() => post.mutate({ path: `/inventory/lots/${l.id}/status`, method: "PUT", body: { status: "ACTIVE" } })}>{t("inv.release")}</Button> : null}<Button size="sm" variant="ghost" onClick={() => setForm({ kind: "adjust", d: { lotId: l.id, qty: "", reason: "" } })}>{t("inv.adjust")}</Button></div> : null}</Td></tr>)}</Table>
      </Modal>
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form ? t(`inv.forms.${form.kind}`) : ""} wide>
        {form ? <div className="grid gap-3 sm:grid-cols-2">
          {form.kind === "item" ? <><Field label={t("inv.code")}><Input value={d.code} onChange={(e) => set("code", e.target.value)} /></Field><Field label={t("common.name")}><Input value={d.name} onChange={(e) => set("name", e.target.value)} /></Field><Field label={t("inv.unit")}><Input value={d.unit} onChange={(e) => set("unit", e.target.value)} /></Field><Field label={t("inv.category")}><Select value={d.category} onChange={(e) => set("category", e.target.value)}>{["REAGENT", "CONSUMABLE", "CALIBRATOR", "CONTROL", "GENERAL"].map((k) => <option key={k} value={k}>{t(`inv.categories.${k}`)}</option>)}</Select></Field><Field label={t("inv.reorderLevel")}><Input type="number" value={d.level} onChange={(e) => set("level", e.target.value)} /></Field><Field label={t("inv.reorderQty")}><Input type="number" value={d.qty} onChange={(e) => set("qty", e.target.value)} /></Field><Field label={t("inv.supplier")}><Select value={d.supplierId} onChange={(e) => set("supplierId", e.target.value)}><option value="">-</option>{(suppliers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field></> : null}
          {form.kind === "supplier" ? <><Field label={t("common.name")}><Input value={d.name} onChange={(e) => set("name", e.target.value)} /></Field><Field label={t("orders.phone")}><Input value={d.phone} onChange={(e) => set("phone", e.target.value)} /></Field><Field label={t("pat.email")}><Input value={d.email} onChange={(e) => set("email", e.target.value)} /></Field><Field label={t("inv.leadTime")}><Input type="number" value={d.lead} onChange={(e) => set("lead", e.target.value)} /></Field></> : null}
          {["receive", "po"].includes(form.kind) ? <><Field label={t("inv.supplier")}><Select value={d.supplierId} onChange={(e) => set("supplierId", e.target.value)}><option value="">-</option>{(suppliers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field><Field label={t("inv.item")}><Select value={d.itemId} onChange={(e) => set("itemId", e.target.value)}><option value="">-</option>{(stock.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select></Field><Field label={t("inv.qty")}><Input type="number" value={d.qty} onChange={(e) => set("qty", e.target.value)} /></Field><Field label={t("inv.unitCost")}><Input type="number" value={d.cost} onChange={(e) => set("cost", e.target.value)} /></Field></> : null}
          {form.kind === "receive" ? <><Field label={t("inv.lot")}><Input value={d.lot} onChange={(e) => set("lot", e.target.value)} /></Field><Field label={t("qm.expires")}><Input type="date" value={d.expiry} onChange={(e) => set("expiry", e.target.value)} /></Field><Field label={t("inv.invoiceRef")} className="sm:col-span-2"><Input value={d.invoiceRef} onChange={(e) => set("invoiceRef", e.target.value)} /></Field></> : null}
          {form.kind === "adjust" ? <><Field label={t("inv.qtySigned")}><Input type="number" value={d.qty} onChange={(e) => set("qty", e.target.value)} /></Field><Field label={t("common.note")}><Input value={d.reason} onChange={(e) => set("reason", e.target.value)} /></Field></> : null}
          <div className="sm:col-span-2 space-y-2"><ErrorNote error={post.error} /><Button disabled={post.isPending} onClick={submit}>{t("common.save")}</Button></div>
        </div> : null}
      </Modal>
    </>
  );
}
