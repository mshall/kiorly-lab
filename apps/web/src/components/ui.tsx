import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EmptyState } from "@/brand/ui-kit";
import { PulseLine } from "@/brand/components";

/** shadcn/ui-style primitives (hand-written, same token scheme as the Kiorly Clinical OS palette). */
const button = cva("inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-[background-color,box-shadow,transform] duration-150 ease-[var(--kx-ease-standard)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground shadow-[var(--kx-shadow-1)] hover:bg-[var(--kx-primary-hover)]",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "border border-input bg-card shadow-[var(--kx-shadow-1)] hover:bg-accent",
      ghost: "hover:bg-accent",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      pulse: "bg-primary text-primary-foreground shadow-[var(--kx-shadow-1)] hover:bg-[var(--kx-primary-hover)]",
    },
    size: { default: "h-10 px-4", sm: "h-9 px-3 text-xs", lg: "h-12 px-6 text-base", icon: "h-10 w-10" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button type="button" className={cn(button({ variant, size }), className)} {...p} />;
}

const field = "w-full rounded-lg border border-input bg-card px-3 text-sm shadow-[var(--kx-shadow-1)] transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input className={cn(field, "h-10", className)} {...p} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className={cn(field, "py-2", className)} {...p} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cn(field, "h-10", className)} {...p} />;
export const Label = ({ className, as, ...p }: React.LabelHTMLAttributes<HTMLLabelElement> & { as?: "span" }) => (as === "span" ? <span className={cn("mb-1 block text-xs font-medium text-muted-foreground", className)}>{p.children}</span> : <label className={cn("mb-1 block text-xs font-medium text-muted-foreground", className)} {...p} />);
export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  // implicit label association (control inside <label>) so screen readers and tests resolve the control by its label
  return (
    <div className={className}>
      <label className="block">
        <Label as="span">{label}</Label>
        {children}
      </label>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-xl border border-border/80 bg-card p-4 shadow-[var(--kx-shadow-1)]", className)} {...p} />;
export const CardTitle = ({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn("mb-3 text-sm font-semibold", className)} {...p} />;

const tones = {
  ok: "bg-[hsl(var(--success)/0.12)] text-[hsl(var(--success))] ring-1 ring-inset ring-[hsl(var(--success)/0.25)]",
  warn: "bg-[hsl(var(--warning)/0.14)] text-[hsl(var(--warning))] ring-1 ring-inset ring-[hsl(var(--warning)/0.3)]",
  crit: "bg-[hsl(var(--danger-text)/0.12)] text-[hsl(var(--danger-text))] ring-1 ring-inset ring-[hsl(var(--danger-text)/0.28)]",
  info: "bg-[hsl(var(--info)/0.12)] text-[hsl(var(--info))] ring-1 ring-inset ring-[hsl(var(--info)/0.25)]",
  muted: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  pulse: "bg-accent text-accent-foreground ring-1 ring-inset ring-primary/25",
} as const;
export type Tone = keyof typeof tones;
export const Badge = ({ tone = "muted", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) => (
  <span className={cn("inline-flex min-h-6 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)} {...p} />
);

export const Spinner = () => <PulseLine size={14} loop label="loading" />;
export const Empty = ({ children }: { children: ReactNode }) => <EmptyState compact title={children} />;

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--kx-overlay)] backdrop-blur-[2px] p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className={cn("max-h-[92vh] w-full overflow-auto rounded-t-2xl bg-card p-5 shadow-[var(--kx-shadow-4)] sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="close"><X className="h-4 w-4" /></Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", value === t.id ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("kx-sticky-head overflow-x-auto rounded-xl border border-border/80 shadow-[var(--kx-shadow-1)]", className)}>
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground rtl:normal-case rtl:tracking-normal">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2.5 text-start font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-3 py-2.5 align-middle", className)} {...p} />;

// ---- toasts
interface Toast { id: number; msg: string; tone: Tone }
const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, tone: Tone = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((t) => <div key={t.id} className={cn("pointer-events-auto rounded-lg px-4 py-2.5 text-sm font-medium shadow-[var(--kx-shadow-3)]", tones[t.tone])}>{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
