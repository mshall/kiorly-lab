import { SignInDefaultCard } from "./SignInDefaultCard";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dt } from "@/lib/format";
import { Check } from "lucide-react";
import { Badge, Button, Card, CardTitle, Empty, Field, Input, Select, Table, Tabs, Td, useToast } from "@/components/ui";
import { Surface } from "@/brand/ui-kit";
import { ErrorNote, PageHeader } from "@/components/common";
import { AuditViewer, ImportTab, TemplatesTab } from "./SettingsExtras";
import { isE164, normalizeStaffPhone } from "@/lib/staff-phone";

const ROLES = ["OWNER", "LAB_DIRECTOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "SUPERVISOR", "PHLEBOTOMIST", "RECEPTION", "FINANCE", "BRANCH_MANAGER"];

/** Staff mobile number (E.164): links the person's Kiorex Passport on first Passport sign-in. Saved through PUT /staff/:id; the API validates and enforces uniqueness. */
function StaffPhoneCell({ staff, onSaved }: { staff: any; onSaved: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState<string>(staff.phone ?? "");
  const dirty = (normalizeStaffPhone(v) ?? "") !== (staff.phone ?? "") && v.trim() !== (staff.phone ?? "");
  const bad = v.trim() !== "" && !isE164(v);
  const save = useMutation({ mutationFn: () => api(`/staff/${staff.id}`, { method: "PUT", body: { phone: v.trim() === "" ? null : normalizeStaffPhone(v) } }), onSuccess: onSaved });
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input className="h-8 w-44 text-xs" dir="ltr" type="tel" inputMode="tel" placeholder="+201000002010" value={v} aria-invalid={bad || undefined} aria-label={`${staff.displayName} · ${t("set.phone")}`} onChange={(e) => setV(e.target.value)} />
        {dirty ? <Button size="sm" variant="outline" disabled={bad || save.isPending} onClick={() => save.mutate()}>{t("set.savePhone")}</Button> : null}
      </div>
      {bad ? <p role="alert" className="text-xs text-[hsl(var(--danger-text))]">{t("set.phoneInvalid")}</p> : null}
      <ErrorNote error={save.error} />
    </div>
  );
}

/** HVBK01: the districts a lab collects in (comma separated); saved through PUT /labs/:id/coverage. */
function CoverageEditor({ lab, onSaved }: { lab: any; onSaved: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState((lab.coverageDistricts ?? []).join(", "));
  const save = useMutation({ mutationFn: () => api(`/labs/${lab.id}/coverage`, { method: "PUT", body: { districtIds: v.split(",").map((x: string) => x.trim()).filter(Boolean) } }), onSuccess: onSaved });
  return (
    <div className="flex items-center gap-2">
      <Input className="h-8 min-w-48 text-xs" value={v} placeholder={t("set.coverageHint")} aria-label={t("set.coverage")} onChange={(e) => setV(e.target.value)} />
      <Button size="sm" variant="outline" disabled={!v.trim() || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button>
      <ErrorNote error={save.error} />
    </div>
  );
}

/** Staff & RBAC, labs, tenant settings, integrations (HMAC clients, flag state, dev inbox), audit log. */
export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [search] = useSearchParams();
  const [tab, setTab] = useState(search.get("tab") ?? "staff");
  // Quick setup deep link: ?tab=labs&setup=lab_licence&entity=<labId> preselects the lab to complete
  const [labPick, setLabPick] = useState<string>(search.get("entity") ?? "");
  const [labDraft, setLabDraft] = useState<{ id: string; licenceNo: string; address: string } | null>(null);
  const [s, setS] = useState({ email: "", displayName: "", role: "TECHNOLOGIST", signatoryLicenceNo: "", phone: "" });
  const [lab, setLab] = useState({ name: "", code: "" });
  const [secret, setSecret] = useState<any>(null);
  const staff = useQuery({ queryKey: ["staff"], queryFn: () => api<any[]>("/staff"), enabled: can("staff.manage") });
  const rbac = useQuery({ queryKey: ["rbac"], queryFn: () => api<any>("/rbac"), enabled: tab === "rbac" });
  const labs = useQuery({ queryKey: ["labs"], queryFn: () => api<any[]>("/labs") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api<any>("/settings"), enabled: tab === "general" });
  const clients = useQuery({ queryKey: ["clients"], queryFn: () => api<any[]>("/integration-clients"), enabled: tab === "integrations" && can("settings.manage") });
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => api<any[]>("/dev/inbox?limit=50"), enabled: tab === "integrations" && can("settings.manage") });
  const [g, setG] = useState<any>(null);
  const refresh = () => void qc.invalidateQueries();
  const addStaff = useMutation({ mutationFn: () => api("/staff", { body: { ...s, signatoryLicenceNo: s.signatoryLicenceNo || undefined, phone: normalizeStaffPhone(s.phone) ?? undefined } }), onSuccess: () => { setS({ ...s, email: "", displayName: "", signatoryLicenceNo: "", phone: "" }); refresh(); toast(t("common.saved")); } });
  const patchStaff = useMutation({ mutationFn: (v: { id: string; body: object }) => api(`/staff/${v.id}`, { method: "PUT", body: v.body }), onSuccess: refresh });
  const saveLab = useMutation({ mutationFn: (v: { id: string; licenceNo: string; address: string }) => api(`/labs/${v.id}`, { method: "PUT", body: { licenceNo: v.licenceNo.trim() || null, address: v.address.trim() || null } }), onSuccess: () => { setLabDraft(null); refresh(); } });
  const addLab = useMutation({ mutationFn: () => api("/labs", { body: lab }), onSuccess: () => { setLab({ name: "", code: "" }); refresh(); } });
  const SETTINGS_FIELDS = ["integrationMode", "defaultLocale", "name", "vatRatePercent", "referringDoctorStatements", "qcValidityHours", "safetyContactName", "safetyContactPhone", "homeBufferBeforeMin", "homeBufferAfterMin", "homeDailyCap"] as const;
  /** PUT /settings is strict: send only the editable fields (the GET also returns read-only ones such as edition, currency and the sign-in state). */
  const save = useMutation({ mutationFn: () => api("/settings", { method: "PUT", body: Object.fromEntries(SETTINGS_FIELDS.filter((k) => g && k in g).map((k) => [k, g[k]])) }), onSuccess: () => { refresh(); toast(t("common.saved")); } });
  const newClient = useMutation({ mutationFn: (source: string) => api<any>("/integration-clients", { body: { source } }), onSuccess: (r) => { setSecret(r); refresh(); } });
  const starter = useMutation({ mutationFn: () => api<any>("/onboarding/starter-catalogue", { body: {} }), onSuccess: (r) => toast(t("set.starterLoaded", { tests: r.tests })) });
  const form = g ?? settings.data;
  const tabs = [
    ...(can("staff.manage") ? [{ id: "staff", label: t("set.staff") }, { id: "rbac", label: t("set.rbac") }] : []),
    { id: "labs", label: t("set.labs") },
    ...(can("settings.manage") ? [{ id: "general", label: t("set.general") }, { id: "integrations", label: t("set.integrations") }] : []),
    ...(can("reports.read") ? [{ id: "templates", label: t("set.templates") }] : []),
    ...(can("catalogue.write") ? [{ id: "import", label: t("set.import") }] : []),
    ...(can("audit.read") ? [{ id: "audit", label: t("set.audit") }] : []),
  ];
  return (
    <>
      <PageHeader title={t("set.title")} sub={t("set.sub")} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "staff" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("set.staffPassportNote")}</p>
          <Card className="grid gap-3 sm:grid-cols-6">
            <Field label={t("auth.email")}><Input value={s.email} onChange={(e) => setS({ ...s, email: e.target.value })} type="email" /></Field>
            <Field label={t("common.name")}><Input value={s.displayName} onChange={(e) => setS({ ...s, displayName: e.target.value })} /></Field>
            <Field label={t("set.role")}><Select value={s.role} onChange={(e) => setS({ ...s, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</Select></Field>
            <Field label={t("set.phone")} hint={t("set.phoneHint")}><Input dir="ltr" type="tel" inputMode="tel" placeholder="+201000002010" value={s.phone} aria-invalid={(s.phone.trim() !== "" && !isE164(s.phone)) || undefined} onChange={(e) => setS({ ...s, phone: e.target.value })} /></Field>
            <Field label={t("set.licence")} hint={t("set.licenceHint")}><Input value={s.signatoryLicenceNo} onChange={(e) => setS({ ...s, signatoryLicenceNo: e.target.value })} /></Field>
            <div className="flex items-end"><Button disabled={!s.email || !s.displayName || (s.phone.trim() !== "" && !isE164(s.phone))} onClick={() => addStaff.mutate()}>{t("common.add")}</Button></div>
            <div className="sm:col-span-6"><ErrorNote error={addStaff.error ?? patchStaff.error} /></div>
          </Card>
          <Table head={[t("common.name"), t("auth.email"), t("set.phone"), t("set.passport"), t("set.role"), t("set.licence"), t("common.status")]}>
            {staff.data?.map((x) => (
              <tr key={x.id}><Td><span className="flex items-center gap-2.5"><span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{x.displayName.trim().slice(0, 1).toUpperCase()}</span><span dir="auto" className="font-medium">{x.displayName}</span></span></Td><Td className="text-xs text-muted-foreground"><bdi dir="ltr">{x.email}</bdi></Td><Td><StaffPhoneCell key={`${x.id}:${x.phone ?? ""}`} staff={x} onSaved={refresh} /></Td><Td><Badge tone={x.passportLinked ? "ok" : x.phone ? "warn" : "muted"}>{x.passportLinked ? t("set.passportLinked") : x.phone ? t("set.passportPending") : t("set.passportNoPhone")}</Badge></Td><Td><Select className="h-9 min-w-44 text-xs" aria-label={`${x.displayName} · ${t("set.role")}`} value={x.role} onChange={(e) => patchStaff.mutate({ id: x.id, body: { role: e.target.value } })}>{ROLES.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}</Select></Td><Td className="text-xs">{x.signatoryLicenceNo ?? "-"}</Td><Td><Button size="sm" variant={x.active ? "outline" : "secondary"} onClick={() => patchStaff.mutate({ id: x.id, body: { active: !x.active } })}>{x.active ? t("set.active") : t("common.inactive")}</Button></Td></tr>
            ))}
          </Table>
        </div>
      ) : null}
      {tab === "rbac" && rbac.data ? (() => {
        const groups: Record<string, string[]> = {};
        for (const perm of rbac.data.permissions as string[]) (groups[perm.split(".")[0]!] ??= []).push(perm);
        return (
          <Surface className="overflow-hidden">
            <p className="border-b border-border/70 px-4 py-3 text-xs text-muted-foreground">{t("ux.settings.rbacNote")}</p>
            <div tabIndex={0} role="region" aria-label={t("set.rbac")} className="max-h-[70vh] overflow-auto">
              <table className="kx-rbac w-full border-separate border-spacing-0 text-xs">
                <thead>
                  <tr>
                    <th scope="col" className="sticky inset-s-0 top-0 z-20 min-w-48 border-b border-border bg-card px-3 py-2 text-start font-semibold">{t("set.permission")}</th>
                    {ROLES.map((r) => <th scope="col" key={r} className="sticky top-0 z-10 min-w-24 border-b border-border bg-card px-2 py-2 text-center font-semibold leading-tight">{t(`role.${r}`)}</th>)}
                  </tr>
                </thead>
                {Object.entries(groups).map(([g, perms]) => (
                  <tbody key={g}>
                    <tr><th scope="colgroup" colSpan={ROLES.length + 1} className="sticky inset-s-0 bg-muted/70 px-3 py-1.5 text-start text-[11px] font-semibold uppercase tracking-wide text-muted-foreground rtl:normal-case rtl:tracking-normal">{g}</th></tr>
                    {perms.map((perm) => (
                      <tr key={perm} className="hover:bg-muted/40">
                        <th scope="row" className="sticky inset-s-0 z-1 border-b border-border/60 bg-card px-3 py-1.5 text-start font-mono font-normal"><bdi dir="ltr">{perm}</bdi></th>
                        {ROLES.map((r) => { const on = rbac.data.roles[r].includes(perm); return <td key={r} className="border-b border-border/60 px-2 py-1.5 text-center">{on ? <><Check aria-hidden className="mx-auto size-4 text-[hsl(var(--success))]" /><span className="sr-only">{t(`role.${r}`)}</span></> : <span aria-hidden className="text-border">·</span>}</td>; })}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          </Surface>
        );
      })() : null}
      {tab === "labs" ? (
        <div className="space-y-4">
          {can("settings.manage") ? <Card className="flex flex-wrap items-end gap-3"><Field label={t("common.name")}><Input value={lab.name} onChange={(e) => setLab({ ...lab, name: e.target.value })} /></Field><Field label={t("onboarding.labCode")}><Input value={lab.code} maxLength={6} onChange={(e) => setLab({ ...lab, code: e.target.value.toUpperCase() })} /></Field><Button disabled={!lab.name || !lab.code} onClick={() => addLab.mutate()}>{t("common.add")}</Button><div className="w-full"><ErrorNote error={addLab.error} /></div></Card> : null}
          {can("settings.manage") && labs.data?.length ? (() => {
            const cur = labs.data.find((l: any) => l.id === labPick) ?? labs.data[0];
            const f = labDraft && labDraft.id === cur.id ? labDraft : { id: cur.id, licenceNo: cur.licenceNo ?? "", address: cur.address ?? "" };
            return (
              <Card className="grid gap-3 sm:grid-cols-2" data-testid="lab-licence-form">
                <Field label={t("common.name")}><Select value={cur.id} onChange={(e) => { setLabPick(e.target.value); setLabDraft(null); }}>{labs.data.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
                <Field label={t("set.licence")}><Input data-setup-target="lab_licence" value={f.licenceNo} onChange={(e) => setLabDraft({ ...f, licenceNo: e.target.value })} /></Field>
                <Field label={t("set.address", "Address")} className="sm:col-span-2"><Input value={f.address} onChange={(e) => setLabDraft({ ...f, address: e.target.value })} /></Field>
                <div className="sm:col-span-2"><Button disabled={saveLab.isPending} onClick={() => saveLab.mutate(f)}>{t("common.save")}</Button></div>
              </Card>
            );
          })() : null}
          <Table head={[t("onboarding.labCode"), t("common.name"), t("set.licence"), t("set.coverage")]}>{labs.data?.map((l) => <tr key={l.id}><Td className="font-mono">{l.code}</Td><Td>{l.name}</Td><Td>{l.licenceNo ?? "-"}</Td><Td>{can("settings.manage") ? <CoverageEditor lab={l} onSaved={refresh} /> : (l.coverageDistricts ?? []).join(", ")}</Td></tr>)}</Table>
        </div>
      ) : null}
      {tab === "general" && form ? (
        <Card className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.name")}><Input value={form.name} onChange={(e) => setG({ ...form, name: e.target.value })} /></Field>
          <Field label={t("set.vat")} hint={t("set.vatHint")}><Input type="number" step="0.01" value={form.vatRatePercent} onChange={(e) => setG({ ...form, vatRatePercent: Number(e.target.value) })} /></Field>
          <Field label={t("set.defaultLocale")}><Select value={form.defaultLocale ?? "ar"} onChange={(e) => setG({ ...form, defaultLocale: e.target.value })}><option value="ar">العربية</option><option value="en">English</option></Select></Field>
          <div className="sm:col-span-2 rounded-lg border border-border bg-muted/40 p-3" data-testid="integration-mode">
            <p className="mb-1 text-sm font-semibold">{t("set.mode")}</p>
            <div className="flex flex-wrap gap-4">{["STANDALONE", "INTEGRATED"].map((m) => <label key={m} className="flex items-center gap-2 text-sm"><input type="radio" name="mode" checked={form.integrationMode === m} onChange={() => setG({ ...form, integrationMode: m })} />{t(`set.modes.${m}`)}</label>)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{t(`set.modeNote.${form.integrationMode ?? "INTEGRATED"}`)}</p>
          </div>
          <Field label={t("set.qcHours")} hint={t("set.qcHoursHint")}><Input type="number" value={form.qcValidityHours} onChange={(e) => setG({ ...form, qcValidityHours: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2 rounded-md border border-border p-3" data-testid="safety-settings">
            <p className="mb-2 text-sm font-semibold">{t("set.safety")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("set.safetyName")}><Input data-setup-target="safety_contact" value={form.safetyContactName ?? ""} onChange={(e) => setG({ ...form, safetyContactName: e.target.value || null })} /></Field>
              <Field label={t("set.safetyPhone")} hint={t("set.safetyHint")}><Input type="tel" value={form.safetyContactPhone ?? ""} onChange={(e) => setG({ ...form, safetyContactPhone: e.target.value || null })} /></Field>
              <Field label={t("set.homeBuffers")}><div className="flex gap-2"><Input type="number" min={0} max={180} value={form.homeBufferBeforeMin} onChange={(e) => setG({ ...form, homeBufferBeforeMin: Number(e.target.value) })} /><Input type="number" min={0} max={180} value={form.homeBufferAfterMin} onChange={(e) => setG({ ...form, homeBufferAfterMin: Number(e.target.value) })} /></div></Field>
              <Field label={t("set.homeCap")}><Input type="number" min={1} max={50} value={form.homeDailyCap ?? ""} onChange={(e) => setG({ ...form, homeDailyCap: e.target.value ? Number(e.target.value) : null })} /></Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.referringDoctorStatements} onChange={(e) => setG({ ...form, referringDoctorStatements: e.target.checked })} />{t("set.statements")}</label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2"><Button disabled={!g || save.isPending} onClick={() => save.mutate()}>{t("common.save")}</Button><Button variant="outline" data-setup-target="starter_catalogue" onClick={() => starter.mutate()}>{t("set.loadStarter")}</Button><ErrorNote error={save.error} /></div>
          <p className="sm:col-span-2 text-xs text-muted-foreground">{t("set.noTaxNote")}</p>
        </Card>
      ) : null}
      {tab === "general" ? <SignInDefaultCard /> : null}
      {tab === "templates" ? <TemplatesTab /> : null}
      {tab === "import" ? <ImportTab /> : null}
      {tab === "integrations" ? (
        <div className="space-y-4">
          <Card>
            <CardTitle>{t("set.flags")}</CardTitle>
            <p className="mb-2 text-xs text-muted-foreground">{t("set.flagsNote")}</p>
            <div className="flex flex-wrap gap-2">{Object.entries(me?.flags ?? {}).map(([k, v]) => <Badge key={k} tone={v.enabled ? "ok" : "crit"}>{k}: {v.enabled ? "ON" : `OFF (${v.scope})`}</Badge>)}</div>
            <p className="mt-3 text-xs text-muted-foreground">{t("set.neverFlags")}</p>
          </Card>
          <Card>
            <CardTitle>{t("set.clients")}</CardTitle>
            <div className="mb-3 flex gap-2"><Button size="sm" onClick={() => newClient.mutate("KIOREX_BOOKING")}>{t("set.newKiorexClient")}</Button><Button size="sm" variant="outline" onClick={() => newClient.mutate("KIORLY_CLINIC")}>{t("set.newClinicClient")}</Button></div>
            {secret ? <div role="alert" className="mb-3 rounded-md bg-[hsl(var(--warning)/0.12)] p-3 text-xs text-[hsl(var(--warning))]"><div className="font-semibold">{t("set.secretOnce")}</div><div className="font-mono break-all">{secret.key}</div><div className="font-mono break-all">{secret.secret}</div></div> : null}
            <Table head={[t("set.key"), t("set.source"), t("common.status")]}>{clients.data?.map((c) => <tr key={c.id}><Td className="font-mono text-xs">{c.key}</Td><Td>{c.source}</Td><Td>{c.active ? <Badge tone="ok">{t("set.active")}</Badge> : <Badge>{t("common.inactive")}</Badge>}</Td></tr>)}</Table>
          </Card>
          <Card>
            <CardTitle>{t("set.inbox")}</CardTitle>
            <p className="mb-2 text-xs text-muted-foreground">{t("set.inboxNote")}</p>
            {inbox.data?.length ? <Table head={[t("common.date"), t("set.purpose"), t("set.channel"), t("set.template"), t("common.status")]}>{inbox.data.map((n) => <tr key={n.id}><Td className="text-xs">{dt(n.createdAt, i18n.language)}</Td><Td>{n.purpose}</Td><Td>{n.channel}</Td><Td className="font-mono text-xs">{n.templateId}</Td><Td><Badge tone={n.status === "FAILED" ? "crit" : "ok"}>{n.status}</Badge></Td></tr>)}</Table> : <Empty>{t("common.none")}</Empty>}
          </Card>
        </div>
      ) : null}
      {tab === "audit" && can("audit.read") ? <AuditViewer /> : null}
    </>
  );
}
