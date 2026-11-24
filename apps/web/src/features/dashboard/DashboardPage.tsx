import { KiorexHomeCard } from "@/features/kiorex/KiorexFrontDoor";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Badge, Card, Spinner } from "@/components/ui";
import { PageHeader, StatusBadge } from "@/components/common";
import { StatCard } from "@/brand/ui-kit";

function Stat({ label, value, to, tone }: { label: string; value: number | string; to?: string; tone?: "crit" | "warn" }) {
  const hot = (tone === "crit" || tone === "warn") && Number(value) > 0;
  const body = <StatCard label={label} value={value} tone={hot ? (tone === "crit" ? "bad" : "warn") : "neutral"} className="h-full hover:border-primary/40" />;
  return to ? <Link to={to} className="block rounded-xl transition-transform duration-150 hover:-translate-y-0.5 motion-reduce:transition-none">{body}</Link> : body;
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
      <KiorexHomeCard />
      {(d.openCriticalAlerts > 0 || d.openQcBlocks > 0) && (
        <ul aria-label={t("dash.attention")} className="mb-5 space-y-2">
          {d.openCriticalAlerts > 0 && <li><Link to="/critical" className="flex items-center gap-3 rounded-xl border-2 border-[hsl(var(--danger-text))] bg-[hsl(var(--danger-text)/0.08)] px-4 py-3 font-bold text-[hsl(var(--danger-text))]"><span className="kx-pulse-dot" aria-hidden="true" />{t("crit.banner", { n: d.openCriticalAlerts })}</Link></li>}
          {d.openQcBlocks > 0 && <li><Link to="/qc" className="flex items-center gap-3 rounded-xl border border-[hsl(var(--danger-text)/0.35)] bg-[hsl(var(--danger-text)/0.07)] px-4 py-3 text-sm font-semibold text-[hsl(var(--danger-text))]">{t("qc.blocked", { n: d.openQcBlocks })}</Link></li>}
        </ul>
      )}
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("dash.grpResults")}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("dash.awaitTech")} value={d.resultsAwaitingTechValidation} to="/validation" />
        <Stat label={t("dash.awaitMedical")} value={d.resultsAwaitingMedicalValidation} to="/validation" />
        <Stat label={t("dash.signedNotReleased")} value={d.signedNotReleased} to="/release" tone="warn" />
        <Stat label={t("dash.openCritical")} value={d.openCriticalAlerts} to="/critical" tone="crit" />
      </div>
      <h2 className="mb-3 mt-6 text-sm font-semibold text-muted-foreground">{t("dash.grpOps")}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("dash.openBlocks")} value={d.openQcBlocks} to="/qc" tone="crit" />
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
