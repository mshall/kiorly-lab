import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "@/lib/api";
import { Button, Field, Input } from "@/components/ui";
import { UnifiedSignIn } from "@/components/unified-sign-in";

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-5 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
      <p className="text-center"><Link to="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">{t("auth.back")}</Link></p>
    </main>
  );
}
const errText = (lang: string, e: unknown) => e instanceof ApiError ? UnifiedSignIn.errorText(lang.startsWith("ar") ? "ar" : "en", e.code, (e.body?.message as string | undefined) ?? null) : null;

/** `/forgot-password`: asks for the e-mail; the answer is the same for every address. */
export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState(""); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(null); try { await api("/auth/password/forgot", { body: { email: email.trim() } }); setDone(true); } catch (x) { setErr(errText(i18n.language, x) ?? t("auth.resetFailed")); } };
  return (
    <Frame title={t("auth.forgotTitle")}>
      {done ? <p role="status" data-testid="forgot-done" className="text-sm text-muted-foreground">{t("auth.forgotDone")}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("auth.forgotLede")}</p>
          <Field label={t("auth.email")}><Input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err ? <p role="alert" className="text-sm text-destructive">{err}</p> : null}
          <Button type="submit" size="lg" className="w-full">{t("auth.forgotSend")}</Button>
        </form>
      )}
    </Frame>
  );
}

/** `/reset-password?token=`: chooses the new password with the single-use link from the e-mail. */
export function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const [sp] = useSearchParams(); const token = sp.get("token") ?? "";
  const [pw, setPw] = useState(""); const [done, setDone] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => { e.preventDefault(); setErr(null); try { await api("/auth/password/reset", { body: { token, newPassword: pw } }); setDone(true); } catch (x) { setErr((x instanceof ApiError && (x.body?.message as string | undefined)) || errText(i18n.language, x) || t("auth.resetFailed")); } };
  return (
    <Frame title={t("auth.resetTitle")}>
      {done ? <p role="status" data-testid="reset-done" className="text-sm text-muted-foreground">{t("auth.resetDone")}</p> : (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t("auth.newPassword")} hint={t("auth.passwordHint")}><Input type="password" required minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          {err ? <p role="alert" className="text-sm text-destructive">{err}</p> : null}
          <Button type="submit" size="lg" className="w-full" disabled={!token}>{t("auth.resetSave")}</Button>
        </form>
      )}
    </Frame>
  );
}
