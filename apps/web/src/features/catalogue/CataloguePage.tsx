import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dOnly, money } from "@/lib/format";
import { Badge, Button, Empty, Field, Input, Modal, Select, Spinner, Table, Tabs, Td, useToast } from "@/components/ui";
import { ErrorNote, PageHeader } from "@/components/common";

/** KLORD01 / KLQC03: test catalogue (AR/EN, specimen, container, volume, prep, TAT, price), analytes, versioned reference intervals. */
export function CataloguePage() {
  const { t, i18n } = useTranslation();
  const { can, me, flagOn } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState("tests");
  const [open, setOpen] = useState(false);
  const [analyte, setAnalyte] = useState<any>(null);
  const [f, setF] = useState({ code: "", nameEn: "", nameAr: "", specimenType: "Serum", container: "", volumeMl: "", tatMinutes: "120", price: "", fastingRequired: false, analyteCodes: [] as string[] });
  const [iv, setIv] = useState({ sex: "", ageMinDays: "6570", low: "", high: "", source: "" });
  const tests = useQuery({ queryKey: ["tests-all"], queryFn: () => api<any[]>("/catalogue/tests?active=false") });
  const analytes = useQuery({ queryKey: ["analytes"], queryFn: () => api<any[]>("/catalogue/analytes") });
  const pkgs = useQuery({ queryKey: ["packages"], queryFn: () => api<any[]>("/catalogue/packages"), enabled: tab === "packages" });
  const intervals = useQuery({ queryKey: ["intervals", analyte?.id], queryFn: () => api<any[]>(`/catalogue/analytes/${analyte.id}/reference-intervals`), enabled: Boolean(analyte) });
  const cur = me?.tenant.currency;
  const writable = can("catalogue.write") && flagOn("lab.module");
  const create = useMutation({
    mutationFn: () => api("/catalogue/tests", { body: { code: f.code, nameEn: f.nameEn, nameAr: f.nameAr || undefined, specimenType: f.specimenType, container: f.container || undefined, volumeMl: f.volumeMl ? Number(f.volumeMl) : undefined, tatMinutes: Number(f.tatMinutes), price: Number(f.price), fastingRequired: f.fastingRequired, analyteCodes: f.analyteCodes } }),
    onSuccess: () => { setOpen(false); void qc.invalidateQueries(); toast(t("common.saved")); },
  });
  const addIv = useMutation({
    mutationFn: () => api(`/catalogue/analytes/${analyte.id}/reference-intervals`, { body: { sex: iv.sex || null, ageMinDays: Number(iv.ageMinDays), low: iv.low === "" ? null : Number(iv.low), high: iv.high === "" ? null : Number(iv.high), source: iv.source || undefined } }),
    onSuccess: () => { void qc.invalidateQueries(); toast(t("cat.versionAdded")); },
  });
  return (
    <>
      <PageHeader title={t("cat.title")} sub={t("cat.sub")} actions={writable && tab === "tests" ? <Button onClick={() => setOpen(true)}>{t("cat.newTest")}</Button> : null} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "tests", label: t("cat.tests") }, { id: "analytes", label: t("cat.analytes") }, { id: "packages", label: t("cat.packages") }]} />
      {tab === "tests" ? (tests.isLoading ? <Spinner /> : (
        <Table head={[t("cat.code"), t("common.name"), t("cat.specimen"), t("cat.volume"), t("cat.tat"), t("common.price"), ""]}>
          {tests.data?.map((x) => (
            <tr key={x.id}><Td className="font-mono">{x.code}</Td><Td>{i18n.language === "ar" && x.nameAr ? x.nameAr : x.nameEn}{x.fastingRequired ? <Badge tone="warn" className="ms-2">{t("orders.fasting")}</Badge> : null}{x.sendOut ? <Badge tone="info" className="ms-2">{t("cat.sendOut")}</Badge> : null}</Td><Td>{x.specimenType}{x.container ? ` · ${x.container}` : ""}</Td><Td>{x.volumeMl ?? "-"}</Td><Td>{x.tatMinutes ?? "-"}</Td><Td>{money(x.price, cur, i18n.language)}</Td><Td>{x.active ? "" : <Badge>{t("common.inactive")}</Badge>}</Td></tr>
          ))}
        </Table>
      )) : null}
      {tab === "analytes" ? (
        <Table head={[t("cat.code"), t("common.name"), t("cat.unit"), ""]}>
          {analytes.data?.map((a) => <tr key={a.id}><Td className="font-mono">{a.code}</Td><Td>{i18n.language === "ar" && a.nameAr ? a.nameAr : a.nameEn}</Td><Td>{a.unit}</Td><Td className="text-end"><Button size="sm" variant="outline" onClick={() => setAnalyte(a)}>{t("cat.intervals")}</Button></Td></tr>)}
        </Table>
      ) : null}
      {tab === "packages" ? (pkgs.data?.length ? <Table head={[t("cat.code"), t("common.name"), t("cat.tests"), t("common.price")]}>{pkgs.data.map((p) => <tr key={p.id}><Td className="font-mono">{p.code}</Td><Td>{i18n.language === "ar" && p.nameAr ? p.nameAr : p.nameEn}</Td><Td>{p.items.map((i: any) => i.test.code).join(", ")}</Td><Td>{money(p.price, cur, i18n.language)}</Td></tr>)}</Table> : <Empty>{t("common.none")}</Empty>) : null}
      <p className="mt-4 text-xs text-muted-foreground">{t("cat.syntheticNote")}</p>
      <Modal open={open} onClose={() => setOpen(false)} title={t("cat.newTest")} wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("cat.code")}><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label={t("cat.specimen")}><Input value={f.specimenType} onChange={(e) => setF({ ...f, specimenType: e.target.value })} /></Field>
          <Field label={t("cat.nameEn")}><Input value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} /></Field>
          <Field label={t("cat.nameAr")}><Input dir="rtl" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></Field>
          <Field label={t("cat.container")}><Input value={f.container} onChange={(e) => setF({ ...f, container: e.target.value })} /></Field>
          <Field label={t("cat.volume")}><Input type="number" step="0.1" value={f.volumeMl} onChange={(e) => setF({ ...f, volumeMl: e.target.value })} /></Field>
          <Field label={t("cat.tat")}><Input type="number" value={f.tatMinutes} onChange={(e) => setF({ ...f, tatMinutes: e.target.value })} /></Field>
          <Field label={t("common.price")}><Input type="number" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.fastingRequired} onChange={(e) => setF({ ...f, fastingRequired: e.target.checked })} />{t("orders.fasting")}</label>
          <Field label={t("cat.analytes")} className="sm:col-span-2"><div className="flex max-h-32 flex-wrap gap-2 overflow-auto">{analytes.data?.map((a) => <label key={a.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.analyteCodes.includes(a.code)} onChange={() => setF({ ...f, analyteCodes: f.analyteCodes.includes(a.code) ? f.analyteCodes.filter((x) => x !== a.code) : [...f.analyteCodes, a.code] })} />{a.code}</label>)}</div></Field>
        </div>
        <div className="mt-4 space-y-2"><ErrorNote error={create.error} /><Button disabled={!f.code || !f.nameEn || !f.price || !f.analyteCodes.length || create.isPending} onClick={() => create.mutate()}>{t("common.save")}</Button></div>
      </Modal>
      <Modal open={Boolean(analyte)} onClose={() => setAnalyte(null)} title={analyte ? `${analyte.code} — ${t("cat.intervals")}` : ""} wide>
        {intervals.data?.length ? (
          <Table head={[t("orders.sex"), t("cat.ageFrom"), "low", "high", t("cat.version"), t("cat.effective"), t("cat.source")]}>
            {intervals.data.map((r) => <tr key={r.id} className={r.effectiveTo ? "opacity-50" : ""}><Td>{r.sex ?? "*"}</Td><Td>{r.ageMinDays}{r.ageMaxDays != null ? `–${r.ageMaxDays}` : "+"}</Td><Td>{r.low ?? "-"}</Td><Td>{r.high ?? "-"}</Td><Td>v{r.version}</Td><Td>{dOnly(r.effectiveFrom, i18n.language)}{r.effectiveTo ? ` → ${dOnly(r.effectiveTo, i18n.language)}` : ""}</Td><Td className="text-xs">{r.source ?? "-"}</Td></tr>)}
          </Table>
        ) : <Empty>{t("common.none")}</Empty>}
        {can("catalogue.write") ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <Field label={t("orders.sex")}><Select value={iv.sex} onChange={(e) => setIv({ ...iv, sex: e.target.value })}><option value="">*</option><option value="F">F</option><option value="M">M</option></Select></Field>
            <Field label={t("cat.ageFrom")}><Input type="number" value={iv.ageMinDays} onChange={(e) => setIv({ ...iv, ageMinDays: e.target.value })} /></Field>
            <Field label="low"><Input type="number" step="any" value={iv.low} onChange={(e) => setIv({ ...iv, low: e.target.value })} /></Field>
            <Field label="high"><Input type="number" step="any" value={iv.high} onChange={(e) => setIv({ ...iv, high: e.target.value })} /></Field>
            <Field label={t("cat.source")}><Input value={iv.source} onChange={(e) => setIv({ ...iv, source: e.target.value })} /></Field>
            <div className="sm:col-span-5 space-y-2"><ErrorNote error={addIv.error} /><Button onClick={() => addIv.mutate()} disabled={addIv.isPending}>{t("cat.addVersion")}</Button><p className="text-xs text-muted-foreground">{t("cat.versionNote")}</p></div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
