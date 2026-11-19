import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Badge, Button, Empty, Input, Select, Spinner, Table, Td } from "@/components/ui";
import { PageHeader, StatusBadge } from "@/components/common";

const STATUSES = ["AWAITING_COLLECTION", "COLLECTED", "IN_LAB", "PARTIALLY_RESULTED", "AWAITING_VALIDATION", "VALIDATED", "RELEASED", "CANCELLED"];

export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const { can, flagOn } = useAuth();
  const [sp, setSp] = useSearchParams();
  const [search, setSearch] = useState("");
  const status = sp.get("status") ?? "";
  const source = sp.get("source") ?? "";
  const q = useQuery({ queryKey: ["orders", status, source, search], queryFn: () => api<any>(`/orders?${new URLSearchParams({ ...(status ? { status } : {}), ...(source ? { source } : {}), ...(search ? { search } : {}) })}`) });
  return (
    <>
      <PageHeader title={t("orders.title")} sub={t("orders.sub")} actions={can("orders.create") && flagOn("lab.module") ? <Link to="/orders/new"><Button>{t("orders.new")}</Button></Link> : null} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder={t("orders.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" aria-label={t("orders.search")} />
        <Select value={status} onChange={(e) => setSp(e.target.value ? { status: e.target.value } : {})} className="max-w-xs" aria-label={t("common.status")}>
          <option value="">{t("common.all")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
        <Select value={source} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.value) n.set("source", e.target.value); else n.delete("source"); setSp(n); }} className="max-w-xs" aria-label={t("orders.source")}>
          <option value="">{t("common.all")}</option>
          {["WALK_IN", "KIORLY_CLINIC", "KIOREX_BOOKING", "REFERRING_DOCTOR"].map((s) => <option key={s} value={s}>{t(`orders.sources.${s}`)}</option>)}
        </Select>
      </div>
      {q.isLoading ? <Spinner /> : !q.data?.rows.length ? <Empty>{t("common.none")}</Empty> : (
        <Table head={[t("orders.number"), t("orders.patient"), t("orders.source"), t("orders.tests"), t("common.status"), t("common.created")]}>
          {q.data.rows.map((o: any) => (
            <tr key={o.id} className="hover:bg-accent/40">
              <Td className="whitespace-nowrap"><Link to={`/orders/${o.id}`} className="font-mono font-medium text-primary underline">{o.orderNumber}</Link></Td>
              <Td>{o.patient.fullName}</Td>
              <Td><Badge tone="info">{t(`orders.sources.${o.source}`)}</Badge>{o.collectionType === "HOME" ? <Badge tone="pulse" className="ms-1">{t("orders.home")}</Badge> : null}{o.priority !== "ROUTINE" ? <Badge tone="crit" className="ms-1">{o.priority}</Badge> : null}</Td>
              <Td>{o.items.map((i: any) => i.test.code).join(", ")}</Td>
              <Td><StatusBadge value={o.status} /></Td>
              <Td>{dt(o.createdAt, i18n.language)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
