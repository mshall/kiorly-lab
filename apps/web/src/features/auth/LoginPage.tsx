import { useState } from "react";
import { KiorlyBrand } from "@/brand/ui-kit";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setLang } from "@/lib/i18n";
import { Button, Card, Field, Select, Spinner } from "@/components/ui";
import { ErrorNote } from "@/components/common";

/** Dev sign-in (AUTH_MODE=dev). Production uses Kiorex Account OIDC (NH-LB-016); the app never stores passwords. */
export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { token, login } = useAuth();
  const nav = useNavigate();
  const orgs = useQuery({ queryKey: ["dev-orgs"], queryFn: () => api<any[]>("/auth/dev/orgs"), retry: false });
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const org = orgs.data?.find((o) => o.slug === (slug || orgs.data?.[0]?.slug));
  const m = useMutation({
    mutationFn: () => api<{ token: string }>("/auth/dev-login", { body: { orgSlug: org?.slug, email: email || org?.staff?.[0]?.email } }),
    onSuccess: (r) => {
      login(r.token);
      nav("/");
    },
  });
  if (token) return <Navigate to="/" replace />;
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-between">
        <div><KiorlyBrand height={44} /><h1 className="mt-2 text-lg font-semibold">{t("app.product")}</h1></div>
        <Button variant="outline" size="sm" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{t("app.lang")}</Button>
      </div>
      <Card className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("auth.devNote")}</p>
        {orgs.isLoading ? <Spinner /> : null}
        {orgs.isError ? <ErrorNote error={orgs.error} /> : null}
        {orgs.data?.length === 0 ? <p className="text-sm">{t("auth.noOrgs")}</p> : null}
        {org ? (
          <>
            <Field label={t("auth.org")}>
              <Select value={org.slug ?? ""} onChange={(e) => { setSlug(e.target.value); setEmail(""); }}>{orgs.data!.map((o) => <option key={o.slug} value={o.slug}>{o.name}</option>)}</Select>
            </Field>
            <Field label={t("auth.user")}>
              <Select value={email || org.staff[0]?.email} onChange={(e) => setEmail(e.target.value)}>{org.staff.map((s: any) => <option key={s.email} value={s.email}>{s.displayName} · {t(`role.${s.role}`)}</option>)}</Select>
            </Field>
            <Button className="w-full" onClick={() => m.mutate()} disabled={m.isPending}>{t("auth.login")}</Button>
            <ErrorNote error={m.error} />
          </>
        ) : null}
        <Link to="/onboarding" className="block text-center text-sm text-primary underline">{t("auth.newLab")}</Link>
      </Card>
    </div>
  );
}
