import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { money } from "@/lib/format";
import { Badge, Button, Input, Modal, focusOnMount } from "@/components/ui";
import "@/features/topbar/topbar-strings";

type TestRow = { id: string; code: string; nameEn: string; nameAr?: string | null; specimenType?: string | null; container?: string | null; tatMinutes?: number | null; price?: string | number | null; fastingRequired?: boolean };
const MIN = 2;

/** "Find a test for a patient" in the top bar (Ctrl or Cmd + K): search the test catalogue by name or code, read the details and start an order for a patient with the test already picked. Same place and shape as the Clinic's "Find patient". */
export function FindTest() {
  const { t, i18n } = useTranslation();
  const { me, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const tests = useQuery({ queryKey: ["tests"], queryFn: () => api<TestRow[]>("/catalogue/tests"), enabled: open, staleTime: 60_000 });
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => (term.length < MIN ? [] : (tests.data ?? []).filter((x) => `${x.code} ${x.nameEn} ${x.nameAr ?? ""}`.toLowerCase().includes(term)).slice(0, 10)), [tests.data, term]);
  const close = () => { setOpen(false); setQ(""); };
  const label = t("topbar.findTest");
  const dur = (m?: number | null) => (m == null ? "—" : m >= 120 ? t("topbar.hours", { count: Math.round(m / 60) }) : t("topbar.minutes", { count: m }));
  return (
    <>
      <Button type="button" variant="outline" size="icon" className="shrink-0 md:hidden" aria-label={label} onClick={() => setOpen(true)}><Search aria-hidden className="size-4" /></Button>
      <button type="button" data-testid="find-test" className="hidden h-9 min-w-56 items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted md:inline-flex" onClick={() => setOpen(true)} title={t("topbar.shortcut")}>
        <Search aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{label}</span><kbd className="hidden rounded border border-border bg-card px-1.5 text-[10px] lg:inline-flex">⌘K</kbd>
      </button>
      <Modal open={open} onClose={close} title={t("topbar.dialogTitle")} wide>
        <div className="space-y-3">
          <Input ref={focusOnMount} aria-label={label} placeholder={t("topbar.placeholder")} value={q} onChange={(e) => setQ(e.target.value)} />
          <p className="text-xs text-muted-foreground">{t("topbar.hint")}</p>
          {open && tests.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t("topbar.loading")}…</p> : null}
          {tests.isError ? <p role="alert" className="text-sm text-destructive">{t("topbar.failed")}</p> : null}
          {tests.data && term.length >= MIN && !hits.length ? <p role="status" className="text-sm text-muted-foreground">{t("topbar.none")}</p> : null}
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto" aria-label={label}>
            {hits.map((x) => (
              <li key={x.id} className="rounded-lg border border-border/80 bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-medium"><bdi className="me-2 font-mono text-xs text-muted-foreground">{x.code}</bdi>{i18n.language === "ar" && x.nameAr ? x.nameAr : x.nameEn}</div>
                  {x.fastingRequired ? <Badge tone="warn">{t("topbar.fasting")}</Badge> : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>{t("topbar.specimen")}: <bdi>{x.specimenType ?? "—"}</bdi></span>{x.container ? <span>{t("topbar.container")}: <bdi>{x.container}</bdi></span> : null}
                  <span>{t("topbar.turnaround")}: <bdi>{dur(x.tatMinutes)}</bdi></span><span>{t("topbar.price")}: <bdi className="font-semibold text-foreground">{x.price == null || x.price === "" ? "—" : money(x.price, me?.tenant.currency, i18n.language)}</bdi></span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-end gap-3 text-sm">
                  {can("catalogue.read") ? <Link to="/catalogue" onClick={close} className="font-medium text-primary underline-offset-4 hover:underline">{t("topbar.openCatalogue")}</Link> : null}
                  {can("orders.create") ? <Link to={`/orders/new?test=${encodeURIComponent(x.code)}`} onClick={close}><Button size="sm">{t("topbar.orderFor")}</Button></Link> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  );
}
