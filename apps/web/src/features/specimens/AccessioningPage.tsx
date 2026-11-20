import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ScanBarcode } from "lucide-react";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import { Button, Input, Modal, Table, Td } from "@/components/ui";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";
import { PriorityChip, SearchBox, Segmented, priorityRank } from "@/components/kit";
import { EmptyState, Surface, TableSkeleton, kcn } from "@/brand/ui-kit";
import { SpecimenPanel } from "./SpecimenPanel";

const STATUSES = ["PENDING_COLLECTION", "COLLECTED", "IN_TRANSIT", "RECEIVED", "PROCESSING", "STORED", "REJECTED"];

/** Reception / accessioning bench: scan-first. A scan opens the specimen; every move is label-matched by the API. */
export function AccessioningPage() {
  const { t, i18n } = useTranslation();
  const [scan, setScan] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const find = useMutation({ mutationFn: (barcode: string) => api<any>("/specimens/scan", { body: { barcode } }), onSuccess: (s) => { setOpen(s.id); setScan(""); } });
  const list = useQuery({ queryKey: ["specimens"], queryFn: () => api<any[]>("/specimens") });
  const all = useMemo(() => list.data ?? [], [list.data]);
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, all.filter((x) => x.status === s).length])), [all]);
  const needle = search.trim().toLowerCase();
  const rows = all
    .filter((x) => (!status || x.status === status) && (!needle || x.accessionNumber.toLowerCase().includes(needle) || (x.order.patient.fullName ?? "").toLowerCase().includes(needle)))
    .sort((a, b) => priorityRank(a.order.priority) - priorityRank(b.order.priority));
  return (
    <>
      <PageHeader title={t("spec.title")} sub={t("spec.sub")} />
      <Surface className="mb-4 p-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (scan) find.mutate(scan.trim()); }}>
          <div className="min-w-56 flex-1">
            <label className="mb-1.5 flex items-center gap-2 text-sm font-medium" htmlFor="scan"><ScanBarcode aria-hidden className="size-4 text-primary" />{t("spec.scanOpen")}</label>
            <Input id="scan" autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder="TL2611200001" autoComplete="off" spellCheck={false} className="h-12 font-mono text-base tracking-wider" />
          </div>
          <Button type="submit" size="lg" disabled={!scan || find.isPending}>{t("spec.open")}</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{t("ux.accession.scanTip")}</p>
        <div className="mt-2"><ErrorNote error={find.error} /></div>
      </Surface>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented label={t("common.status")} value={status} onChange={setStatus} className="flex-nowrap" items={[{ id: "", label: t("common.all"), count: all.length }, ...STATUSES.map((s) => ({ id: s, label: t(`status.${s}`), count: counts[s] as number }))]} />
        </div>
        <SearchBox value={search} onChange={setSearch} placeholder={t("ux.accession.search")} className="ms-auto" />
      </div>
      {list.isLoading ? <Surface><TableSkeleton rows={7} cols={5} /></Surface> : rows.length === 0 ? <EmptyState compact title={t("common.none")} /> : (
        <Table head={[t("spec.accession"), t("orders.patient"), t("spec.type"), t("common.status"), t("common.created"), ""]}>
          {rows.map((s) => (
            <tr key={s.id} className={kcn(s.order.priority === "STAT" && "kx-row-stat")}>
              <Td className="whitespace-nowrap font-mono font-semibold">{s.accessionNumber} <PriorityChip priority={s.order.priority} className="ms-1 font-sans" /></Td>
              <Td><span dir="auto">{s.order.patient.fullName}</span></Td>
              <Td>{s.specimenType}</Td>
              <Td><StatusBadge value={s.status} /></Td>
              <Td className="whitespace-nowrap text-xs text-muted-foreground">{dt(s.createdAt, i18n.language)}</Td>
              <Td className="whitespace-nowrap text-end"><Button size="sm" variant="outline" onClick={() => setOpen(s.id)}>{t("common.open")}</Button> <Link to={`/orders/${s.orderId}`} className="ms-2 text-xs text-primary underline-offset-4 hover:underline">{t("spec.order")}</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={t("spec.details")} wide>{open ? <SpecimenPanel specimenId={open} /> : null}</Modal>
    </>
  );
}
