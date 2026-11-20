import { useDeferredValue, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Home, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Select, Table, Td } from "@/components/ui";
import { PageHeader, StatusBadge } from "@/components/common";
import { PriorityChip, SearchBox, Segmented } from "@/components/kit";
import { EmptyState, Surface, TableSkeleton, kcn } from "@/brand/ui-kit";

const QUEUES = ["", "AWAITING_COLLECTION", "IN_LAB", "AWAITING_VALIDATION", "VALIDATED", "RELEASED", "CANCELLED"];
const PAGE = 25;

const TestList = ({ items }: { items: any[] }) => {
  const codes = items.map((i) => i.test.code);
  return <span className="text-sm"><span className="font-mono text-xs">{codes.slice(0, 3).join(", ")}</span>{codes.length > 3 ? <span className="ms-1 rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">+{codes.length - 3}</span> : null}</span>;
};

export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { can, flagOn } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const deferred = useDeferredValue(search);
  const status = sp.get("status") ?? "";
  const source = sp.get("source") ?? "";
  const q = useQuery({
    queryKey: ["orders", status, source, deferred, page],
    queryFn: () => api<any>(`/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(deferred ? { search: deferred } : {}), limit: String(PAGE), offset: String(page * PAGE) })}`),
    placeholderData: keepPreviousData,
  });
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n); setPage(0); };
  const total: number = q.data?.total ?? 0;
  const rows: any[] = q.data?.rows ?? [];
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min(total, page * PAGE + rows.length);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNowMs(Date.now()), 30_000); return () => clearInterval(i); }, []);
  const age = (v: string) => { const m = Math.max(0, Math.round((nowMs - new Date(v).getTime()) / 60000)); return m < 60 ? t("ux.age.min", { n: m }) : m < 1440 ? t("ux.age.hour", { n: Math.floor(m / 60) }) : t("ux.age.day", { n: Math.floor(m / 1440) }); };
  return (
    <>
      <PageHeader title={t("orders.title")} sub={t("orders.sub")} actions={can("orders.create") && flagOn("lab.module") ? <Link to="/orders/new"><Button><Plus aria-hidden className="size-4" />{t("orders.new")}</Button></Link> : null} />
      <Surface className="mb-4 space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder={t("orders.search")} />
          <Select value={source} onChange={(e) => setParam("source", e.target.value)} className="w-auto min-w-44" aria-label={t("orders.source")}>
            <option value="">{t("orders.source")}: {t("common.all")}</option>
            {["WALK_IN", "KIORLY_CLINIC", "KIOREX_BOOKING", "REFERRING_DOCTOR"].map((s) => <option key={s} value={s}>{t(`orders.sources.${s}`)}</option>)}
          </Select>
          <span className="ms-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">{total ? t("ux.range", { from, to, total }) : ""}</span>
        </div>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Segmented label={t("common.status")} value={status} onChange={(v) => setParam("status", v)} className="flex-nowrap" items={QUEUES.map((s) => ({ id: s, label: s ? t(`status.${s}`) : t("common.all") }))} />
        </div>
      </Surface>
      {q.isLoading ? <Surface><TableSkeleton rows={8} cols={5} /></Surface> : !rows.length ? (
        <EmptyState title={t("common.none")} description={search || status || source ? t("ux.noMatch") : undefined} action={search || status || source ? <Button variant="outline" size="sm" onClick={() => { setSearch(""); setSp({}); }}>{t("ux.clearFilters")}</Button> : undefined} />
      ) : (
        <div className={kcn("transition-opacity", q.isPlaceholderData && "opacity-60")}>
          <div className="hidden md:block">
            <Table head={[t("orders.number"), t("orders.patient"), t("orders.source"), t("orders.tests"), t("common.status"), t("common.created")]}>
              {rows.map((o: any) => (
                <tr key={o.id} className={kcn("cursor-pointer", o.priority === "STAT" && "kx-row-stat")} onClick={(e) => { if (!(e.target as HTMLElement).closest("a,button")) nav(`/orders/${o.id}`); }}>
                  <Td className="whitespace-nowrap"><Link to={`/orders/${o.id}`} className="font-mono font-semibold text-primary underline-offset-4 hover:underline">{o.orderNumber}</Link> <PriorityChip priority={o.priority} className="ms-1" /></Td>
                  <Td><span dir="auto" className="font-medium">{o.patient.fullName}</span></Td>
                  <Td className="whitespace-nowrap"><span className="text-xs text-muted-foreground">{t(`orders.sources.${o.source}`)}</span>{o.collectionType === "HOME" ? <Badge tone="pulse" className="ms-2 gap-1"><Home aria-hidden className="size-3" />{t("orders.home")}</Badge> : null}</Td>
                  <Td><TestList items={o.items} /></Td>
                  <Td><StatusBadge value={o.status} /></Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground" title={dt(o.createdAt, i18n.language)}>{age(o.createdAt)}<span className="ms-2 hidden xl:inline">{dt(o.createdAt, i18n.language)}</span></Td>
                </tr>
              ))}
            </Table>
          </div>
          <ul className="space-y-3 md:hidden">
            {rows.map((o: any) => (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className={kcn("block rounded-xl border border-border/80 bg-card p-3 shadow-kx-1 active:translate-y-px", o.priority === "STAT" && "kx-stat-card")}>
                  <div className="flex items-start justify-between gap-2"><span className="font-mono text-sm font-semibold text-primary">{o.orderNumber}</span><StatusBadge value={o.status} /></div>
                  <div className="mt-1 text-sm font-medium" dir="auto">{o.patient.fullName}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><PriorityChip priority={o.priority} /><span>{t(`orders.sources.${o.source}`)}</span>{o.collectionType === "HOME" ? <Badge tone="pulse">{t("orders.home")}</Badge> : null}<span className="ms-auto tabular-nums">{age(o.createdAt)}</span></div>
                  <div className="mt-1.5"><TestList items={o.items} /></div>
                </Link>
              </li>
            ))}
          </ul>
          {total > PAGE ? (
            <nav aria-label={t("ux.pagination")} className="mt-3 flex items-center justify-between gap-3">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}><ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />{t("ux.prev")}</Button>
              <span className="text-xs tabular-nums text-muted-foreground">{t("ux.range", { from, to, total })}</span>
              <Button variant="outline" size="sm" disabled={to >= total} onClick={() => setPage((p) => p + 1)}>{t("ux.next")}<ChevronRight aria-hidden className="size-4 rtl:rotate-180" /></Button>
            </nav>
          ) : null}
        </div>
      )}
    </>
  );
}
