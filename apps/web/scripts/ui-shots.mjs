// Usage: node scripts/ui-shots.mjs <phase-tag> [route,route,...] — key screens into _docs/ui-review/lab.
// Modes: EN light/dark + AR light/dark at 1440 and a 390px phone set (EN light/dark, AR light). SHOTS_ROUTES overrides routes; SHOTS_MODES=en-light,... limits modes.
import { chromium } from "@playwright/test";
import path from "node:path";
const phase = process.argv[2] ?? "after";
const base = process.env.BASE ?? "http://localhost:5193";
const api = process.env.API ?? "http://127.0.0.1:3200/api/v1";
const out = path.resolve(process.cwd(), "../../../_docs/ui-review/lab");
const post = async (p, b) => (await fetch(`${api}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) })).json();
const tok = async (role) => (await post("/auth/dev-login", { orgSlug: "demo-lab", email: `${role}@demo-lab.test` })).token;
const token = await tok(process.env.SHOTS_ROLE ?? "director");
const get = async (p) => (await fetch(`${api}${p}`, { headers: { authorization: `Bearer ${token}` } })).json();
const orders = (await get("/orders?status=RELEASED")).rows ?? [];
const sample = orders[0]?.id;
const defaults = ["/login", "/", "/orders", ...(sample ? [`/orders/${sample}`] : []), "/accessioning", "/worklist", "/validation", "/qc", "/release", "/critical", "/billing", "/reports", "/settings", "/catalogue", "/phleb", "/onboarding"];
const routes = (process.argv[3] ?? process.env.SHOTS_ROUTES)?.split(",") ?? defaults;
const all = [
  { n: "en-light", lang: "en", dark: false, w: 1440, h: 900 }, { n: "en-dark", lang: "en", dark: true, w: 1440, h: 900 },
  { n: "ar-light", lang: "ar", dark: false, w: 1440, h: 900 }, { n: "ar-dark", lang: "ar", dark: true, w: 1440, h: 900 },
  { n: "m-en-light", lang: "en", dark: false, w: 390, h: 844 }, { n: "m-en-dark", lang: "en", dark: true, w: 390, h: 844 }, { n: "m-ar-light", lang: "ar", dark: false, w: 390, h: 844 },
];
const want = process.env.SHOTS_MODES?.split(",");
const browser = await chromium.launch();
for (const mode of all.filter((m) => !want || want.includes(m.n))) {
  const ctx = await browser.newContext({ viewport: { width: mode.w, height: mode.h }, colorScheme: mode.dark ? "dark" : "light" });
  await ctx.addInitScript(([l, d]) => { try { localStorage.setItem("kiorly.lang", l); localStorage.setItem("kx-theme", d ? "dark" : "light"); } catch {} }, [mode.lang, mode.dark]);
  const page = await ctx.newPage();
  for (const r of routes) {
    const route0 = r.split("@")[0]; const authed = !["/login", "/onboarding"].includes(route0);
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(([t, a]) => { if (a) localStorage.setItem("kiorly.lab.token", t); else localStorage.removeItem("kiorly.lab.token"); }, [token, authed]);
    const [route, at] = r.split("@");
    await page.goto(base + route, { waitUntil: "networkidle" }).catch(() => {});
    // "/phleb@2026-11-23": open the collector route on a day that has stops
    if (at) { await page.locator('input[type="date"]').first().fill(at).catch(() => {}); await page.waitForTimeout(700); }
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${phase}-${(route.replace(/\//g, "_").replace(/[a-z0-9]{20,}/, "x").slice(1) || "home")}-${mode.n}.png` });
  }
  await ctx.close();
}
await browser.close();
