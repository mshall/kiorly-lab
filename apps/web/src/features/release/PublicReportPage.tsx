import { useState } from "react";
import { KiorlyBrand } from "@/brand/ui-kit";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { setLang } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { Button, Card, Input, Spinner } from "@/components/ui";
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
  const info = useQuery({ queryKey: ["pub", token], queryFn: () => pub<any>(`/public/reports/${token}`), retry: false });
  const send = useMutation({ mutationFn: () => pub(`/public/reports/${token}/otp`, "POST"), onSuccess: () => setSent(true) });
  const verify = useMutation({
    mutationFn: () => pub<{ downloadToken: string }>(`/public/reports/${token}/verify`, "POST", { otp }),
    onSuccess: (r) => { window.location.href = `/api/v1/public/reports/${token}/download?t=${encodeURIComponent(r.downloadToken)}`; },
  });
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-4">
      <div className="flex items-center justify-between"><div className="flex items-center gap-3"><KiorlyBrand height={34} /><h1 className="text-lg font-bold">{t("public.title")}</h1></div><Button variant="outline" size="sm" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{t("app.lang")}</Button></div>
      <Card className="space-y-4">
        {info.isLoading ? <Spinner /> : info.isError ? <p>{t("public.invalid")}</p> : (
          <>
            <p className="text-sm">{t("public.intro", { phone: info.data.maskedPhone ?? "" })}</p>
            {!sent ? <Button onClick={() => send.mutate()} disabled={send.isPending}>{t("public.sendCode")}</Button> : (
              <div className="space-y-2">
                <Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="••••••" aria-label={t("public.code")} />
                <Button onClick={() => verify.mutate()} disabled={otp.length !== 6 || verify.isPending}>{t("public.download")}</Button>
              </div>
            )}
            <ErrorNote error={send.error ?? verify.error} />
          </>
        )}
        <p className="text-xs text-muted-foreground">{t("public.privacy")}</p>
      </Card>
    </div>
  );
}
