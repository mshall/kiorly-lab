import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Badge, Card, Spinner } from "@/components/ui";
import { PageHeader, StatusBadge } from "@/components/common";

function Stat({ label, value, to, tone }: { label: string; value: number | string; to?: string; tone?: "crit" | "warn" }) {
  const body = (
    <Card className={tone === "crit" && Number(value) > 0 ? "ring-2 ring-red-400" : tone === "warn" && Number(value) > 0 ? "ring-2 ring-amber-300" : ""}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<any>("/dashboard"), refetchInterval: 30_000 });
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data;
  return (
    <>
      <PageHeader title={t("dash.title")} sub={t("dash.sub", { name: me?.tenant.name })} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("dash.openBlocks")} value={d.openQcBlocks} to="/qc" tone="crit" />
        <Stat label={t("dash.openCritical")} value={d.openCriticalAlerts} to="/critical" tone="crit" />
        <Stat label={t("dash.awaitTech")} value={d.resultsAwaitingTechValidation} to="/validation" />
        <Stat label={t("dash.awaitMedical")} value={d.resultsAwaitingMedicalValidation} to="/validation" />
        <Stat label={t("dash.signedNotReleased")} value={d.signedNotReleased} to="/release" tone="warn" />
        <Stat label={t("dash.tatBreached")} value={d.tat.breached} to="/reports" tone="crit" />
        <Stat label={t("dash.tatAtRisk")} value={d.tat.atRisk} to="/reports" tone="warn" />
        <Stat label={t("dash.paymentsToday")} value={money(d.paymentsToday, me?.tenant.currency, i18n.language)} to="/billing" />
      </div>
      <Card className="mt-6">
        <h2 className="mb-3 text-sm font-semibold">{t("dash.ordersByStatus")}</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(d.ordersByStatus as Record<string, number>).map(([s, n]) => (
            <Link key={s} to={`/orders?status=${s}`} className="flex items-center gap-2 rounded-md bg-muted px-3 py-2"><StatusBadge value={s} /><Badge>{n}</Badge></Link>
          ))}
          {Object.keys(d.ordersByStatus).length === 0 ? <span className="text-sm text-muted-foreground">{t("common.none")}</span> : null}
        </div>
      </Card>
    </>
  );
}
