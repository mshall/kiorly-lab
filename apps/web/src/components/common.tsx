import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
import { ArrowDown, ArrowUp, ShieldAlert } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";
import { PageHeader as KitPageHeader } from "@/brand/ui-kit";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return <KitPageHeader title={title} description={sub} actions={actions} />;
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "muted", AWAITING_COLLECTION: "warn", COLLECTED: "info", IN_LAB: "info", PARTIALLY_RESULTED: "info", AWAITING_VALIDATION: "pulse", VALIDATED: "ok", RELEASED: "ok", CANCELLED: "muted",
  PENDING_COLLECTION: "warn", IN_TRANSIT: "info", RECEIVED: "info", PROCESSING: "info", STORED: "muted", DISPOSED: "muted", REJECTED: "crit",
  ENTERED: "warn", TECH_VALIDATED: "info", MEDICAL_VALIDATED: "ok", CORRECTED: "muted",
  PASS: "ok", WARNING: "warn", FAIL: "crit", OPEN: "crit", CLEARED: "ok", ACKNOWLEDGED: "ok", ESCALATED: "crit",
  ISSUED: "info", PARTIALLY_PAID: "warn", PAID: "ok", VOID: "muted",
  REQUESTED: "warn", SCHEDULED: "info", EN_ROUTE: "pulse", ARRIVED: "pulse", FAILED: "crit", ABORTED_UNSAFE: "warn",
  OK: "ok", AT_RISK: "warn", BREACHED: "crit", DONE_ON_TIME: "ok", DONE_LATE: "warn", NO_TARGET: "muted",
};

/** Localised status badge: looks up `status.<VALUE>` and falls back to the raw value. */
export function StatusBadge({ value }: { value: string | undefined | null }) {
  const { t } = useTranslation();
  if (!value) return null;
  return <Badge tone={STATUS_TONE[value] ?? "muted"}>{t(`status.${value}`, { defaultValue: value })}</Badge>;
}

export function FlagBadge({ flag }: { flag: string | undefined }) {
  const { t } = useTranslation();
  if (!flag || flag === "NORMAL") return <Badge tone="ok">{t("flag.NORMAL")}</Badge>;
  const label = t(`flag.${flag}`, { defaultValue: flag });
  if (flag.startsWith("CRITICAL")) {
    const Arrow = flag.includes("LOW") ? ArrowDown : ArrowUp;
    return <span className="kx-critical inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs" role="status"><ShieldAlert aria-hidden="true" className="size-3.5" /><Arrow aria-hidden="true" className="size-3.5" />{label}</span>;
  }
  const Arrow = /LOW|^L/.test(flag) ? ArrowDown : ArrowUp;
  return <Badge tone="warn" className="gap-1"><Arrow aria-hidden="true" className="size-3" />{label}</Badge>;
}

/** Result value with its flag: abnormal values are bold and coloured, criticals loud. Values are always tabular. */
export function ResultValue({ value, unit, flag }: { value: ReactNode; unit?: string | null; flag?: string }) {
  const crit = !!flag?.startsWith("CRITICAL");
  const abn = !!flag && flag !== "NORMAL";
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
      <span className={crit ? "text-lg font-extrabold tabular-nums text-[hsl(var(--danger-text))]" : abn ? "text-base font-bold tabular-nums text-[hsl(var(--warning))]" : "text-base font-semibold tabular-nums"}>{value}</span>
      {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
      <FlagBadge flag={flag} />
    </span>
  );
}

/** Shows an API error as a localised message (errors.<code>) with the server code as fallback. */
export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const e = error as ApiError;
  const code = e instanceof ApiError ? e.code : "UNKNOWN";
  const extra = e instanceof ApiError && e.body?.key ? ` (${e.body.key})` : "";
  return (
    <div role="alert" className="rounded-md bg-[hsl(var(--danger-text)/0.12)] px-3 py-2 text-sm text-[hsl(var(--danger-text))] ">
      {t(`errors.${code}`, { defaultValue: t("errors.generic", { code }) })}
      {extra}
    </div>
  );
}

export const errText = (t: (k: string, o?: Record<string, unknown>) => string, error: unknown): string => {
  const code = error instanceof ApiError ? error.code : "UNKNOWN";
  return t(`errors.${code}`, { defaultValue: t("errors.generic", { code }) });
};
