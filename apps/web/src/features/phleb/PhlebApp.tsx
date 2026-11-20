import { useCallback, useEffect, useRef, useState } from "react";
import { KiorlyMark } from "@/brand/ui-kit";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, CheckCircle2, CloudOff, LogOut, Siren, MapPin, Phone, RefreshCw, ScanBarcode, ShieldAlert } from "lucide-react";
import { api, getToken, newKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setLang } from "@/lib/i18n";
import { type QueuedCall, clearFailed, enqueue, flushQueue, listQueue } from "@/lib/offline";
import { today } from "@/lib/format";
import { Badge, Button, Card, Empty, Input, Modal, Select, Spinner } from "@/components/ui";
import { StatusBadge } from "@/components/common";

const CACHE = "kiorly.phleb.route";
/** Same reasons as the API (category only, no free text: BR61). */
const UNSAFE_REASONS = ["THREAT_OR_AGGRESSION", "UNSAFE_ENVIRONMENT", "ANIMAL", "OTHER"] as const;
/** HVSAF01: the server prompts 30 min after the planned end; the app shows the same prompt so the collector can answer in one tap. */
const PROMPT_AFTER_MS = 30 * 60_000;
const IN_FIELD = ["EN_ROUTE", "ARRIVED"];

/** Current position (check-in geostamp / SOS). The server coarsens check-in stamps to ~1 km before storing them. */
function locate(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 });
  });
}

/** Resizes a captured label photo to <= 1280px JPEG (keeps uploads small on mobile data). */
async function toJpegBase64(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8).split(",")[1];
}

async function sendQueued(c: QueuedCall) {
  const tok = getToken();
  const res = await fetch(`/api/v1${c.path}`, { method: c.method, headers: { "content-type": "application/json", "idempotency-key": c.idempotencyKey, ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(c.body) });
  let error: string | undefined;
  if (!res.ok) error = (await res.json().catch(() => null))?.code;
  return { ok: res.ok, status: res.status, error };
}

/**
 * Phlebotomist mobile-first PWA: today's route, collection (identity -> scan -> label photo -> confirm) with an IndexedDB offline queue.
 * Every write is queued with an Idempotency-Key and replayed when the connection returns; the route is cached for offline use.
 */
export function PhlebApp() {
  const { t, i18n } = useTranslation();
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [date, setDate] = useState(today());
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedCall[]>([]);
  const [stop, setStop] = useState<any>(null);
  const [scans, setScans] = useState<string[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [photo, setPhoto] = useState<string | null>(null);
  const [fail, setFail] = useState("");
  const [msg, setMsg] = useState("");
  const [unsafe, setUnsafe] = useState<any>(null);
  const [reason, setReason] = useState<string>(UNSAFE_REASONS[0]);
  const [safetyMsg, setSafetyMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const fileRef = useRef<HTMLInputElement>(null);

  const route = useQuery({
    queryKey: ["my-route", date],
    queryFn: async () => {
      try {
        const r = await api<any[]>(`/home-collections/my-route?date=${date}`);
        try { localStorage.setItem(`${CACHE}.${date}`, JSON.stringify(r)); } catch { /* quota */ }
        return r;
      } catch (e) {
        const cached = (() => { try { return JSON.parse(localStorage.getItem(`${CACHE}.${date}`) ?? "null"); } catch { return null; } })();
        if (cached) return cached as any[];
        throw e;
      }
    },
    refetchInterval: 60_000,
  });

  const refreshQueue = useCallback(async () => setQueue(await listQueue()), []);
  const flush = useCallback(async () => {
    if (!navigator.onLine) return;
    const r = await flushQueue(sendQueued);
    await refreshQueue();
    if (r.sent) { setMsg(t("phleb.synced", { n: r.sent })); void route.refetch(); }
  }, [refreshQueue, route, t]);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    void refreshQueue();
    const on = () => { setOnline(true); void flush(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const i = setInterval(() => void flush(), 15_000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); clearInterval(i); };
  }, [flush, refreshQueue]);

  const queueCall = async (path: string, body: unknown) => {
    await enqueue({ id: newKey(), method: "POST", path, body, idempotencyKey: newKey() });
    await refreshQueue();
    void flush();
  };
  const pending = queue.filter((q) => q.status === "pending").length;
  const failed = queue.filter((q) => q.status === "failed");
  const open = (s: any) => { setStop(s); setScans([]); setIds([]); setPhoto(null); setFail(""); };
  const specimens: any[] = stop?.order.specimens.filter((s: any) => s.status === "PENDING_COLLECTION") ?? [];
  const allScanned = specimens.length > 0 && specimens.every((s) => scans.includes(s.barcode));
  const addScan = (v: string) => { const x = v.trim(); if (x && !scans.includes(x)) setScans((s) => [...s, x]); };
  const confirm = async () => {
    if (photo) await queueCall(`/home-collections/${stop.id}/label-photo`, { imageBase64: photo, contentType: "image/jpeg" });
    await queueCall(`/home-collections/${stop.id}/confirm`, { scannedBarcodes: scans, ...(ids.length >= 2 ? { identifiersChecked: ids } : {}) });
    setStop(null);
    qc.setQueryData(["my-route", date], (old: any[] | undefined) => old?.map((h) => (h.id === stop.id ? { ...h, status: "COLLECTED" } : h)));
  };
  // ---- safety (HVSAF01/02, BR61): real-time calls, never queued; never behind a flag
  const act = async (fn: () => Promise<unknown>, okText: string) => {
    try { await fn(); setSafetyMsg({ tone: "ok", text: okText }); void route.refetch(); } catch (e: any) { setSafetyMsg({ tone: "bad", text: t(`errors.${e?.code}`, { defaultValue: t("errors.generic", { code: e?.code ?? "UNKNOWN" }) }) }); }
  };
  const imOk = (h: any) => act(() => api(`/home-collections/${h.id}/safety/answer`, { method: "POST", body: {} }), t("phleb.imOk"));
  const sos = async (h: any) => {
    if (!window.confirm(t("phleb.sosConfirm"))) return;
    const g = await locate();
    try {
      const r = await api<any>(`/home-collections/${h.id}/sos`, { body: g ?? { lat: 0, lng: 0 } });
      setSafetyMsg({ tone: r.delivered ? "ok" : "bad", text: r.delivered ? t("phleb.sosSent") : t("phleb.sosNotSent") });
    } catch { setSafetyMsg({ tone: "bad", text: t("phleb.sosNotSent") }); }
  };
  const leaveUnsafe = async () => {
    const g = await locate();
    await act(() => api(`/home-collections/${unsafe.id}/leave-unsafe`, { body: { reason, ...(g ? { geostamp: g } : {}) } }), t("status.ABORTED_UNSAFE"));
    setUnsafe(null);
  };
  const depart = async (h: any) => {
    const g = await locate();
    await queueCall(`/home-collections/${h.id}/start`, g ? { geostamp: g } : {});
  };
  const arrive = async (h: any) => {
    setMsg(t("phleb.locating"));
    const g = await locate();
    if (!g) { setMsg(t("phleb.needLocation")); return; }
    setMsg("");
    await queueCall(`/home-collections/${h.id}/arrive`, { geostamp: g });
  };
  // optional camera scanning where the browser supports BarcodeDetector
  const scanWithCamera = async () => {
    const BD = (window as any).BarcodeDetector;
    if (!BD) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      const det = new BD({ formats: ["code_128"] });
      const end = Date.now() + 15_000;
      while (Date.now() < end) {
        const codes = await det.detect(video);
        if (codes[0]) { addScan(codes[0].rawValue); break; }
        await new Promise((r) => setTimeout(r, 250));
      }
      stream.getTracks().forEach((tr) => tr.stop());
    } catch { /* permission denied or unsupported */ }
  };
  const idKinds = stop ? ["dateOfBirth", "phone"].filter((k) => (k === "phone" ? stop.order.patient.phone : true)) : [];

  return (
    <div className="mx-auto min-h-screen max-w-md bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <KiorlyMark size={30} />
          <div className="flex-1 leading-tight"><div className="text-sm font-bold">{t("phleb.title")}</div><div className="text-xs text-muted-foreground">{me?.user.displayName}</div></div>
          <Badge tone={online ? "ok" : "warn"}>{online ? t("phleb.online") : <><CloudOff className="me-1 h-3 w-3" />{t("phleb.offline")}</>}</Badge>
          <Button variant="outline" size="sm" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{t("app.lang")}</Button>
        </div>
        {route.data?.length ? <div className="mt-2" aria-hidden="true"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${Math.round((route.data.filter((h: any) => h.status === "COLLECTED").length / route.data.length) * 100)}%` }} /></div></div> : null}
        <div className="mt-2 flex items-center gap-2"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={t("common.date")} />{can("orders.read") ? <Link to="/" className="shrink-0 whitespace-nowrap text-xs font-medium text-primary underline">{t("phleb.console")}</Link> : null}</div>
      </header>
      {pending > 0 || failed.length > 0 ? (
        <div className="m-3 rounded-lg bg-[hsl(var(--warning)/0.12)] p-3 text-sm text-[hsl(var(--warning))]" role="status">
          <div className="flex items-center justify-between"><span>{t("phleb.queue", { n: pending })}</span><Button size="sm" variant="outline" onClick={() => void flush()}><RefreshCw className="h-3 w-3" />{t("phleb.syncNow")}</Button></div>
          {failed.map((f) => <div key={f.id} className="mt-1 text-xs text-[hsl(var(--danger-text))]">{f.path.split("/").pop()}: {f.error}</div>)}
          {failed.length ? <Button size="sm" variant="ghost" onClick={async () => { await clearFailed(); await refreshQueue(); }}>{t("phleb.dismiss")}</Button> : null}
        </div>
      ) : null}
      {msg ? <p className="m-3 rounded-md bg-[hsl(var(--success)/0.12)] p-2 text-sm text-[hsl(var(--success))]">{msg}</p> : null}
      {safetyMsg ? <p className={safetyMsg.tone === "ok" ? "m-3 rounded-md bg-[hsl(var(--success)/0.12)] p-2 text-sm text-[hsl(var(--success))]" : "m-3 rounded-md bg-[hsl(var(--danger-text)/0.12)] p-2 text-sm text-[hsl(var(--danger-text))]"} role="status">{safetyMsg.text}</p> : null}
      <main className="space-y-3 p-3">
        {route.isLoading ? <Spinner /> : route.isError ? <p className="text-sm text-[hsl(var(--danger-text))]">{t("phleb.loadError")}</p> : !route.data?.length ? <Empty>{t("phleb.noStops")}</Empty> : route.data.map((h: any, i: number) => (
          <Card key={h.id} className={`space-y-3 ${["COLLECTED", "FAILED", "ABORTED_UNSAFE"].includes(h.status) ? "bg-muted/50" : ""}`}>
            <div className="flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{h.routeSequence ?? i + 1}</span><span className="flex-1 font-semibold">{h.order.patient.fullName}</span><StatusBadge value={h.status} /></div>
            <div className="text-xs text-muted-foreground"><bdi dir="ltr" className="tabular-nums">{new Date(h.slotStart).toISOString().slice(11, 16)}–{new Date(h.slotEnd).toISOString().slice(11, 16)}</bdi> (UTC)</div>
            {h.addressMasked ? <p className="flex items-start gap-2 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{t("phleb.addressMasked")}{h.districtId ? ` · ${h.districtId}` : ""}</p> : <a className="flex min-h-10 items-center gap-2 text-sm text-primary underline" href={h.geo ? `https://www.google.com/maps/search/?api=1&query=${h.geo.lat},${h.geo.lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.address)}`} target="_blank" rel="noreferrer"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><bdi dir="auto">{h.address}</bdi></a>}
            {h.contactPhone ? <a className="flex min-h-10 items-center gap-2 text-sm text-primary underline" href={`tel:${h.contactPhone}`}><Phone className="h-4 w-4" /><bdi dir="ltr" className="tabular-nums">{h.contactPhone}</bdi></a> : null}
            <div className="flex flex-wrap gap-1">{h.order.items.map((it: any) => <Badge key={it.id}>{it.test.code}{it.test.fastingRequired ? " · " + t("orders.fasting") : ""}</Badge>)}</div>
            {["SCHEDULED", "EN_ROUTE", "ARRIVED"].includes(h.status) ? (
              <div className="flex gap-2">
                {h.status === "SCHEDULED" ? <Button size="lg" variant="secondary" className="flex-1" onClick={() => void depart(h)}>{t("phleb.start")}</Button> : null}
                {h.status === "EN_ROUTE" ? <Button size="lg" variant="secondary" className="flex-1" onClick={() => void arrive(h)}><MapPin className="h-4 w-4" />{t("phleb.arrive")}</Button> : null}
                {h.status === "ARRIVED" ? <Button size="lg" className="flex-1" onClick={() => open(h)}><ScanBarcode className="h-4 w-4" />{t("phleb.collect")}</Button> : null}
              </div>
            ) : null}
            {IN_FIELD.includes(h.status) ? (
              <div className="space-y-2 rounded-lg border border-[hsl(var(--danger-text)/0.3)] bg-[hsl(var(--danger-text)/0.07)] p-3" role="region" aria-label={t("set.safety")}>
                {now > new Date(h.slotEnd).getTime() + PROMPT_AFTER_MS ? (
                  <div className="rounded-md bg-[hsl(var(--warning)/0.12)] p-2 text-sm text-[hsl(var(--warning))]" role="alert">
                    <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" />{t("phleb.promptTitle")}</p>
                    <p className="text-xs">{t("phleb.promptBody")}</p>
                  </div>
                ) : <p className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--danger-text))]"><span className="kx-pulse-dot" aria-hidden="true" /><ShieldAlert aria-hidden="true" className="h-3.5 w-3.5" />{t("phleb.safetyActive")}</p>}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="secondary" className="h-16 flex-col gap-0.5 px-1 text-xs" onClick={() => void imOk(h)}><CheckCircle2 aria-hidden="true" className="size-5" />{t("phleb.imOk")}</Button>
                  <Button variant="destructive" className="h-16 flex-col gap-0.5 px-1 text-sm font-bold dark:bg-[#c92a2a]" onClick={() => void sos(h)}><Siren aria-hidden="true" className="size-5" />{t("phleb.sos")}</Button>
                  <Button variant="outline" className="h-16 flex-col gap-0.5 px-1 text-xs" onClick={() => { setUnsafe(h); setReason(UNSAFE_REASONS[0]); }}><LogOut aria-hidden="true" className="size-5 rtl:rotate-180" />{t("phleb.leaveUnsafe")}</Button>
                </div>
                <p className="text-xs text-[hsl(var(--danger-text))]">{t("phleb.emergency")} · <a className="underline" href="tel:123">123</a> · <a className="underline" href="tel:122">122</a></p>
              </div>
            ) : null}
          </Card>
        ))}
      </main>
      <Modal open={Boolean(unsafe)} onClose={() => setUnsafe(null)} title={t("phleb.leaveUnsafe")}>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("phleb.unsafeNote")}</p>
          <label className="block text-sm font-semibold">{t("phleb.unsafeReason")}
            <Select className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)}>{UNSAFE_REASONS.map((r) => <option key={r} value={r}>{t(`phleb.unsafeReasons.${r}`)}</option>)}</Select>
          </label>
          <Button variant="destructive" className="w-full" onClick={() => void leaveUnsafe()}>{t("phleb.leaveUnsafe")}</Button>
          <p className="text-xs text-[hsl(var(--danger-text))]">{t("phleb.emergency")}</p>
        </div>
      </Modal>
      <Modal open={Boolean(stop)} onClose={() => setStop(null)} title={stop?.order.patient.fullName ?? ""}>
        {stop ? (
          <div className="space-y-4">
            {!stop.order.identityVerified ? (
              <div>
                <p className="mb-1 text-sm font-semibold">1. {t("phleb.verifyId")}</p>
                <div className="flex flex-wrap gap-3">{idKinds.map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(k)} onChange={() => setIds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} />{t(`orders.ids.${k}`)}</label>)}</div>
              </div>
            ) : <Badge tone="ok">{t("order.verified")}</Badge>}
            <div>
              <p className="mb-1 text-sm font-semibold">2. {t("phleb.scanTubes")}</p>
              <ul className="mb-2 space-y-1">{specimens.map((s) => <li key={s.id} className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm"><span className="font-mono">{s.accessionNumber}</span>{scans.includes(s.barcode) ? <Badge tone="ok">✓</Badge> : <Badge tone="warn">{t("phleb.toScan")}</Badge>}</li>)}</ul>
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const el = e.currentTarget.elements.namedItem("code") as HTMLInputElement; addScan(el.value); el.value = ""; }}>
                <Input name="code" placeholder={t("phleb.scanPlaceholder")} aria-label={t("phleb.scanPlaceholder")} autoComplete="off" />
                <Button type="submit" variant="secondary">{t("common.add")}</Button>
                {"BarcodeDetector" in window ? <Button type="button" variant="outline" onClick={() => void scanWithCamera()} aria-label={t("phleb.camera")}><ScanBarcode className="h-4 w-4" /></Button> : null}
              </form>
              {scans.some((x) => !specimens.some((s) => s.barcode === x)) ? <p className="mt-1 text-xs text-[hsl(var(--danger-text))]">{t("phleb.mismatch")}</p> : null}
            </div>
            <div>
              <p className="mb-1 text-sm font-semibold">3. {t("phleb.photo")}</p>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await toJpegBase64(f)); }} />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>{photo ? t("phleb.retake") : t("phleb.takePhoto")}</Button>
              {photo ? <img alt="" src={`data:image/jpeg;base64,${photo}`} className="mt-2 max-h-40 rounded-md" /> : null}
              <p className="mt-1 text-xs text-muted-foreground">{t("phleb.photoNote")}</p>
            </div>
            <Button size="lg" className="w-full" disabled={!allScanned || (!stop.order.identityVerified && ids.length < 2)} onClick={() => void confirm()}>{t("phleb.confirm")}</Button>
            <div className="border-t border-border pt-3">
              <Input value={fail} onChange={(e) => setFail(e.target.value)} placeholder={t("phleb.failReason")} aria-label={t("phleb.failReason")} />
              <Button variant="destructive" size="sm" className="mt-2" disabled={fail.trim().length < 2} onClick={async () => { await queueCall(`/home-collections/${stop.id}/fail`, { reason: fail }); setStop(null); }}>{t("phleb.markFailed")}</Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
