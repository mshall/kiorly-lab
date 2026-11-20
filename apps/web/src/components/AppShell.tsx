import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, BarChart3, BookOpen, ClipboardList, CreditCard, FileCheck2, FlaskConical, LayoutDashboard, Menu, Microscope, ScanBarcode, Settings, ShieldCheck, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/ui";
import { KiorlyBrand, ThemeToggle } from "@/brand/ui-kit";

const NAV = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, perm: "dashboard.read", end: true },
  { to: "/orders", key: "orders", icon: ClipboardList, perm: "orders.read" },
  { to: "/accessioning", key: "accessioning", icon: ScanBarcode, perm: "specimens.read" },
  { to: "/worklist", key: "worklist", icon: FlaskConical, perm: "results.read" },
  { to: "/validation", key: "validation", icon: ShieldCheck, perm: "results.read" },
  { to: "/qc", key: "qc", icon: Activity, perm: "qc.read" },
  { to: "/release", key: "release", icon: FileCheck2, perm: "reports.read" },
  { to: "/critical", key: "critical", icon: AlertTriangle, perm: "critical.read" },
  { to: "/billing", key: "billing", icon: CreditCard, perm: "billing.read" },
  { to: "/reports", key: "reports", icon: BarChart3, perm: "dashboard.read" },
  { to: "/catalogue", key: "catalogue", icon: BookOpen, perm: "catalogue.read" },
  { to: "/settings", key: "settings", icon: Settings, perm: "staff.manage" },
] as const;

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { me, can, logout, flagOn } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const next: Lang = i18n.language === "ar" ? "en" : "ar";
  const alerts = useQuery({ queryKey: ["critical-count"], queryFn: () => api<any[]>("/critical-alerts"), enabled: can("critical.read"), refetchInterval: 30_000 });
  const openAlerts = alerts.data?.length ?? 0;
  const items = NAV.filter((n) => can(n.perm));
  return (
    <div className="flex min-h-screen">
      <aside className={cn("fixed inset-y-0 start-0 z-40 w-64 shrink-0 border-e border-border bg-card p-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto transition-transform lg:translate-x-0", open ? "translate-x-0" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full")}>
        <div className="mb-6 border-b border-border pb-4">
          <KiorlyBrand height={40} />
          <div className="mt-2 text-sm font-semibold leading-tight">{t("app.product")}</div>
          <div className="truncate text-xs text-muted-foreground">{me?.tenant.name}</div>
        </div>
        <nav className="space-y-1" aria-label="main">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} end={"end" in n} onClick={() => setOpen(false)} className={({ isActive }) => cn("relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150", isActive ? "bg-accent font-semibold text-accent-foreground before:absolute before:inset-y-2 before:start-0 before:w-[3px] before:rounded-full before:bg-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              <n.icon className="h-4 w-4" />
              <span className="flex-1">{t(`nav.${n.key}`)}</span>
              {n.key === "critical" && openAlerts > 0 ? <Badge tone="crit">{openAlerts}</Badge> : null}
            </NavLink>
          ))}
          {can("collection.perform") ? (
            <NavLink to="/phleb" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/60"><Smartphone className="h-4 w-4" />{t("nav.phleb")}</NavLink>
          ) : null}
        </nav>
        <p className="mt-6 text-xs text-muted-foreground">{t("shell.safetyNote")}</p>
      </aside>
      {open ? <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-2.5 backdrop-blur">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></Button>
          <div className="flex-1" />
          {!flagOn("lab.module") ? <Badge tone="warn">{t("shell.moduleOff")}</Badge> : null}
          <Badge tone="info"><Microscope className="me-1 h-3 w-3" />{me?.tenant.edition}</Badge>
          <ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} />
          <Button variant="outline" size="sm" onClick={() => setLang(next)}>{t("app.lang")}</Button>
          <div className="hidden text-end text-xs sm:block">
            <div className="font-medium">{me?.user.displayName}</div>
            <div className="text-muted-foreground">{me ? t(`role.${me.user.role}`) : ""}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { logout(); nav("/login"); }}>{t("auth.logout")}</Button>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
