/** Lab console primitives built on the brand kit: search, segmented queues, priority chips, bulk bar, label/report previews. */
import { useEffect, useRef, type ReactNode } from "react";
import { Download, Search, X, Siren } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { blobUrl } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { EmptyState, Skeleton, kcn } from "@/brand/ui-kit";

/** Search field with leading icon, clear button and an optional "/" shortcut that focuses it. */
export function SearchBox({ value, onChange, placeholder, label, className, shortcut = true }: { value: string; onChange: (v: string) => void; placeholder: string; label?: string; className?: string; shortcut?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shortcut) return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && el && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !el.isContentEditable) { e.preventDefault(); ref.current?.focus(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [shortcut]);
  return (
    <div className={kcn("relative min-w-48 flex-1 sm:max-w-sm", className)}>
      <Search aria-hidden className="pointer-events-none absolute inset-y-0 inset-s-3 my-auto size-4 text-muted-foreground" />
      <input ref={ref} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label ?? placeholder}
        className="h-10 w-full rounded-lg border border-input bg-card ps-9 pe-9 text-sm shadow-kx-1 transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:appearance-none" />
      {value ? <button type="button" aria-label="clear" onClick={() => { onChange(""); ref.current?.focus(); }} className="absolute inset-y-0 inset-e-1 my-auto grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X aria-hidden className="size-4" /></button>
        : shortcut ? <kbd aria-hidden className="pointer-events-none absolute inset-y-0 inset-e-2.5 my-auto hidden h-5 items-center rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground sm:inline-flex">/</kbd> : null}
    </div>
  );
}

export interface SegItem { id: string; label: string; count?: number; tone?: "neutral" | "bad" | "warn" | "good" }
/** Queue filter: roving-tabindex radio group (arrow keys), counts as tabular chips. */
export function Segmented({ items, value, onChange, label, className }: { items: SegItem[]; value: string; onChange: (id: string) => void; label: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, items.findIndex((i) => i.id === value));
  const move = (d: number) => { const n = (idx + d + items.length) % items.length; onChange(items[n]!.id); refs.current[n]?.focus(); };
  return (
    <div role="radiogroup" aria-label={label} className={kcn("inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border/80 bg-muted/60 p-1", className)}
      onKeyDown={(e) => { const rtl = document.dir === "rtl"; if (e.key === "ArrowRight") { e.preventDefault(); move(rtl ? -1 : 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); move(rtl ? 1 : -1); } else if (e.key === "ArrowDown") { e.preventDefault(); move(1); } else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); } }}>
      {items.map((i, n) => {
        const on = i.id === value;
        return (
          <button key={i.id} ref={(el) => { refs.current[n] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(i.id)}
            className={kcn("inline-flex min-h-8 items-center gap-2 rounded-lg px-3 text-sm transition-[background-color,box-shadow,color] duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-card font-semibold text-foreground shadow-kx-1" : "text-muted-foreground hover:text-foreground")}>
            {i.label}
            {i.count != null ? <span className={kcn("min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums", i.tone === "bad" && i.count > 0 ? "bg-[hsl(var(--danger-text)/0.14)] text-[hsl(var(--danger-text))]" : i.tone === "warn" && i.count > 0 ? "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]" : on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{i.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** STAT / URGENT affordance: never colour alone (icon + text); STAT pulses unless reduced motion. */
export function PriorityChip({ priority, className }: { priority?: string | null; className?: string }) {
  const { t } = useTranslation();
  if (!priority || priority === "ROUTINE") return null;
  const stat = priority === "STAT";
  return (
    <span className={kcn("inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ring-1 ring-inset", stat ? "bg-[hsl(var(--danger-text))] text-white ring-transparent dark:bg-[#c92a2a]" : "bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))] ring-[hsl(var(--warning)/0.35)]", className)}>
      <Siren aria-hidden className={kcn("size-3.5", stat && "kx-siren")} />{t(`ux.priority.${priority}`, { defaultValue: priority })}
    </span>
  );
}
export const priorityRank = (p?: string | null) => (p === "STAT" ? 0 : p === "URGENT" ? 1 : 2);

/** Sticky selection bar for bulk actions; announces the count politely. */
export function BulkBar({ count, label, onClear, clearLabel, children }: { count: number; label: string; onClear: () => void; clearLabel: string; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div role="region" aria-label={label} className="kx-bulk fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-border bg-card/95 px-4 py-3 shadow-kx-4 backdrop-blur-sm">
      <span aria-live="polite" className="text-sm font-semibold tabular-nums">{label}</span>
      <div className="ms-auto flex flex-wrap items-center gap-2">{children}<button type="button" onClick={onClear} className="h-9 rounded-lg px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{clearLabel}</button></div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

/** Small labelled value used in detail headers. */
export function Meta({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return <div className={className}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-0.5 text-sm font-medium">{children}</dd></div>;
}

/** Physical-label preview: white sticker with the Code 128 SVG from the API (always light, as it prints on paper). */
export function LabelPreview({ label, className }: { label: { svg: string; accessionNumber: string; patientName: string; tests: string[]; specimenType: string; orderNumber?: string }; className?: string }) {
  return (
    <figure className={kcn("w-full max-w-76 rounded-lg border border-slate-300 bg-white p-3 text-slate-900 shadow-kx-2", className)} style={{ colorScheme: "light" }}>
      <div className="flex items-baseline justify-between gap-2"><div className="truncate text-sm font-bold" dir="auto">{label.patientName}</div><div className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label.specimenType}</div></div>
      <div className="mt-0.5 truncate text-[11px] text-slate-600" dir="auto">{label.tests.join(" · ")}</div>
      <div className="my-2 flex justify-center [&_svg]:h-14 [&_svg]:w-full" role="img" aria-label={label.accessionNumber} dangerouslySetInnerHTML={{ __html: label.svg }} />
      <figcaption className="flex items-baseline justify-between font-mono text-sm font-semibold tracking-wider"><span>{label.accessionNumber}</span><span className="text-[10px] font-normal text-slate-500">{label.orderNumber}</span></figcaption>
    </figure>
  );
}

/** Number of results/analytes as a thin progress bar. */
export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={label}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} className="h-1.5 w-20 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} /></div>
      <span className="text-xs tabular-nums text-muted-foreground">{done}/{total}</span>
    </div>
  );
}

/** In-page PDF preview (authenticated blob in an iframe) with a download fallback. */
export function PdfPreview({ path, title, filename, onDownload }: { path: string; title: string; filename: string; onDownload: () => void }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["pdf-preview", path], queryFn: () => blobUrl(path), staleTime: 0, gcTime: 0 });
  useEffect(() => { const u = q.data; return () => { if (u) URL.revokeObjectURL(u); }; }, [q.data]);
  if (q.isLoading) return <div role="status" aria-busy="true" className="grid h-[70vh] place-items-center rounded-lg border border-border bg-muted/40"><Skeleton className="h-3/4 w-1/2" /></div>;
  if (q.isError || !q.data) return <EmptyState tone="error" title={t("ux.preview.failed")} action={<button type="button" className="text-sm font-medium text-primary underline" onClick={() => q.refetch()}>{t("ux.retry")}</button>} />;
  return (
    <div className="space-y-3">
      <iframe title={title} src={q.data} className="h-[68vh] w-full rounded-lg border border-border bg-white" />
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{filename}</p><button type="button" onClick={onDownload} className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm font-medium shadow-kx-1 hover:bg-accent"><Download aria-hidden className="size-4" />{t("ux.preview.download")}</button></div>
    </div>
  );
}
