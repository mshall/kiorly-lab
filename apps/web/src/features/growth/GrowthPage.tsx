import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Copy, Link2, Pause, Play, Plus, Printer, QrCode, ShieldOff } from "lucide-react";
import { api, ApiError, blobUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Modal, Select, Spinner, Table, Td, useToast, type Tone } from "@/components/ui";
import { ErrorNote, PageHeader } from "@/components/common";

const fmtNum = (n: number | string): string => new Intl.NumberFormat(document.documentElement.lang === "ar" ? "ar-EG" : "en").format(Number(n));
const buttonClass = (o: { variant?: "default" | "outline" } = {}) => `inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 ${o.variant === "outline" ? "border border-input bg-card hover:bg-accent" : "bg-primary text-primary-foreground hover:bg-(--kx-primary-hover)"}`;
import "./growth-strings";

/** Growth & links (GRW-P4-B1): links, QR codes and printable reception cards, counts of visits and bookings, suggestions. Counts only: no patient data and no money. */
interface LinkRow { id: string; code: string; label: string; ownerScope: "ORG" | "BRANCH" | "DESK"; channelKind: string; status: "ACTIVE" | "PAUSED" | "REVOKED"; labId: string | null; labName: string | null; shortUrl: string; last30: { visits: number; orders: number; completed: number } }
interface Access { level: "admin" | "read" | "none"; connected: boolean; siteScoped: boolean; can: { view: boolean; create: boolean; update: boolean; revoke: boolean }; plan: { key: string; maxActiveLinks: number; linksUsed: number } }
interface Perf { days: number; links: { visits: number; orders: number; completed: number }; marketplaceOriginated: { orders: number }; acquisitionPending: boolean; statement: { configured: boolean } }
interface Rec { id: string; severity: string; params: Record<string, number>; action: string }
const STATUS_TONE: Record<string, Tone> = { ACTIVE: "ok", PAUSED: "warn", REVOKED: "muted" };
const CHANNELS = ["WEB_LINK", "QR_POSTER", "QR_DESK", "SOCIAL", "SMS", "WHATSAPP_SHARE", "EMAIL_SIG", "GOOGLE_PROFILE"] as const;

function useErr() {
  const { t } = useTranslation();
  return (e: unknown): string => { const code = e instanceof ApiError ? e.code : ""; const k = `growth.e.${code}`; const m = t(k); return m === k ? t("growth.e.generic") : m; };
}

export function GrowthPage() {
  const { t } = useTranslation(); const { me, can: hasPerm } = useAuth(); const qc = useQueryClient(); const toast = useToast(); const err = useErr();
  const access = useQuery({ queryKey: ["growth", "access"], queryFn: () => api<Access>("/growth/access"), retry: false });
  const on = access.data?.connected === true;
  const links = useQuery({ queryKey: ["growth", "links"], queryFn: () => api<{ items: LinkRow[] }>("/growth/links"), enabled: on });
  const perf = useQuery({ queryKey: ["growth", "perf"], queryFn: () => api<Perf>("/growth/performance"), enabled: on });
  const recs = useQuery({ queryKey: ["growth", "recs"], queryFn: () => api<{ items: Rec[] }>("/growth/recommendations"), enabled: on });
  const [create, setCreate] = useState(false); const [qr, setQr] = useState<LinkRow | null>(null); const [revoke, setRevoke] = useState<LinkRow | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["growth"] }); };
  const patch = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/growth/links/${v.id}`, { method: "PATCH", body: { status: v.status } }), onSuccess: () => { setRevoke(null); refresh(); }, onError: (e) => toast(err(e), "crit") });
  const can = access.data?.can;

  if (access.isLoading) return <div className="grid place-items-center py-16"><Spinner /></div>;
  if (access.error) return <><PageHeader title={t("growth.title")} /><ErrorNote error={access.error} /></>;
  if (!on) return (
    <div data-testid="growth-page">
      <PageHeader title={t("growth.title")} sub={t("growth.subtitle")} />
      <Card><div data-testid="growth-not-connected" className="flex flex-col items-start gap-3"><h2 className="text-base font-semibold">{t("growth.notConnected")}</h2><p className="max-w-prose text-sm text-muted-foreground">{t("growth.notConnectedBody")}</p>
        {hasPerm("settings.manage") && <Link to="/kiorex-connect" className={buttonClass()}><Link2 aria-hidden className="size-4" />{t("growth.connectCta")}</Link>}</div></Card>
    </div>);

  const items = links.data?.items ?? []; const p = perf.data;
  const stat = (id: string, label: string, v: number | undefined) => <div className="rounded-xl border border-border/80 bg-card p-4 shadow-kx-1" data-testid={`growth-stat-${id}`}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{v === undefined ? "—" : fmtNum(v)}</div></div>;
  return (
    <div data-testid="growth-page">
      <PageHeader title={t("growth.title")} sub={t("growth.subtitle")} actions={can?.create ? <Button data-testid="growth-create" onClick={() => setCreate(true)}><Plus aria-hidden className="size-4" />{t("growth.create")}</Button> : undefined} />
      <section aria-labelledby="g-stats" className="mb-4"><h2 id="g-stats" className="mb-2 text-sm font-semibold text-muted-foreground">{t("growth.period")}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="growth-summary">{stat("visits", t("growth.statVisits"), p?.links.visits)}{stat("orders", t("growth.statOrders"), p?.links.orders)}{stat("completed", t("growth.statCompleted"), p?.links.completed)}{stat("market", t("growth.statMarket"), p?.marketplaceOriginated.orders)}</div>
        {p?.acquisitionPending && <p className="mt-2 text-xs text-muted-foreground" data-testid="growth-pending">{t("growth.pending")}</p>}</section>
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between gap-2"><CardTitle className="mb-0">{t("growth.linksTitle")}</CardTitle>{access.data ? <span className="text-xs text-muted-foreground" data-testid="growth-plan">{t("growth.planUsage", { used: fmtNum(access.data.plan.linksUsed), max: fmtNum(access.data.plan.maxActiveLinks) })}</span> : null}</div>
        <ErrorNote error={links.error} />
        {links.isLoading ? <Spinner /> : !items.length ? <Empty>{t("growth.linksEmpty")}</Empty> : (
          <Table head={[t("growth.colLabel"), t("growth.colScope"), t("growth.colChannel"), t("growth.colStatus"), t("growth.colVisits"), t("growth.colOrders"), t("growth.colCompleted"), t("growth.colActions")]}>
            {items.map((l) => (
              <tr key={l.id} data-testid="growth-link-row" data-status={l.status}>
                <Td><div className="font-medium" dir="auto">{l.label}</div><div className="text-xs text-muted-foreground" dir="ltr">{l.code}</div></Td>
                <Td>{t(`growth.scope.${l.ownerScope}`)}{l.labName ? <div className="text-xs text-muted-foreground" dir="auto">{l.labName}</div> : null}</Td>
                <Td>{t(`growth.channel.${l.channelKind}`)}</Td>
                <Td><Badge tone={STATUS_TONE[l.status]}>{t(`growth.status.${l.status}`)}</Badge></Td>
                <Td className="text-end tabular-nums">{fmtNum(l.last30.visits)}</Td><Td className="text-end tabular-nums">{fmtNum(l.last30.orders)}</Td><Td className="text-end tabular-nums">{fmtNum(l.last30.completed)}</Td>
                <Td><RowActions l={l} can={can} onQr={() => setQr(l)} onPatch={(status) => patch.mutate({ id: l.id, status })} onRevoke={() => setRevoke(l)} /></Td>
              </tr>))}
          </Table>)}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardTitle>{t("growth.recsTitle")}</CardTitle><ul className="space-y-2" data-testid="growth-recs">{(recs.data?.items ?? []).map((r) => <li key={r.id} data-rec={r.id} className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm"><Badge tone={r.severity === "high" ? "crit" : r.severity === "medium" ? "warn" : "muted"}>{t(`growth.sev.${r.severity}`, { defaultValue: r.severity })}</Badge><span>{t(`growth.rec.${r.id}`, r.params)}</span></li>)}{recs.data && !recs.data.items.length && <li className="text-sm text-muted-foreground">{t("growth.recsNone")}</li>}</ul><p className="mt-3 text-xs text-muted-foreground">{t("growth.recGuardrail")}</p></Card>
        <Card><CardTitle>{t("growth.statementTitle")}</CardTitle><p className="text-sm text-muted-foreground" data-testid="growth-statement">{t("growth.statementNone")}</p></Card>
      </div>
      {create && <CreateModal sites={me?.labs ?? []} onClose={() => setCreate(false)} onDone={() => { setCreate(false); refresh(); }} />}
      {qr && <QrModal link={qr} onClose={() => setQr(null)} />}
      <Modal open={!!revoke} onClose={() => setRevoke(null)} title={t("growth.revokeTitle")}>
        <p className="text-sm text-muted-foreground">{t("growth.revokeBody")}</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setRevoke(null)}>{t("growth.cancel")}</Button><Button variant="destructive" data-testid="growth-revoke-confirm" disabled={patch.isPending} onClick={() => revoke && patch.mutate({ id: revoke.id, status: "REVOKED" })}>{t("growth.confirmRevoke")}</Button></div>
      </Modal>
    </div>);
}

function RowActions({ l, can, onQr, onPatch, onRevoke }: { l: LinkRow; can?: Access["can"]; onQr: () => void; onPatch: (s: string) => void; onRevoke: () => void }) {
  const { t } = useTranslation(); const toast = useToast();
  const revoked = l.status === "REVOKED";
  const copy = async () => { try { await navigator.clipboard.writeText(l.shortUrl); toast(t("growth.copied")); } catch { toast(l.shortUrl); } };
  const print = async (lang: "ar" | "en") => { window.open(await blobUrl(`/growth/links/${l.id}/poster?lang=${lang}&size=A4`), "_blank", "noopener"); };
  const sm = "min-h-11 min-w-11 h-auto";
  return (
    <div className="flex flex-wrap gap-1">
      {!revoked && <Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.qr")}: ${l.label}`} title={t("growth.qr")} data-testid="growth-qr" onClick={onQr}><QrCode aria-hidden className="size-4" /></Button>}
      <Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.copy")}: ${l.label}`} title={t("growth.copy")} data-testid="growth-copy" onClick={() => void copy()}><Copy aria-hidden className="size-4" /></Button>
      {!revoked && <><Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.printAr")}: ${l.label}`} title={t("growth.printAr")} data-testid="growth-print-ar" onClick={() => void print("ar")}><Printer aria-hidden className="size-4" />ع</Button>
        <Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.printEn")}: ${l.label}`} title={t("growth.printEn")} data-testid="growth-print-en" onClick={() => void print("en")}><Printer aria-hidden className="size-4" />EN</Button></>}
      {can?.update && l.status === "ACTIVE" && <Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.pause")}: ${l.label}`} title={t("growth.pause")} data-testid="growth-pause" onClick={() => onPatch("PAUSED")}><Pause aria-hidden className="size-4" /></Button>}
      {can?.update && l.status === "PAUSED" && <Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.resume")}: ${l.label}`} title={t("growth.resume")} data-testid="growth-resume" onClick={() => onPatch("ACTIVE")}><Play aria-hidden className="size-4" /></Button>}
      {can?.revoke && !revoked && <Button size="sm" variant="outline" className={sm} aria-label={`${t("growth.revoke")}: ${l.label}`} title={t("growth.revoke")} data-testid="growth-revoke" onClick={onRevoke}><ShieldOff aria-hidden className="size-4" /></Button>}
    </div>);
}

function QrModal({ link, onClose }: { link: LinkRow; onClose: () => void }) {
  const { t } = useTranslation(); const [src, setSrc] = useState<string | null>(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let url: string | null = null; let live = true; blobUrl(`/growth/links/${link.id}/qr.svg`).then((u) => { if (!live) { URL.revokeObjectURL(u); return; } url = u; setSrc(u); }).catch(() => live && setFailed(true)); return () => { live = false; if (url) URL.revokeObjectURL(url); }; }, [link.id]);
  return (
    <Modal open onClose={onClose} title={t("growth.qrTitle", { label: link.label })}>
      <div className="flex flex-col items-center gap-3">
        {src ? <img src={src} alt={t("growth.qrAlt")} width={256} height={256} className="rounded-lg bg-white p-1" data-testid="growth-qr-img" /> : failed ? <p role="alert" className="text-sm">{t("growth.e.generic")}</p> : <Spinner />}
        <p className="text-center text-xs text-muted-foreground" dir="ltr">{link.shortUrl}</p><p className="text-center text-sm text-muted-foreground">{t("growth.qrHint")}</p>
        <Button variant="outline" onClick={onClose}>{t("growth.close")}</Button>
      </div>
    </Modal>);
}

function CreateModal({ sites, onClose, onDone }: { sites: Array<{ id: string; name: string }>; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation(); const toast = useToast(); const err = useErr();
  const [f, setF] = useState({ label: "", ownerScope: "ORG", labId: sites[0]?.id ?? "", channelKind: "WEB_LINK" });
  const needsSite = f.ownerScope !== "ORG";
  const m = useMutation({ mutationFn: () => api("/growth/links", { method: "POST", body: { label: f.label, ownerScope: f.ownerScope, channelKind: f.ownerScope === "DESK" && f.channelKind === "WEB_LINK" ? "QR_DESK" : f.channelKind, ...(needsSite ? { labId: f.labId } : {}) } }), onSuccess: onDone, onError: (e) => toast(err(e), "crit") });
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open onClose={onClose} title={t("growth.formTitle")}>
      <form className="space-y-3" data-testid="growth-form" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <Field label={t("growth.fLabel")} hint={t("growth.fLabelHint")}><Input required minLength={2} maxLength={80} value={f.label} onChange={set("label")} data-testid="growth-f-label" /></Field>
        <Field label={t("growth.fScope")}><Select value={f.ownerScope} onChange={set("ownerScope")} data-testid="growth-f-scope">{(["ORG", "BRANCH", "DESK"] as const).map((s) => <option key={s} value={s}>{t(`growth.scope.${s}`)}</option>)}</Select></Field>
        {needsSite && <Field label={t("growth.fSite")}><Select value={f.labId} onChange={set("labId")} data-testid="growth-f-site">{sites.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>}
        <Field label={t("growth.fChannel")}><Select value={f.channelKind} onChange={set("channelKind")} data-testid="growth-f-channel">{CHANNELS.map((c) => <option key={c} value={c}>{t(`growth.channel.${c}`)}</option>)}</Select></Field>
        <div className="flex justify-end gap-2 pt-2"><Button variant="outline" onClick={onClose}>{t("growth.cancel")}</Button><Button type="submit" data-testid="growth-f-submit" disabled={m.isPending || f.label.trim().length < 2}>{t("growth.submit")}</Button></div>
      </form>
    </Modal>);
}
