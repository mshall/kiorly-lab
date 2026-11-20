import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { today } from "@/lib/format";
import { Badge, Button, Card, CardTitle, Field, Input, Select, Spinner, Textarea } from "@/components/ui";
import { ErrorNote, PageHeader } from "@/components/common";

const CHANNELS = ["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT", "REFERRER_PORTAL"];
const IDS = ["dateOfBirth", "phone", "nationalId"];

/** KLORD02/03 walk-in & referring-doctor order: two identifiers, consent per channel, tests/packages, optional home collection. */
export function NewOrderPage() {
  const { t, i18n } = useTranslation();
  const { flagOn, me, can } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [referrerId, setReferrerId] = useState("");
  const [clinical, setClinical] = useState("");
  const [icdCodes, setIcdCodes] = useState<string[]>([]);
  const [icdQ, setIcdQ] = useState("");
  const [fasting, setFasting] = useState(false);
  const [p, setP] = useState({ fullName: "", dateOfBirth: "", sex: "UNKNOWN", phone: "", nationalId: "" });
  const [existing, setExisting] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [tests, setTests] = useState<string[]>([]);
  const [pkgs, setPkgs] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState("WALK_IN");
  const [doc, setDoc] = useState({ name: "", ref: "", phone: "" });
  const [priority, setPriority] = useState("ROUTINE");
  const [consent, setConsent] = useState<string[]>([]);
  const [home, setHome] = useState(false);
  const [date, setDate] = useState(today());
  const [slotId, setSlotId] = useState("");
  const [address, setAddress] = useState("");
  const catalogue = useQuery({ queryKey: ["tests"], queryFn: () => api<any[]>("/catalogue/tests") });
  const referrers = useQuery({ queryKey: ["referrers-pick"], queryFn: () => api<any[]>("/referrers?active=true"), enabled: can("referrers.read") });
  const icd = useQuery({ queryKey: ["icd", icdQ], queryFn: () => api<any[]>(`/icd/search?q=${encodeURIComponent(icdQ)}`), enabled: icdQ.length >= 1 });
  const preset = useQuery({ queryKey: ["patient", sp.get("patientId")], queryFn: () => api<any>(`/patients/${sp.get("patientId")}`), enabled: Boolean(sp.get("patientId")) && !existing });
  useEffect(() => { if (preset.data && !existing) setExisting(preset.data); }, [preset.data, existing]);
  const packages = useQuery({ queryKey: ["packages"], queryFn: () => api<any[]>("/catalogue/packages") });
  const found = useQuery({ queryKey: ["patient-search", search], queryFn: () => api<any[]>(`/patients?search=${encodeURIComponent(search)}&limit=5`), enabled: search.length >= 3 });
  const homeOk = flagOn("lab.home_collection") && (me?.capabilities.includes("home_collection") ?? false);
  const slots = useQuery({ queryKey: ["slots", date], queryFn: () => api<any[]>(`/home-collection/slots?date=${date}`), enabled: home && homeOk });
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const patient = existing ?? p;
  const present = IDS.filter((k) => (k === "dateOfBirth" ? patient.dateOfBirth : k === "phone" ? patient.phone : existing ? Boolean(existing.nationalIdLast4) : patient.nationalId));
  const m = useMutation({
    mutationFn: () =>
      api<any>("/orders", {
        body: {
          ...(existing ? { patientId: existing.id } : { patient: { fullName: p.fullName, ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}), sex: p.sex, ...(p.phone ? { phone: p.phone } : {}), ...(p.nationalId ? { nationalId: p.nationalId } : {}) } }),
          testCodes: tests, packageCodes: pkgs, source, priority, consentChannels: consent,
          ...(checked.length >= 2 ? { identifiersChecked: checked } : {}),
          ...(referrerId ? { referrerId } : {}), ...(clinical ? { clinicalInfo: clinical } : {}), ...(icdCodes.length ? { icdCodes } : {}), ...(needsFasting ? { fastingConfirmed: fasting } : {}),
          ...(!referrerId && (source === "REFERRING_DOCTOR" || doc.name) ? { referringDoctorName: doc.name || undefined, referringDoctorRef: doc.ref || undefined, referringDoctorPhone: doc.phone || undefined } : {}),
          ...(home ? { collectionType: "HOME", homeCollection: { slotId, address } } : {}),
        },
      }),
    onSuccess: (o) => nav(`/orders/${o.id}`),
  });
  const needsFasting = (catalogue.data ?? []).some((x) => tests.includes(x.code) && x.fastingRequired);
  if (catalogue.isLoading) return <Spinner />;
  const list = (catalogue.data ?? []).filter((x) => !filter || `${x.code} ${x.nameEn} ${x.nameAr ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const ready = (existing || p.fullName.length >= 2) && (tests.length > 0 || pkgs.length > 0) && (!home || (slotId && address.length >= 5));
  return (
    <>
      <PageHeader title={t("orders.new")} sub={t("orders.newSub")} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <CardTitle>{t("orders.patient")}</CardTitle>
          <Field label={t("orders.findPatient")}><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("orders.findHint")} /></Field>
          {found.data?.map((x) => <button key={x.id} type="button" className="block w-full rounded-md bg-muted px-3 py-2 text-start text-sm hover:bg-accent" onClick={() => { setExisting(x); setSearch(""); setChecked([]); }}>{x.fullName} · {x.phone ?? ""} · {x.dateOfBirth?.slice(0, 10) ?? ""}</button>)}
          {existing ? (
            <div className="flex items-center justify-between rounded-md bg-accent p-2 text-sm"><span>{existing.fullName}</span><Button size="sm" variant="ghost" onClick={() => { setExisting(null); setChecked([]); }}>{t("common.change")}</Button></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("orders.fullName")} className="sm:col-span-2"><Input value={p.fullName} onChange={(e) => setP({ ...p, fullName: e.target.value })} /></Field>
              <Field label={t("orders.dob")}><Input type="date" value={p.dateOfBirth} onChange={(e) => setP({ ...p, dateOfBirth: e.target.value })} /></Field>
              <Field label={t("orders.sex")}><Select value={p.sex} onChange={(e) => setP({ ...p, sex: e.target.value })}>{["F", "M", "OTHER", "UNKNOWN"].map((s) => <option key={s} value={s}>{t(`orders.sexes.${s}`)}</option>)}</Select></Field>
              <Field label={t("orders.phone")}><Input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} inputMode="tel" /></Field>
              <Field label={t("orders.nationalId")}><Input value={p.nationalId} onChange={(e) => setP({ ...p, nationalId: e.target.value })} inputMode="numeric" /></Field>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("orders.identifiers")}</p>
            <div className="flex flex-wrap gap-3">{IDS.map((k) => <label key={k} className={`flex items-center gap-2 text-sm ${present.includes(k) ? "" : "opacity-40"}`}><input type="checkbox" disabled={!present.includes(k)} checked={checked.includes(k)} onChange={() => toggle(checked, setChecked, k)} />{t(`orders.ids.${k}`)}</label>)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{checked.length >= 2 ? t("orders.idOk") : t("orders.idNeed")}</p>
          </div>
        </Card>
        <Card className="space-y-3">
          <CardTitle>{t("orders.tests")}</CardTitle>
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t("common.search")} aria-label={t("common.search")} />
          <div className="max-h-56 space-y-1 overflow-auto">
            {list.map((x) => <label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tests.includes(x.code)} onChange={() => toggle(tests, setTests, x.code)} /><span className="font-mono text-xs">{x.code}</span><span>{x.nameEn}</span>{x.fastingRequired ? <Badge tone="warn">{t("orders.fasting")}</Badge> : null}<span className="ms-auto text-xs text-muted-foreground">{x.price}</span></label>)}
          </div>
          {packages.data?.length ? <div><p className="mb-1 text-xs font-medium text-muted-foreground">{t("orders.packages")}</p>{packages.data.map((x) => <label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pkgs.includes(x.code)} onChange={() => toggle(pkgs, setPkgs, x.code)} />{x.nameEn}<span className="ms-auto text-xs text-muted-foreground">{x.price}</span></label>)}</div> : null}
        </Card>
        <Card className="space-y-3">
          <CardTitle>{t("orders.details")}</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("orders.source")}><Select value={source} onChange={(e) => setSource(e.target.value)}>{["WALK_IN", "REFERRING_DOCTOR"].map((s) => <option key={s} value={s}>{t(`orders.sources.${s}`)}</option>)}</Select></Field>
            <Field label={t("orders.priority")}><Select value={priority} onChange={(e) => setPriority(e.target.value)}>{["ROUTINE", "URGENT", "STAT"].map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label={t("orders.doctorName")}><Input value={doc.name} onChange={(e) => setDoc({ ...doc, name: e.target.value })} /></Field>
            <Field label={t("orders.doctorPhone")} hint={t("orders.doctorPhoneHint")}><Input value={doc.phone} onChange={(e) => setDoc({ ...doc, phone: e.target.value })} inputMode="tel" /></Field>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("orders.consent")}</p>
            <div className="flex flex-wrap gap-3">{CHANNELS.map((c) => <label key={c} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={consent.includes(c)} onChange={() => toggle(consent, setConsent, c)} />{t(`channel.${c}`)}</label>)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t("orders.consentNote")}</p>
          </div>
        </Card>
        <Card className="space-y-3 lg:col-span-2">
          <CardTitle>{t("oe.clinical")}</CardTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {can("referrers.read") ? <Field label={t("ref.referrer")} hint={t("oe.referrerHint")}><Select value={referrerId} onChange={(e) => { setReferrerId(e.target.value); if (e.target.value) setSource("REFERRING_DOCTOR"); }}><option value="">-</option>{(referrers.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.specialty ? ` · ${r.specialty}` : ""}</option>)}</Select></Field> : null}
            {needsFasting ? <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={fasting} onChange={(e) => setFasting(e.target.checked)} />{t("oe.fastingConfirm")}</label> : null}
            <Field label={t("oe.clinical")} className="sm:col-span-2"><Textarea rows={2} value={clinical} onChange={(e) => setClinical(e.target.value)} dir="auto" /></Field>
            <Field label={t("oe.icd")} hint={t("oe.icdHint")} className="sm:col-span-2">
              <div className="space-y-2"><Input value={icdQ} onChange={(e) => setIcdQ(e.target.value)} placeholder="E11 / thyroid / سكر" />
                <div className="flex flex-wrap gap-1">{(icd.data ?? []).map((h) => <button key={h.code} type="button" className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-accent" onClick={() => { setIcdCodes([...new Set([...icdCodes, h.code])]); const add = h.suggest.filter((c: string) => (catalogue.data ?? []).some((x) => x.code === c) && !tests.includes(c)); if (add.length) setTests([...tests, ...add]); }}>{h.code} · {i18n.language === "ar" ? h.ar : h.en}</button>)}</div>
                <div className="flex flex-wrap gap-1">{icdCodes.map((c) => <Badge key={c} tone="info">{c}<button type="button" aria-label={t("common.remove")} className="ms-1" onClick={() => setIcdCodes(icdCodes.filter((x) => x !== c))}>×</button></Badge>)}</div></div>
            </Field>
          </div>
        </Card>
        <Card className="space-y-3">
          <CardTitle>{t("orders.collection")}</CardTitle>
          <label className={`flex items-center gap-2 text-sm ${homeOk ? "" : "opacity-50"}`}><input type="checkbox" disabled={!homeOk} checked={home} onChange={(e) => setHome(e.target.checked)} />{t("orders.homeCollection")}</label>
          {!homeOk ? <p className="text-xs text-muted-foreground">{t("orders.homeOff")}</p> : null}
          {home && homeOk ? (
            <>
              <Field label={t("orders.slotDate")}><Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlotId(""); }} /></Field>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slots.data?.map((s) => <button key={s.id} type="button" disabled={s.available === 0} onClick={() => setSlotId(s.id)} className={`rounded-md border px-2 py-2 text-xs ${slotId === s.id ? "border-primary bg-accent" : "border-border"} disabled:opacity-40`}>{new Date(s.startsAt).toISOString().slice(11, 16)}–{new Date(s.endsAt).toISOString().slice(11, 16)}<br />{t("orders.seats", { n: s.available })}</button>)}
              </div>
              <Field label={t("orders.address")}><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
            </>
          ) : null}
        </Card>
      </div>
      <div className="mt-4 space-y-2">
        <ErrorNote error={m.error} />
        <Button size="lg" disabled={!ready || m.isPending} onClick={() => m.mutate()}>{t("orders.create")}</Button>
      </div>
    </>
  );
}
