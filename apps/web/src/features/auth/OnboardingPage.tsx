import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setLang } from "@/lib/i18n";
import { Button, Field, Input } from "@/components/ui";
import { ErrorNote } from "@/components/common";
import { KiorlyBrand, ThemeToggle, Surface, kcn } from "@/brand/ui-kit";

const EDITIONS = ["LITE", "PRO", "CHAIN"] as const;

/** Self-serve onboarding (dev/pilot). Disabled with 403 FEATURE_DISABLED when `lab.module` is OFF in Kiorex. */
export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", slug: "", labName: "", labCode: "", ownerName: "", ownerEmail: "", edition: "PRO", loadStarterCatalogue: true });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const blur = (k: string) => setTouched((x) => ({ ...x, [k]: true }));
  const errors: Record<string, string | undefined> = {
    name: f.name.trim().length < 2 ? t("ux.onboarding.errRequired") : undefined,
    slug: !/^[a-z0-9][a-z0-9-]{2,}$/.test(f.slug) ? t("ux.onboarding.errSlug") : undefined,
    labName: f.labName.trim().length < 2 ? t("ux.onboarding.errRequired") : undefined,
    labCode: !/^[A-Z0-9]{2,6}$/.test(f.labCode) ? t("ux.onboarding.errCode") : undefined,
    ownerName: f.ownerName.trim().length < 2 ? t("ux.onboarding.errRequired") : undefined,
    ownerEmail: !/^\S+@\S+\.\S+$/.test(f.ownerEmail) ? t("ux.onboarding.errEmail") : undefined,
  };
  const valid = Object.values(errors).every((x) => !x);
  const show = (k: string) => (touched[k] ? errors[k] : undefined);
  const m = useMutation({ mutationFn: () => api<{ token: string }>("/onboarding/tenants", { body: f }), onSuccess: (r) => { login(r.token); nav("/"); } });
  const submit = () => { if (!valid) { setTouched(Object.fromEntries(Object.keys(errors).map((k) => [k, true]))); return; } m.mutate(); };
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <div className="mb-6 flex items-center justify-between gap-3">
        <KiorlyBrand height={40} />
        <div className="flex items-center gap-2"><ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} /><Button variant="outline" size="sm" className="h-10" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{t("app.lang")}</Button></div>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t("onboarding.sub")}</p>
      <form noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-5">
        <Surface className="p-5">
          <h2 className="mb-4 text-sm font-semibold">{t("ux.onboarding.company")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("onboarding.company")} className="sm:col-span-2" error={show("name")}><Input value={f.name} onChange={(e) => set("name", e.target.value)} onBlur={() => blur("name")} aria-invalid={!!show("name")} autoComplete="organization" /></Field>
            <Field label={t("onboarding.slug")} hint={t("onboarding.slugHint")} error={show("slug")}><Input value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} onBlur={() => blur("slug")} aria-invalid={!!show("slug")} dir="ltr" spellCheck={false} /></Field>
            <div>
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("onboarding.edition")}</span>
              <div role="radiogroup" aria-label={t("onboarding.edition")} className="grid grid-cols-3 gap-2">
                {EDITIONS.map((x) => <button key={x} type="button" role="radio" aria-checked={f.edition === x} onClick={() => set("edition", x)} className={kcn("h-10 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", f.edition === x ? "border-primary bg-accent text-accent-foreground shadow-[0_0_0_1px_hsl(var(--primary))]" : "border-border bg-card hover:bg-muted/60")}>{x}</button>)}
              </div>
            </div>
          </div>
        </Surface>
        <Surface className="p-5">
          <h2 className="mb-4 text-sm font-semibold">{t("ux.onboarding.lab")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("onboarding.labName")} error={show("labName")}><Input value={f.labName} onChange={(e) => set("labName", e.target.value)} onBlur={() => blur("labName")} aria-invalid={!!show("labName")} /></Field>
            <Field label={t("onboarding.labCode")} hint={t("onboarding.labCodeHint")} error={show("labCode")}><Input value={f.labCode} maxLength={6} onChange={(e) => set("labCode", e.target.value.toUpperCase())} onBlur={() => blur("labCode")} aria-invalid={!!show("labCode")} dir="ltr" className="font-mono tracking-widest" /></Field>
          </div>
        </Surface>
        <Surface className="p-5">
          <h2 className="mb-4 text-sm font-semibold">{t("ux.onboarding.owner")}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("onboarding.ownerName")} error={show("ownerName")}><Input value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} onBlur={() => blur("ownerName")} aria-invalid={!!show("ownerName")} autoComplete="name" /></Field>
            <Field label={t("onboarding.ownerEmail")} error={show("ownerEmail")}><Input type="email" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} onBlur={() => blur("ownerEmail")} aria-invalid={!!show("ownerEmail")} autoComplete="email" dir="ltr" /></Field>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.loadStarterCatalogue} onChange={(e) => set("loadStarterCatalogue", e.target.checked)} />{t("onboarding.starter")}</label>
        </Surface>
        <p className="text-xs text-muted-foreground">{t("onboarding.syntheticNote")}</p>
        <ErrorNote error={m.error} />
        <div className="flex flex-wrap items-center gap-4"><Button type="submit" size="lg" disabled={m.isPending}>{t("onboarding.create")}</Button><Link to="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{t("auth.back")}</Link></div>
      </form>
    </main>
  );
}
