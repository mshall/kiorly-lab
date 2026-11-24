import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock, Lock, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Input, useToast } from "@/components/ui";
import { ErrorNote } from "@/components/common";
import { ApiError } from "@/lib/api";
import { EnrolmentCodeField } from "./EnrolmentCodeField";

type StepStatus = "done" | "action_needed" | "waiting_kiorex" | "blocked";
interface Step { key: string; status: StepStatus; optional?: boolean; link?: string; detail?: Record<string, unknown> }
interface Connect { legacy: boolean; status: string; progress: number; canRequest: boolean; enrolmentCodeRequired?: boolean; steps: Step[]; termsVersion: string; payoutLabel: string | null; terms: { at: string } | null; credentials?: { clientKey: string; clientSecret: string; webhookSecret: string } }
const ICON = { done: CheckCircle2, action_needed: AlertCircle, waiting_kiorex: Clock, blocked: Lock } as const;
const TONE = { done: "text-emerald-700 dark:text-emerald-400", action_needed: "text-amber-700 dark:text-amber-400", waiting_kiorex: "text-sky-700 dark:text-sky-400", blocked: "text-muted-foreground" } as const;
const KEY = ["kiorex-connect"];

/** Connect to Kiorex (ADR-040) for a standalone lab: checklist computed by the API from real state. Rotation secrets are shown once, from memory only. */
export function KiorexConnectPage() {
  const { t } = useTranslation(); const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: KEY, queryFn: () => api<Connect>("/kiorex-connect"), refetchInterval: (s) => (s.state.data?.status === "REQUESTED" ? 15000 : false) });
  const [code, setCode] = useState(""); const [label, setLabel] = useState(""); const [creds, setCreds] = useState<Connect["credentials"]>(); const file = useRef<HTMLInputElement>(null);
  const onData = (d: Connect, ok?: string) => { qc.setQueryData(KEY, d); if (d.credentials) setCreds(d.credentials); if (ok) toast(ok); };
  const mut = <V,>(fn: (v: V) => Promise<Connect>, ok?: string) => useMutation({ mutationFn: fn, onSuccess: (d) => onData(d, ok) }); // eslint-disable-line react-hooks/rules-of-hooks
  const terms = mut((v: string) => api<Connect>("/kiorex-connect/terms", { method: "PUT", body: { version: v } }));
  const payout = mut((v: string) => api<Connect>("/kiorex-connect/payout", { method: "PUT", body: { label: v } }), t("kiorexConnect.payout.saved"));
  const upload = mut((f: File) => f.arrayBuffer().then((b) => api<Connect>("/kiorex-connect/licence", { method: "POST", body: { name: f.name, contentBase64: btoa(String.fromCharCode(...new Uint8Array(b))) } })), t("kiorexConnect.licenceUpload.uploaded"));
  const request = mut((rotate: boolean) => api<Connect>("/kiorex-connect/request", { method: "POST", body: { rotate, ...(code.trim() ? { enrolmentCode: code.trim() } : {}) } }).then((r) => { setCode(""); return r; }), t("kiorexConnect.requested"));
  const rotate = mut(() => api<Connect>("/kiorex-connect/request", { method: "POST", body: { rotate: true } })); // no "request sent" toast: the secrets card says what happened
  const refresh = mut(() => api<Connect>("/kiorex-connect/refresh", { method: "POST" }));
  const d = q.data;
  return (
    <div className="space-y-4" data-testid="kiorex-connect">
      <div><h1 className="text-xl font-semibold">{t("kiorexConnect.title")}</h1><p className="text-sm text-muted-foreground">{t("kiorexConnect.subtitle")}</p></div>
      {request.error instanceof ApiError && /^(CONNECT_|KIOREX_|ENROLMENT_)/.test(request.error.code)
        ? <div role="alert" className="rounded-md bg-[hsl(var(--danger-text)/0.12)] px-3 py-2 text-sm text-[hsl(var(--danger-text))]" data-testid="connect-error">{t(`kiorexConnect.err.${request.error.code}`, { defaultValue: t("errors.generic", { code: request.error.code }) })}</div>
        : <ErrorNote error={q.error || terms.error || payout.error || upload.error || request.error} />}
      {d?.legacy ? <Card><p data-testid="connect-legacy">{t("kiorexConnect.legacy")}</p></Card> : null}
      {d && !d.legacy ? (
        <>
          <div role="progressbar" aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100} aria-label={t("kiorexConnect.progress")} data-testid="connect-progress">
            <div className="mb-1 flex justify-between text-sm"><span>{t("kiorexConnect.progress")} · <b data-testid="connect-status">{t(`kiorexConnect.status.${d.status}`)}</b></span><b>{d.progress}%</b></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${d.progress}%` }} /></div>
          </div>
          {["CHANGES_REQUESTED", "REJECTED", "PAUSED"].includes(d.status) ? <p role="status" className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm" data-testid="connect-decision">{t(`kiorexConnect.decision.${d.status}`)}</p> : null}
          <ol className="space-y-3" data-testid="connect-steps">
            {d.steps.map((s, i) => { const Icon = ICON[s.status]; const dt = s.detail ?? {}; return (
              <li key={s.key} data-testid={`connect-step-${s.key}`} data-status={s.status} className="rounded-2xl border bg-card p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${TONE[s.status]}`} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><b>{i + 1}. {t(`kiorexConnect.step.${s.key}.title`)}</b>{s.optional ? <span className="rounded-full border px-2 text-xs text-muted-foreground">{t("kiorexConnect.optional")}</span> : null}<span className={`text-xs font-medium ${TONE[s.status]}`}>{t(`kiorexConnect.state.${s.status}`)}</span></div>
                    <p className="text-sm text-muted-foreground">{t(`kiorexConnect.step.${s.key}.hint`)}</p>
                    {s.key === "lab_site" ? <p className="text-xs text-muted-foreground">{t("kiorexConnect.detail.labs", dt)}</p> : null}
                    {s.key === "catalogue" ? <p className="text-xs text-muted-foreground">{t("kiorexConnect.detail.tests", dt)}</p> : null}
                    {s.key === "price_list" ? <p className="text-xs text-muted-foreground">{t("kiorexConnect.detail.priced", dt)}</p> : null}
                    {s.key === "hours_collection" && Number(dt.missing) > 0 ? <p className="text-xs">{t("kiorexConnect.detail.missing", dt)}</p> : null}
                  </div>
                  {s.link && s.status === "action_needed" && !["payout", "terms", "request", "licence"].includes(s.key) ? <Link className="rounded-md border px-3 py-1.5 text-sm" to={s.link}>{t("kiorexConnect.fix")}</Link> : null}
                  {s.key === "request" && (s.status === "action_needed" || s.status === "waiting_kiorex") ? <Button disabled={!d.canRequest || request.isPending || (!!d.enrolmentCodeRequired && !code.trim())} onClick={() => request.mutate(false)} data-testid="connect-request">{t("kiorexConnect.request")}</Button> : null}
                </div>
                {s.key === "request" && d.enrolmentCodeRequired && d.canRequest ? <EnrolmentCodeField value={code} onChange={setCode} /> : null}
                {s.key === "licence" && s.status !== "done" ? <div className="mt-3 flex flex-wrap gap-2"><input ref={file} type="file" accept=".pdf,.png,.jpg,.jpeg" className="sr-only" aria-label={t("kiorexConnect.licenceUpload.choose")} data-testid="connect-licence-input" onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])} /><Button variant="outline" onClick={() => file.current?.click()}>{t("kiorexConnect.licenceUpload.choose")}</Button><Link className="rounded-md border px-3 py-1.5 text-sm" to="/settings">{t("kiorexConnect.licenceUpload.settings")}</Link></div> : null}
                {s.key === "payout" ? <div className="mt-3 flex flex-wrap gap-2"><Input aria-label={t("kiorexConnect.payout.label")} placeholder={t("kiorexConnect.payout.label")} className="max-w-md" value={label || d.payoutLabel || ""} onChange={(e) => setLabel(e.target.value)} data-testid="connect-payout" /><Button variant="outline" disabled={!label.trim() || payout.isPending} onClick={() => payout.mutate(label)}>{t("kiorexConnect.payout.save")}</Button></div> : null}
                {s.key === "terms" ? (d.terms ? <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400" data-testid="connect-terms-done">{t("kiorexConnect.terms.accepted")}</p> : <div className="mt-3"><p className="mb-2 text-sm">{t("kiorexConnect.terms.body", { version: d.termsVersion })}</p><Button variant="outline" disabled={terms.isPending} onClick={() => terms.mutate(d.termsVersion)} data-testid="connect-accept">{t("kiorexConnect.terms.accept")}</Button></div>) : null}
              </li>); })}
          </ol>
          {d.status === "APPROVED" ? <Card><h3 className="mb-1 font-semibold">{t("kiorexConnect.passport.title")}</h3><p className="mb-2 text-sm">{t("kiorexConnect.passport.body")}</p><div className="flex flex-wrap gap-2"><Link className="rounded-md border px-3 py-1.5 text-sm" to="/settings">{t("kiorexConnect.passport.set")}</Link><Link className="rounded-md border px-3 py-1.5 text-sm" to="/settings">{t("kiorexConnect.passport.invite")}</Link><Button variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate()} data-testid="connect-rotate">{t("kiorexConnect.rotate")}</Button></div></Card> : null}
          {creds ? <Card><h3 className="mb-2 font-semibold">{t("kiorexConnect.rotated")}</h3><dl className="space-y-1 text-sm" dir="ltr" data-testid="connect-secrets"><dt>{t("kiorexConnect.clientKey")}</dt><dd><code>{creds.clientKey}</code></dd><dt>{t("kiorexConnect.clientSecret")}</dt><dd><code>{creds.clientSecret}</code></dd><dt>{t("kiorexConnect.webhookSecret")}</dt><dd><code>{creds.webhookSecret}</code></dd></dl><p className="mt-2 text-xs text-muted-foreground">{t("kiorexConnect.secretsOnce")}</p><Button className="mt-2" variant="outline" onClick={() => setCreds(undefined)}>{t("kiorexConnect.dismiss")}</Button></Card> : null}
          {["REQUESTED", "CHANGES_REQUESTED", "REJECTED", "PAUSED"].includes(d.status) ? <Button variant="ghost" onClick={() => refresh.mutate()} disabled={refresh.isPending}><RefreshCw aria-hidden="true" className="h-4 w-4" />{t("kiorexConnect.refresh")}</Button> : null}
        </>
      ) : null}
    </div>
  );
}
