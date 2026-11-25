import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Megaphone, Activity, AlertTriangle, BadgeCheck, BarChart3, BookOpen, BriefcaseMedical, Bug, ClipboardList, CreditCard, FileCheck2, FlaskConical, LayoutDashboard, ArrowLeftRight, LineChart, Link2, LogOut, Menu, Microscope, Package, ScanBarcode, Settings, ShieldCheck, Smartphone, Snowflake, Ticket, Users, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { SetupBar, SetupChecklist } from "@/setup/setup-core";
import { useAuth } from "@/lib/auth";
import { homeUrlFromEnv, LOCAL_HOME_URL, switchWorkspaceHref } from "@/lib/kiorly-home";
import { applyTenantDefault, setLang } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button } from "@/components/ui";
import { routeDenied, type GuardedNavItem } from "@/lib/route-access";
import { KiorlyBrandLockup, KxControlPair, LanguageToggle, ThemeToggle } from "@/brand/ui-kit";

const NAV_GROUPS = [
  { key: "front", items: [
    { to: "/", key: "dashboard", icon: LayoutDashboard, perm: "dashboard.read", end: true },
    { to: "/reception", key: "reception", icon: Ticket, perm: "orders.read" },
    { to: "/orders", key: "orders", icon: ClipboardList, perm: "orders.read" },
    { to: "/patients", key: "patients", icon: Users, perm: "patients.read" },
    { to: "/referrers", key: "referrers", icon: BriefcaseMedical, perm: "referrers.read" },
  ] },
  { key: "lab", items: [
    { to: "/accessioning", key: "accessioning", icon: ScanBarcode, perm: "specimens.read" },
    { to: "/storage", key: "storage", icon: Snowflake, perm: "specimens.read" },
    { to: "/worklist", key: "worklist", icon: FlaskConical, perm: "results.read" },
    { to: "/microbiology", key: "microbiology", icon: Bug, perm: "results.read" },
    { to: "/validation", key: "validation", icon: ShieldCheck, perm: "results.read" },
    { to: "/release", key: "release", icon: FileCheck2, perm: "reports.read" },
    { to: "/critical", key: "critical", icon: AlertTriangle, perm: "critical.read" },
  ] },
  { key: "quality", items: [
    { to: "/qc", key: "qc", icon: Activity, perm: "qc.read" },
    { to: "/quality", key: "quality", icon: BadgeCheck, perm: "quality.read" },
    { to: "/inventory", key: "inventory", icon: Package, perm: "inventory.read" },
  ] },
  { key: "business", items: [
    { to: "/billing", key: "billing", icon: CreditCard, perm: "billing.read" },
    { to: "/finance", key: "finance", icon: Wallet, perm: "billing.read" },
    { to: "/analytics", key: "analytics", icon: LineChart, perm: "analytics.read" },
    { to: "/reports", key: "reports", icon: BarChart3, perm: "dashboard.read" },
    { to: "/growth", key: "growth", icon: Megaphone, perm: "referrers.read" },
  ] },
  { key: "admin", items: [
    { to: "/catalogue", key: "catalogue", icon: BookOpen, perm: "catalogue.read" },
    { to: "/kiorex-connect", key: "kiorexConnect", icon: Link2, perm: "settings.manage" },
    { to: "/plan", key: "plan", icon: CreditCard, perm: "settings.manage" },
    { to: "/settings", key: "settings", icon: Settings, perm: "staff.manage" },
  ] },
] as const;

export function AppShell() {
  const { t } = useTranslation();
  const { me, can, logout, flagOn } = useAuth();
  const switchHref = switchWorkspaceHref(homeUrlFromEnv({ VITE_KIORLY_HOME_URL: import.meta.env.VITE_KIORLY_HOME_URL as string | undefined, DEV: import.meta.env.DEV, localDefault: import.meta.env.DEV ? LOCAL_HOME_URL : undefined }));
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => { applyTenantDefault(me?.tenant.defaultLocale); }, [me?.tenant.defaultLocale]);
  const alerts = useQuery({ queryKey: ["critical-count"], queryFn: () => api<any[]>("/critical-alerts"), enabled: can("critical.read"), refetchInterval: 30_000 });
  const openAlerts = alerts.data?.length ?? 0;
  // Direct-URL guard: a page whose nav entry is hidden for this role says so instead of sitting on a 403-fed skeleton.
  const { pathname } = useLocation();
  const routeBlocked = Boolean(me) && routeDenied(pathname, NAV_GROUPS.flatMap((g): readonly GuardedNavItem[] => g.items), can);
  return (
    <div className="flex min-h-screen">
      <aside className={cn("fixed inset-y-0 inset-s-0 z-40 w-64 shrink-0 border-e border-border bg-card p-4 lg:sticky lg:top-0 lg:h-screen overflow-y-auto transition-transform lg:translate-x-0", open ? "translate-x-0" : "max-lg:-translate-x-full max-lg:rtl:translate-x-full")}>
        <div className="mb-6 border-b border-border pb-4">
          <KiorlyBrandLockup height={40} />
          <div className="mt-2 truncate text-xs text-muted-foreground">{me?.tenant.name}</div>
        </div>
        <div className="mb-4 lg:hidden"><KxControlPair><ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} /><LanguageToggle onChange={setLang} /></KxControlPair></div>
        <nav className="space-y-4" aria-label="main">
          {NAV_GROUPS.map((g) => {
            const items = g.items.filter((n) => can(n.perm));
            if (!items.length) return null;
            return (
              <div key={g.key} role="group" aria-label={t(`nav.groups.${g.key}`)} className="space-y-1">
                <div className="px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 rtl:normal-case rtl:tracking-normal">{t(`nav.groups.${g.key}`)}</div>
                {items.map((n) => (
                  <NavLink key={n.to} to={n.to} end={"end" in n} onClick={() => setOpen(false)} className={({ isActive }) => cn("relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-150", isActive ? "bg-accent font-semibold text-accent-foreground before:absolute before:inset-y-2 before:inset-s-0 before:w-[3px] before:rounded-full before:bg-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    <n.icon className="h-4 w-4" />
                    <span className="flex-1">{t(`nav.${n.key}`)}</span>
                    {n.key === "critical" && openAlerts > 0 ? <Badge tone="crit">{openAlerts}</Badge> : null}
                  </NavLink>
                ))}
              </div>
            );
          })}
          {can("collection.perform") ? (
            <NavLink to="/phleb" className="flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Smartphone className="h-4 w-4" />{t("nav.phleb")}</NavLink>
          ) : null}
        </nav>
        <p className="mt-6 text-xs text-muted-foreground">{t("shell.safetyNote")}</p>
      </aside>
      {open ? <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card/90 px-4 py-2.5 backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></Button>
          <div className="flex-1" />
          <div className="hidden items-center gap-3 sm:flex">
            {!flagOn("lab.module") ? <Badge tone="warn">{t("shell.moduleOff")}</Badge> : null}
            <Badge tone={me?.tenant.integrationMode === "STANDALONE" ? "muted" : "info"} title={t("set.mode")}>{me?.tenant.integrationMode === "STANDALONE" ? t("shell.standalone") : t("shell.integrated")}</Badge>
            <Badge tone="info"><Microscope className="me-1 h-3 w-3" />{me?.tenant.edition}</Badge>
          </div>
          <KxControlPair><ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} /><LanguageToggle onChange={setLang} /></KxControlPair>
          <div className="hidden text-end text-xs sm:block">
            <div className="font-medium">{me?.user.displayName}</div>
            <div className="text-muted-foreground">{me ? t(`role.${me.user.role}`) : ""}</div>
          </div>
          {switchHref ? <a href={switchHref} data-testid="switch-workspace" title={t("auth.switchWorkspace")} aria-label={t("auth.switchWorkspace")} className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-medium text-primary underline-offset-4 hover:underline"><ArrowLeftRight aria-hidden className="size-4 rtl:rotate-180 sm:hidden" /><span className="hidden sm:inline">{t("auth.switchWorkspace")}</span></a> : null}
          <Button variant="ghost" size="sm" className="h-10 shrink-0 whitespace-nowrap" aria-label={t("auth.logout")} onClick={() => { if (!logout()) nav("/login"); }}><LogOut aria-hidden className="size-4 rtl:rotate-180 sm:hidden" /><span className="hidden sm:inline">{t("auth.logout")}</span></Button>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6"><SetupBar />{pathname === "/" && !routeBlocked ? <SetupChecklist /> : null}{routeBlocked ? (
          <div role="alert" data-testid="route-denied" className="mx-auto mt-16 max-w-md space-y-3 text-center">
            <h1 className="text-xl font-semibold">{t("shell.noAccessTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("shell.noAccessBody")}</p>
            <Link to="/" className="inline-block text-sm font-medium text-primary underline-offset-2 hover:underline">{t("nav.dashboard")}</Link>
          </div>
        ) : <Outlet />}</main>
      </div>
    </div>
  );
}
