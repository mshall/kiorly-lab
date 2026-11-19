import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { dt } from "@/lib/format";
import { Button, Card, Empty, Input, Modal, Select, Spinner, Table, Td } from "@/components/ui";
import { ErrorNote, PageHeader, StatusBadge } from "@/components/common";
import { SpecimenPanel } from "./SpecimenPanel";

/** Reception / accessioning bench: scan-first. A scan opens the specimen; every move is label-matched by the API. */
export function AccessioningPage() {
  const { t, i18n } = useTranslation();
  const [scan, setScan] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const find = useMutation({ mutationFn: (barcode: string) => api<any>("/specimens/scan", { body: { barcode } }), onSuccess: (s) => { setOpen(s.id); setScan(""); } });
  const list = useQuery({ queryKey: ["specimens", status], queryFn: () => api<any[]>(`/specimens${status ? `?status=${status}` : ""}`) });
  return (
    <>
      <PageHeader title={t("spec.title")} sub={t("spec.sub")} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (scan) find.mutate(scan.trim()); }}>
          <div className="min-w-[14rem] flex-1"><label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="scan">{t("spec.scanOpen")}</label><Input id="scan" autoFocus value={scan} onChange={(e) => setScan(e.target.value)} placeholder="TL2611200001" /></div>
          <Button type="submit" disabled={!scan || find.isPending}>{t("spec.open")}</Button>
        </form>
        <div className="mt-2"><ErrorNote error={find.error} /></div>
      </Card>
      <div className="mb-3 flex items-center gap-2">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs" aria-label={t("common.status")}>
          <option value="">{t("common.all")}</option>
          {["PENDING_COLLECTION", "COLLECTED", "IN_TRANSIT", "RECEIVED", "PROCESSING", "STORED", "REJECTED"].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
      </div>
      {list.isLoading ? <Spinner /> : list.data?.length === 0 ? <Empty>{t("common.none")}</Empty> : (
        <Table head={[t("spec.accession"), t("orders.patient"), t("spec.type"), t("common.status"), t("common.created"), ""]}>
          {list.data?.map((s) => (
            <tr key={s.id}>
              <Td className="font-mono">{s.accessionNumber}</Td>
              <Td>{s.order.patient.fullName}</Td>
              <Td>{s.specimenType}</Td>
              <Td><StatusBadge value={s.status} /></Td>
              <Td>{dt(s.createdAt, i18n.language)}</Td>
              <Td className="text-end"><Button size="sm" variant="outline" onClick={() => setOpen(s.id)}>{t("common.open")}</Button> <Link to={`/orders/${s.orderId}`} className="ms-2 text-xs text-primary underline">{t("spec.order")}</Link></Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={t("spec.details")} wide>{open ? <SpecimenPanel specimenId={open} /> : null}</Modal>
    </>
  );
}
