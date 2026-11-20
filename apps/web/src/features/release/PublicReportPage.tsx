import { useEffect, useState } from "react";
import { Download, FileText, Lock, ShieldCheck } from "lucide-react";
import { EmptyState, KiorlyBrand, Skeleton, Stepper, Surface, ThemeToggle } from "@/brand/ui-kit";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { setLang } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { Button, Input } from "@/components/ui";
import { ErrorNote } from "@/components/common";

async function pub<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? "ERROR", data);
  return data as T;
}

/** Patient secure link (KLCRIT02): OTP-gated download of the signed report. Shows no clinical data before verification. */
export function PublicReportPage() {
  const { token = "" } = useParams();
  const { t, i18n } = useTranslation();
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  useEffect(() => { if (wait <= 0) return; const id = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(id); }, [wait]);
  const info = useQuery({ queryKey: ["pub", token], queryFn: () => pub<any>(`/public/reports/${token}`), retry: false });
  const send = useMutation({ mutationFn: () => pub(`/public/reports/${token}/otp`, "POST"), onSuccess: () => { setSent(true); setWait(30); } });
  const verify = useMutation({
    mutationFn: () => pub<{ downloadToken: string }>(`/public/reports/${token}/verify`, "POST", { otp }),
    onSuccess: (r) => { window.location.href = `/api/v1/public/reports/${token}/download?t=${encodeURIComponent(r.downloadToken)}`; },
  });
  const step = !sent ? 0 : 1;
  const steps = [t("ux.public.stepSend"), t("ux.public.stepVerify"), t("ux.public.stepDownload")];
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <KiorlyBrand height={38} />
        <div className="flex items-center gap-2"><ThemeToggle labels={{ theme: t("theme.label"), light: t("theme.light"), dark: t("theme.dark"), system: t("theme.system") }} /><Button variant="outline" size="sm" className="h-10" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{t("app.lang")}</Button></div>
      </div>
      <Surface className="space-y-5 p-6 shadow-[var(--kx-shadow-3)]">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><FileText aria-hidden className="size-5" /></span><div><h1 className="text-lg font-semibold leading-tight">{t("public.title")}</h1>{info.data ? <p className="text-xs text-muted-foreground">{t("ux.public.secure")}</p> : null}</div></div>
        {info.isLoading ? <div role="status" aria-busy="true" className="space-y-3"><Skeleton className="h-4" /><Skeleton className="h-11" /></div> : info.isError ? <EmptyState tone="error" compact title={t("public.invalid")} /> : (
          <>
            <Stepper steps={steps} current={Math.min(step, 1)} className="[&_li]:flex-1 [&_li:last-child]:flex-none" />
            <p className="text-sm text-muted-foreground">{t("public.intro", { phone: info.data.maskedPhone ?? "" })}</p>
            {!sent ? <Button size="lg" className="w-full" onClick={() => send.mutate()} disabled={send.isPending}><ShieldCheck aria-hidden className="size-4" />{t("public.sendCode")}</Button> : (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (otp.length === 6) verify.mutate(); }}>
                <Input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} dir="ltr" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="••••••" aria-label={t("public.code")} className="h-14 text-center font-mono text-2xl tracking-[0.5em] tabular-nums" />
                <Button type="submit" size="lg" className="w-full" disabled={otp.length !== 6 || verify.isPending}><Download aria-hidden className="size-4" />{t("public.download")}</Button>
                <button type="button" disabled={wait > 0 || send.isPending} onClick={() => send.mutate()} className="block w-full text-center text-sm font-medium text-primary underline-offset-4 hover:underline disabled:text-muted-foreground disabled:no-underline">{wait > 0 ? t("ux.public.resendIn", { n: wait }) : t("ux.public.resend")}</button>
              </form>
            )}
            <ErrorNote error={send.error ?? verify.error} />
          </>
        )}
        <p className="flex items-start gap-2 border-t border-border/70 pt-4 text-xs text-muted-foreground"><Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />{t("public.privacy")}</p>
      </Surface>
    </main>
  );
}
