import { useState } from "react";
import { KiorlyBrand, KiorlyFootText, Pulse, ThemeToggle, Surface, Skeleton, kcn } from "@/brand/ui-kit";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, FlaskConical, ShieldCheck, Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setLang } from "@/lib/i18n";
import { Button, Field, Select } from "@/components/ui";
import { ErrorNote } from "@/components/common";
import { KiorexLogo } from "@/brand/components";

/** Dev sign-in (AUTH_MODE=dev). Production uses Kiorex Account OIDC (NH-LB-016); the app never stores passwords. */
export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { token, login } = useAuth();
  const nav = useNavigate();
  const orgs = useQuery({ queryKey: ["dev-orgs"], queryFn: () => api<any[]>("/auth/dev/orgs"), retry: false });
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const org = orgs.data?.find((o) => o.slug === (slug || orgs.data?.[0]?.slug));
  const chosen = email || org?.staff?.[0]?.email;
  const m = useMutation({
    mutationFn: () => api<{ token: string }>("/auth/dev-login", { body: { orgSlug: org?.slug, email: chosen } }),
    onSuccess: (r) => {
      login(r.token);
      nav("/");
    },
  });
  if (token) return <Navigate to="/" replace />;
  const points = [{ i: FlaskConical, k: "p1" }, { i: ShieldCheck, k: "p2" }, { i: Smartphone, k: "p3" }] as const;
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between" style={{ background: "linear-gradient(145deg,#3730A3 0%,#2B2680 55%,#0A4F7A 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute -end-24 -top-24 size-96 rounded-full bg-white/5" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -start-20 size-[28rem] rounded-full bg-white/5" />
        <div className="relative w-fit"><KiorexLogo variant="lockup" product="lab" tone="inverse" height={48} /></div>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-balance text-3xl font-semibold leading-tight">{t("ux.login.headline")}</h2>
          <ul className="space-y-4">
            {points.map((p) => <li key={p.k} className="flex items-start gap-3 text-sm text-white/90"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/12"><p.i aria-hidden className="size-4" /></span>{t(`ux.login.${p.k}`)}</li>)}
          </ul>
        </div>
        <div className="relative text-xs text-white/75"><Pulse size={16} loop /> <span className="ms-2"><KiorlyFootText text={t("ux.login.foot")} word={t("ux.login.footWord")} /></span></div>
      </aside>
      <main id="main" className="flex flex-col justify-center gap-6 px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="lg:hidden"><KiorlyBrand height={40} /></div>
            <div className="hidden lg:block" />
            <div className="flex items-center gap-2"><ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} /><Button variant="outline" size="sm" className="h-10" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{t("app.lang")}</Button></div>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("app.product")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.devNote")}</p>
          <Surface className="mt-6 space-y-5 p-5 shadow-[var(--kx-shadow-2)]">
            {orgs.isLoading ? <div role="status" aria-busy="true" className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : null}
            {orgs.isError ? <ErrorNote error={orgs.error} /> : null}
            {orgs.data?.length === 0 ? <p className="text-sm">{t("auth.noOrgs")}</p> : null}
            {org ? (
              <>
                <Field label={t("auth.org")}>
                  <Select value={org.slug ?? ""} onChange={(e) => { setSlug(e.target.value); setEmail(""); }}>{orgs.data!.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</Select>
                </Field>
                <div role="radiogroup" aria-label={t("auth.user")} className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground">{t("auth.user")}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {org.staff.map((s: any) => {
                      const on = s.email === chosen;
                      return (
                        <button key={s.email} type="button" role="radio" aria-checked={on} onClick={() => setEmail(s.email)} onDoubleClick={() => m.mutate()}
                          className={kcn("flex min-h-14 items-center gap-3 rounded-xl border px-3 py-2 text-start transition-[border-color,box-shadow,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "border-primary bg-accent shadow-[0_0_0_1px_hsl(var(--primary))]" : "border-border bg-card hover:bg-muted/60")}>
                          <span aria-hidden className={kcn("grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{on ? <Check className="size-4" /> : s.displayName.trim().slice(0, 1).toUpperCase()}</span>
                          <span className="min-w-0"><span dir="auto" className="block truncate text-sm font-medium">{s.displayName}</span><span className="block truncate text-xs text-muted-foreground">{t(`role.${s.role}`)}</span></span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button className="w-full" size="lg" onClick={() => m.mutate()} disabled={m.isPending}>{t("auth.login")}</Button>
                <ErrorNote error={m.error} />
              </>
            ) : null}
            <Link to="/onboarding" className="block text-center text-sm font-medium text-primary underline-offset-4 hover:underline">{t("auth.newLab")}</Link>
          </Surface>
        </div>
      </main>
    </div>
  );
}
