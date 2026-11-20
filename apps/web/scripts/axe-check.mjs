// Usage: node scripts/axe-check.mjs — axe (wcag2a/aa/21aa) on every console page + the collector PWA, AR+EN x light+dark, against the live stack (:5191/:3200).
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.BASE ?? "http://localhost:5191";
const api = process.env.API ?? "http://127.0.0.1:3200/api/v1";
const routes = ["/", "/orders", "/orders/new", "/accessioning", "/worklist", "/validation", "/qc", "/release", "/critical", "/billing", "/reports", "/catalogue", "/settings", "/phleb"];
// signed-out pages (login picker, onboarding, patient result link) and tabs/dialogs on the redesigned screens
const publicRoutes = ["/login", "/onboarding", "/r/invalid-token"];
const tok = async (role) => (await (await fetch(`${api}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgSlug: "demo-lab", email: `${role}@demo-lab.test` }) })).json()).token;
const token = await tok("director");
const orderId = (await (await fetch(`${api}/orders?status=RELEASED&limit=1`, { headers: { authorization: `Bearer ${token}` } })).json()).rows?.[0]?.id;
if (orderId) routes.splice(2, 0, `/orders/${orderId}`);
const browser = await chromium.launch();
let bad = 0;
const check = async (page, label) => {
  await page.waitForTimeout(500);
  const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const v = res.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
  if (v.length) { bad++; console.log(`FAIL ${label}`); for (const x of v) console.log("  ", x.id, x.nodes.length, x.nodes[0].html.slice(0, 140), JSON.stringify(x.nodes[0].any[0]?.data ?? "").slice(0, 120)); }
};
for (const [lang, dark, width] of [["en", false, 1280], ["ar", false, 1280], ["en", true, 1280], ["ar", true, 1280], ["en", false, 390], ["ar", true, 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 860 }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript(([l, d]) => { try { localStorage.setItem("kiorly.lang", l); localStorage.setItem("kx-theme", d ? "dark" : "light"); } catch {} }, [lang, dark]);
  const page = await ctx.newPage();
  const tag = `${lang}-${dark ? "dark" : "light"}-${width}`;
  // signed-out pages first
  for (const r of publicRoutes) { await page.goto(base + r, { waitUntil: "networkidle" }).catch(() => {}); await check(page, `${tag} ${r}`); }
  await page.evaluate((t) => localStorage.setItem("kiorly.lab.token", t), token);
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: "networkidle" }).catch(() => {});
    await check(page, `${tag} ${r}`);
  }
  // tabs and dialogs on the redesigned screens
  await page.goto(base + "/settings", { waitUntil: "networkidle" }).catch(() => {});
  await page.getByRole("tab").nth(1).click().catch(() => {}); await check(page, `${tag} /settings (RBAC matrix)`);
  await page.goto(base + "/billing", { waitUntil: "networkidle" }).catch(() => {});
  await page.getByRole("button", { name: /^(Pay|دفع)/ }).first().click().catch(() => {}); await check(page, `${tag} /billing (payment dialog)`);
  await page.goto(base + "/release", { waitUntil: "networkidle" }).catch(() => {});
  await page.locator("ul li button").first().click().catch(() => {}); await check(page, `${tag} /release (sign-off dialog)`);
  await page.goto(base + "/accessioning", { waitUntil: "networkidle" }).catch(() => {});
  await page.getByRole("dialog").count(); await page.locator("tbody tr button").first().click().catch(() => {}); await check(page, `${tag} /accessioning (specimen + label preview)`);
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} page(s) with serious/critical violations` : "CLEAN: 0 serious/critical on all pages, dialogs, AR+EN, light+dark, desktop + 390px");
process.exit(bad ? 1 : 0);
