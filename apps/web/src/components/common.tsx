import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/lib/api";
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
  return <Badge tone={flag.startsWith("CRITICAL") ? "crit" : "warn"}>{t(`flag.${flag}`, { defaultValue: flag })}</Badge>;
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
