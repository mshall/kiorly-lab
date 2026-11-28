import { useEffect, useMemo, useRef, useState } from "react";
import { KiorlyBrandLockup, KiorlyFootText, KxControlPair, LanguageToggle, Pulse, ThemeToggle } from "@/brand/ui-kit";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FlaskConical, ShieldCheck, Smartphone } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setLang } from "@/lib/i18n";
import { fetchAuthConfig, startPassportSignIn } from "@/lib/passport";
import { currentNavigationType, readHandoff, wantsPassportAutostart, withoutHandoff } from "@/lib/kiorly-home";
import { rememberSignInMethod } from "@/lib/sign-in-method";
import { currentOrgHint, rememberSignInOrg } from "@/lib/sign-in-default";
import { SwitchProductLink } from "@/components/switch-product-link";
import { UnifiedSignIn } from "@/components/unified-sign-in";
import { KiorexLogo } from "@/brand/components";
import { KxBrandBackdrop } from "@/brand/components/web/KxBrandBackdrop";

/** Dev sign-in (AUTH_MODE=dev). Production uses Kiorex Account OIDC (NH-LB-016); the app never stores passwords. */
export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { token, login } = useAuth();
  const nav = useNavigate();
  // The login page is pre-auth: the org is identified by `?org=`, a tenant subdomain or the org remembered on this browser; the API answers uniformly for unknown orgs.
  const orgHint = useMemo(() => currentOrgHint(), []);
  const cfg = useQuery({ queryKey: ["auth-config", orgHint], queryFn: () => fetchAuthConfig(orgHint), staleTime: 60_000 });
  const passport = cfg.data?.passport ?? null;
  const { search } = useLocation();
  // Kiorly Home sends `?sso=passport`: start "Sign in with Kiorex Passport" by itself (once per page load; the Passport SSO session makes it silent).
  const autostarted = useRef(false);
  // Kiorly Home password handoff: redeem the single-use code once, strip it from the address bar first, then adopt the normal session.
  const [handoff] = useState(() => readHandoff(window.location.search));
  const [handoffBusy, setHandoffBusy] = useState(!!handoff.code);
  const [handoffErr, setHandoffErr] = useState<string | null>(null);
  // G-24: the idle sign-out leaves a one-shot notice for this page
  const [idleNotice] = useState(() => { try { const v = sessionStorage.getItem("kiorly.sessionNotice"); if (v) sessionStorage.removeItem("kiorly.sessionNotice"); return v === "SESSION_IDLE"; } catch { return false; } });
  const redeemed = useRef(false);
  useEffect(() => {
    if (!handoff.code && !handoff.reason) return;
    window.history.replaceState(window.history.state, "", withoutHandoff(window.location.pathname, window.location.search, window.location.hash));
    if (!handoff.code || redeemed.current) return;
    redeemed.current = true;
    api<{ token: string }>("/auth/handoff/exchange", { body: { code: handoff.code } })
      .then((r) => { login(r.token); rememberSignInMethod("password"); nav("/", { replace: true }); })
      .catch(() => { setHandoffBusy(false); setHandoffErr(t("auth.handoffFailed")); });
  }, [handoff, login, nav, t]);
  useEffect(() => {
    if (token || handoff.code || !passport || autostarted.current || !wantsPassportAutostart(search, currentNavigationType())) return;
    autostarted.current = true; void startPassportSignIn(passport, i18n.language);
  }, [token, passport, search, i18n.language, handoff.code]);
  const localLogin = cfg.data?.localLogin ?? true;
  const [loginErr, setLoginErr] = useState<unknown>(null);
  const signInPassword = async (v: { email: string; password: string; orgSlug?: string }) => {
    setLoginErr(null);
    try {
      const r = await api<{ token: string }>("/auth/login", { body: { email: v.email, password: v.password, ...(v.orgSlug ? { orgSlug: v.orgSlug } : {}) } });
      login(r.token); rememberSignInMethod("password"); if (v.orgSlug) rememberSignInOrg(v.orgSlug);
      nav("/");
    } catch (x) { setLoginErr(x); throw x; }
  };
  if (token) return <Navigate to="/" replace />;
  const points = [{ i: FlaskConical, k: "p1" }, { i: ShieldCheck, k: "p2" }, { i: Smartphone, k: "p3" }] as const;
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside className="relative hidden overflow-hidden p-12 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-between" data-testid="login-brand-panel">
        <KxBrandBackdrop />
        <div className="relative w-fit"><KiorexLogo variant="lockup" product="lab" lang={i18n.language} tone="inverse" height={i18n.language === "ar" ? 72 : 48} /><p data-kx-tagline className="mt-1 text-xs text-white/70">{t("app.tagline")}</p></div>
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
            <div className="lg:hidden"><KiorlyBrandLockup height={40} /></div>
            <div className="hidden lg:block" />
            <KxControlPair><ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} /><LanguageToggle onChange={setLang} /></KxControlPair>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("app.product")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.passportNote")}</p>
          {handoffBusy ? <p role="status" data-testid="handoff-busy" className="mt-4 text-sm text-muted-foreground">{t("auth.handoffBusy")}</p> : null}
          {idleNotice ? <p role="status" data-testid="session-idle-notice" className="mt-4 text-sm text-muted-foreground">{t("errors.SESSION_IDLE")}</p> : null}
          {handoffErr ? <p role="alert" data-testid="handoff-error" className="mt-4 text-sm text-destructive">{handoffErr}</p> : null}
          {handoff.reason ? <p role="status" data-testid="handoff-reason" className="mt-4 rounded-lg border border-border bg-muted/50 p-3 text-sm">{t(`auth.handoffReason.${handoff.reason}`, { defaultValue: t("auth.handoffReason.other") })}</p> : null}
          <div className="mt-6">
            <UnifiedSignIn
              lang={i18n.language.startsWith("ar") ? "ar" : "en"}
              loading={cfg.isPending}
              passport={{ available: passport !== null, onStart: () => passport && void startPassportSignIn(passport, i18n.language) }}
              local={{ enabled: localLogin, showOrg: true, defaultOrg: orgHint && orgHint !== window.location.hostname.split(".")[0] ? orgHint : "", onSubmit: signInPassword, forgotHref: "/forgot-password" }}
              error={loginErr ? { code: loginErr instanceof ApiError ? loginErr.code : undefined, message: loginErr instanceof ApiError ? (loginErr.body?.message as string | undefined) : undefined } : null}
              footer={<Link to="/onboarding" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{t("auth.newLab")}</Link>}
            />
          </div>
          <div className="mt-6 text-center"><SwitchProductLink /></div>
        </div>
      </main>
    </div>
  );
}
