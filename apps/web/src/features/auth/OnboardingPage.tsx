import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Field, Input, Select } from "@/components/ui";
import { ErrorNote } from "@/components/common";

/** Self-serve onboarding (dev/pilot). Disabled with 403 FEATURE_DISABLED when `lab.module` is OFF in Kiorex. */
export function OnboardingPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", slug: "", labName: "", labCode: "", ownerName: "", ownerEmail: "", edition: "PRO", loadStarterCatalogue: true });
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({ mutationFn: () => api<{ token: string }>("/onboarding/tenants", { body: f }), onSuccess: (r) => { login(r.token); nav("/"); } });
  return (
    <div className="mx-auto max-w-lg p-4">
      <h1 className="mb-1 text-xl font-bold">{t("onboarding.title")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("onboarding.sub")}</p>
      <Card className="grid gap-3 sm:grid-cols-2">
        <Field label={t("onboarding.company")} className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label={t("onboarding.slug")} hint={t("onboarding.slugHint")}><Input value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} /></Field>
        <Field label={t("onboarding.edition")}><Select value={f.edition} onChange={(e) => set("edition", e.target.value)}>{["LITE", "PRO", "CHAIN"].map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label={t("onboarding.labName")}><Input value={f.labName} onChange={(e) => set("labName", e.target.value)} /></Field>
        <Field label={t("onboarding.labCode")} hint={t("onboarding.labCodeHint")}><Input value={f.labCode} maxLength={6} onChange={(e) => set("labCode", e.target.value.toUpperCase())} /></Field>
        <Field label={t("onboarding.ownerName")}><Input value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></Field>
        <Field label={t("onboarding.ownerEmail")}><Input type="email" value={f.ownerEmail} onChange={(e) => set("ownerEmail", e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.loadStarterCatalogue} onChange={(e) => set("loadStarterCatalogue", e.target.checked)} />{t("onboarding.starter")}</label>
        <p className="text-xs text-muted-foreground sm:col-span-2">{t("onboarding.syntheticNote")}</p>
        <div className="sm:col-span-2"><ErrorNote error={m.error} /></div>
        <div className="flex gap-2 sm:col-span-2"><Button onClick={() => m.mutate()} disabled={m.isPending}>{t("onboarding.create")}</Button><Link to="/login" className="self-center text-sm text-primary underline">{t("auth.back")}</Link></div>
      </Card>
    </div>
  );
}
