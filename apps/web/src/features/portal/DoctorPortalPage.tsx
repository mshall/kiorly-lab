import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, Lock } from "lucide-react";
import { ApiError } from "@/lib/api";
import { dt } from "@/lib/format";
import { setLang, type Lang } from "@/lib/i18n";
import { Badge, Button, Table, Td } from "@/components/ui";
import { EmptyState, KiorlyBrand, Skeleton, Surface } from "@/brand/ui-kit";
import { StatusBadge } from "@/components/common";

async function pub<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code ?? res.statusText, data);
  return data as T;
}

/** Referring-doctor portal (public, token link issued by the lab): own patients' orders; reports only when released AND the patient consented. */
export function DoctorPortalPage() {
  const { token = "" } = useParams();
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ["portal", token], queryFn: () => pub<any>(`/public/portal/${token}/orders`), retry: false });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { document.title = t("portal.title"); }, [t, i18n.language]);
  const open = async (orderId: string) => {
    setBusy(orderId);
    try {
      const res = await fetch(`/api/v1/public/portal/${token}/orders/${orderId}/report.pdf`);
      if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank", "noopener");
    } finally { setBusy(null); }
  };
  const next: Lang = i18n.language === "ar" ? "en" : "ar";
  return (
    <div className="mx-auto min-h-screen max-w-4xl p-4 sm:p-8">
      <header className="mb-6 flex items-center justify-between gap-3"><KiorlyBrand height={36} /><Button variant="outline" size="sm" onClick={() => setLang(next)}>{t("app.lang")}</Button></header>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <EmptyState tone="error" title={t("portal.invalid")} description={t("portal.invalidHint")} /> : (
        <>
          <h1 className="text-2xl font-semibold" dir="auto">{q.data.referrer.name}</h1>
          <p className="mb-4 text-sm text-muted-foreground">{t("portal.sub")}</p>
          {!q.data.orders.length ? <EmptyState title={t("common.none")} /> : (
            <Surface className="overflow-hidden">
              <Table className="rounded-none border-0 shadow-none" head={[t("order.number"), t("orders.patient"), t("orders.tests"), t("common.status"), t("common.date"), ""]}>
                {q.data.orders.map((o: any) => (
                  <tr key={o.id}>
                    <Td className="font-mono text-xs">{o.orderNumber}</Td><Td dir="auto">{o.patient}</Td><Td className="max-w-[14rem] truncate text-xs" dir="auto">{o.tests.join(", ")}</Td><Td><StatusBadge value={o.status} /></Td><Td className="text-xs">{dt(o.createdAt, i18n.language)}</Td>
                    <Td>{o.report ? <Button size="sm" variant="outline" disabled={busy === o.id} onClick={() => void open(o.id)}><FileText aria-hidden className="size-4" />PDF v{o.report.version}</Button> : o.status === "RELEASED" && !o.consented ? <Badge tone="muted"><Lock aria-hidden className="me-1 size-3" />{t("portal.noConsent")}</Badge> : null}</Td>
                  </tr>
                ))}
              </Table>
            </Surface>
          )}
          <p className="mt-4 text-xs text-muted-foreground">{t("portal.privacy")}</p>
        </>
      )}
    </div>
  );
}

/** QR target printed on every report: shows whether this report version is genuine and current. No patient data. */
export function VerifyReportPage() {
  const { id = "" } = useParams();
  const { t, i18n } = useTranslation();
  const q = useQuery({ queryKey: ["verify", id], queryFn: () => pub<any>(`/public/verify/${id}`), retry: false });
  return (
    <div className="mx-auto grid min-h-screen max-w-md place-items-center p-6">
      <Surface className="w-full space-y-3 p-6 text-center">
        <KiorlyBrand height={34} className="mx-auto" />
        {q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <EmptyState tone="error" title={t("portal.verifyInvalid")} /> : (
          <>
            <Badge tone={q.data.superseded ? "warn" : "ok"} className="text-sm">{q.data.superseded ? t("portal.verifySuperseded", { v: q.data.latestVersion }) : t("portal.verifyOk")}</Badge>
            <dl className="space-y-1 text-sm"><div><dt className="inline text-muted-foreground">{t("portal.lab")}: </dt><dd className="inline font-medium" dir="auto">{q.data.lab}</dd></div><div><dt className="inline text-muted-foreground">{t("order.version")}: </dt><dd className="inline tabular-nums">v{q.data.version}</dd></div><div><dt className="inline text-muted-foreground">{t("order.signedAt")}: </dt><dd className="inline">{dt(q.data.signedAt, i18n.language)}</dd></div><div className="font-mono text-xs text-muted-foreground">{q.data.contentHashPrefix}…</div></dl>
            <p className="text-xs text-muted-foreground">{t("portal.verifyNote")}</p>
          </>
        )}
      </Surface>
    </div>
  );
}
