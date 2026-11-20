import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { KiorlyBrand } from "@/brand/ui-kit";

/** Waiting-room token display (full screen, large type, codes only: no patient names). */
export function QueueBoardPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [now, setNow] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(i); }, []);
  const board = useQuery({ queryKey: ["queue-board-display"], queryFn: () => api<any>("/queue/board"), refetchInterval: 5000 });
  const cur = board.data?.now ?? [];
  const waiting = board.data?.waiting ?? [];
  return (
    <div className="min-h-screen bg-[hsl(var(--background))] p-6 sm:p-10">
      <header className="mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4"><KiorlyBrand height={44} /><div><div className="text-xl font-semibold">{me?.tenant.name}</div><div className="text-sm text-muted-foreground">{t("rec.boardTitle")}</div></div></div>
        <div className="text-4xl font-semibold tabular-nums" aria-live="off">{now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</div>
      </header>
      <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
        <section aria-label={t("rec.nowServing")}>
          <h2 className="mb-4 text-lg font-semibold text-muted-foreground">{t("rec.nowServing")}</h2>
          {cur.length === 0 ? <p className="rounded-2xl border border-dashed border-border p-10 text-center text-2xl text-muted-foreground">{t("rec.emptyQueue")}</p> : (
            <ul className="grid gap-4 sm:grid-cols-2">{cur.slice(0, 6).map((c: any, i: number) => (
              <li key={c.id} className={`rounded-3xl border p-6 ${i === 0 ? "border-primary bg-primary text-primary-foreground shadow-[var(--kx-shadow-3)]" : "border-border bg-card"}`}>
                <div className="text-7xl font-black tracking-tight tabular-nums">{c.code}</div>
                <div className="mt-2 text-2xl font-semibold">{t("rec.counterN", { n: c.counter })}</div>
              </li>))}</ul>
          )}
        </section>
        <section aria-label={t("rec.waiting")}>
          <h2 className="mb-4 text-lg font-semibold text-muted-foreground">{t("rec.waiting")} <span className="tabular-nums">({waiting.length})</span></h2>
          <ul className="space-y-2">{waiting.slice(0, 10).map((w: any) => <li key={w.id} className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3"><span className="text-3xl font-bold tabular-nums">{w.code}</span><span className="text-sm text-muted-foreground">{w.priority !== "ROUTINE" ? t(`ux.priority.${w.priority}`, { defaultValue: w.priority }) : ""} · {w.waitingMinutes} {t("crit.min")}</span></li>)}</ul>
        </section>
      </div>
    </div>
  );
}
