import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { DEV_ORGS, DEV_USERS, type OrgSlug } from "./dev-test-users-data";

/** DEV ONLY quick-pick: one click signs in (dev-login, no password) as a synthetic lab persona. Loaded lazily from the login page behind `import.meta.env.DEV`. */
export default function DevTestUsers({ onPick, busy }: { onPick: (slug: string, email: string) => void; busy: boolean }) {
  const { i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const orgs = Object.keys(DEV_ORGS) as OrgSlug[];
  return (
    <section data-testid="dev-test-users" aria-labelledby="dev-test-users-h" className="mt-6 rounded-xl border border-dashed border-(--kx-coral-500) bg-card p-4 shadow-kx-1">
      <h2 id="dev-test-users-h" className="flex items-center gap-2 text-sm font-semibold">
        <span className="rounded-full bg-(--kx-coral-500) px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">DEV</span>
        {ar ? "مستخدمو الاختبار (للتطوير فقط)" : "Test users (dev only)"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{ar ? "للتطوير المحلي فقط: اضغط على مستخدم لتسجيل الدخول فورًا (بدون كلمة مرور). بيانات تجريبية." : "Local development only: click a user to sign in at once (no password). Synthetic data."}</p>
      {orgs.map((o) => (
        <div key={o} className="mt-3">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{ar ? DEV_ORGS[o].ar : DEV_ORGS[o].en}</h3>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DEV_USERS.filter((d) => d.slug === o).map((d) => (
              <li key={d.email}>
                <Button variant="outline" disabled={busy} data-testid={`dev-user-${d.email}`} onClick={() => onPick(d.slug, d.email)} className="h-auto min-h-12 w-full flex-col items-start gap-0 whitespace-normal px-3 py-1.5 text-start">
                  <span dir="auto" className="text-sm font-medium">{d.name}</span>
                  <span dir="auto" className="text-xs font-normal text-muted-foreground">{d.role}</span>
                  <span dir="ltr" className="break-all text-start text-[11px] font-normal text-muted-foreground">{d.email}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
