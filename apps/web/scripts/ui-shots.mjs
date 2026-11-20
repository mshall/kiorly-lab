// Usage: node scripts/ui-shots.mjs <before|after> — key screens (EN light/dark, AR light) into _docs/ui-review/lab.
import { chromium } from "@playwright/test";
import path from "node:path";
const phase = process.argv[2] ?? "after";
const base = process.env.BASE ?? "http://localhost:5191";
const api = process.env.API ?? "http://127.0.0.1:3200/api/v1";
const out = path.resolve(process.cwd(), "../../../_docs/ui-review/lab");
const routes = ["/", "/orders", "/worklist", "/validation", "/qc", "/critical", "/billing"];
const tok = async (role) => (await (await fetch(`${api}/auth/dev-login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgSlug: "demo-lab", email: `${role}@demo-lab.test` }) })).json()).token;
const token = await tok("director");
const browser = await chromium.launch();
for (const mode of [{ n: "en-light", lang: "en", dark: false }, { n: "en-dark", lang: "en", dark: true }, { n: "ar-light", lang: "ar", dark: false }]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: mode.dark ? "dark" : "light" });
  await ctx.addInitScript(([l, d]) => { try { localStorage.setItem("kiorly.lang", l); localStorage.setItem("kx-theme", d ? "dark" : "light"); } catch {} }, [mode.lang, mode.dark]);
  const page = await ctx.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  if (mode.n === "en-light") await page.screenshot({ path: `${out}/${phase}-login-${mode.n}.png` });
  await page.evaluate((t) => localStorage.setItem("kiorly.lab.token", t), token);
  for (const r of routes) {
    await page.goto(base + r, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${phase}-${(r.replace(/\//g, "_").slice(1) || "home")}-${mode.n}.png` });
  }
  await ctx.close();
}
await browser.close();
