import { Building2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import "@/features/topbar/topbar-strings";

/**
 * Organisation identity for the top bar, the same look as the Kiorly Clinic (name + plan in one h-9 chip, truncates on small screens).
 * The plan comes with the signed-in session (`me.tenant.edition`), so it costs no extra request and shows for every role.
 */
export function OrgIdentityBar({ name, planLabel, className }: { name: string; planLabel?: string | null; className?: string }) {
  const { t } = useTranslation();
  const title = [name, planLabel ? `${t("topbar.plan")}: ${planLabel}` : null].filter(Boolean).join(" · ");
  return (
    <div className={cn("flex h-9 min-w-0 max-w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-2 shadow-sm sm:gap-2.5 sm:px-2.5", className)} title={title} aria-label={title} data-testid="header-org-identity">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20" aria-hidden><Building2 className="size-3.5" /></span>
      <span className="min-w-0 truncate text-xs font-semibold tracking-tight text-foreground sm:text-sm">{name}</span>
      {planLabel ? (
        <>
          <span className="h-4 w-px shrink-0 bg-border/80" aria-hidden />
          <span className="inline-flex max-w-[4.75rem] shrink-0 items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-sky-900 dark:text-sky-200 sm:max-w-[7.5rem]" data-testid="header-org-plan" title={t("topbar.planHint")}>
            <span className="hidden uppercase tracking-wide sm:inline rtl:normal-case rtl:tracking-normal">{t("topbar.plan")}</span>
            <span className="truncate">{planLabel}</span>
          </span>
        </>
      ) : null}
    </div>
  );
}
