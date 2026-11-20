// Usage: node scripts/axe-check.mjs — axe (wcag2a/aa/21aa) on every console page + the collector PWA, AR+EN x light+dark, against the live stack (:5191/:3200).
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const base = process.env.BASE ?? "http://localhost:5191";
const api = process.env.API ?? "http://127.0.0.1:3200/api/v1";
const routes = ["/", "/orders", "/accessioning", "/worklist", "/validation", "/qc", "/release", "/critical", "/billing", "/reports", "/catalogue", "/settings", "/phleb"];
const tok = async (role) => (await (await fetch(`${api}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgSlug: "demo-lab", email: `${role}@demo-lab.test` }) })).json()).token;
const token = await tok("director");
const browser = await chromium.launch();
let bad = 0;
for (const [lang, dark] of [["en", false], ["ar", false], ["en", true], ["ar", true]]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: dark ? "dark" : "light" });
  await ctx.addInitScript(([l, d]) => { try { localStorage.setItem("kiorly.lang", l); localStorage.setItem("kx-theme", d ? "dark" : "light"); } catch {} }, [lang, dark]);
  const page = await ctx.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("kiorly.lab.token", t), token);
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(500);
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const v = res.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
    if (v.length) { bad++; console.log(`FAIL ${lang}-${dark ? "dark" : "light"} ${r}`); for (const x of v) console.log("  ", x.id, x.nodes.length, x.nodes[0].html.slice(0, 140), JSON.stringify(x.nodes[0].any[0]?.data ?? "").slice(0, 120)); }
  }
  await ctx.close();
}
await browser.close();
console.log(bad ? `${bad} page(s) with serious/critical violations` : "CLEAN: 0 serious/critical on all pages, AR+EN, light+dark");
process.exit(bad ? 1 : 0);
