/**
 * DEV ONLY synthetic Kiorly Lab dev-logins (kiorly-lab/DEMO_DATA.md, `npm run db:seed:demo`): 3 labs x 9 roles = 27, no password
 * (the API's AUTH_MODE=dev `POST /auth/dev-login {orgSlug,email}`, never enabled in production).
 * Imported only by ./dev-test-users.tsx, which the login page loads behind `import.meta.env.DEV`, so none of this reaches a production bundle.
 */
export type OrgSlug = "demo-lab" | "chain-lab" | "basic-lab";
export interface DevUser { email: string; slug: OrgSlug; name: string; role: string }
export const DEV_ORGS: Record<OrgSlug, { en: string; ar: string }> = {
  "demo-lab": { en: "Cairo Diagnostics Lab (PRO, full demo)", ar: "معمل القاهرة للتشخيص (PRO، العرض الكامل)" },
  "chain-lab": { en: "Delta Diagnostics Group (Chain / Enterprise)", ar: "مجموعة دلتا للتشخيص (سلسلة / Enterprise)" },
  "basic-lab": { en: "Starter Lab (Lite / Basic)", ar: "معمل المبتدئين (Lite / Basic)" },
};
const ROLES: Array<[string, string, string]> = [
  ["owner", "Layla Owner", "Owner"], ["director", "Dr. Karim Director", "Lab director"], ["signatory", "Dr. Salma Signatory", "Authorized signatory (pathologist)"],
  ["tech", "Omar Technologist", "Technologist"], ["phleb", "Nour Phlebotomist", "Phlebotomist (home collection)"], ["reception", "Mona Reception", "Reception"],
  ["manager", "Hassan Manager", "Branch manager"], ["supervisor", "Rania Supervisor", "Supervisor"], ["finance", "Fady Finance", "Finance"],
];
export const DEV_USERS: DevUser[] = (Object.keys(DEV_ORGS) as OrgSlug[]).flatMap((slug) => ROLES.map(([local, name, role]) => ({ email: `${local}@${slug}.test`, slug, name, role })));
