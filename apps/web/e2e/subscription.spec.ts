import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** SUB-01 plan and renewal screen on the seeded demo lab (PRO edition, auto-renew ON by default). */
const API = process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200";
const tokenFor = async (request: APIRequestContext, who: string) => (await (await request.post(`${API}/api/v1/auth/dev-login`, { data: { orgSlug: "demo-lab", email: `${who}@demo-lab.test` } })).json()).token as string;
const open = async (page: Page, request: APIRequestContext, lang: string, theme: string, width: number) => {
  const token = await tokenFor(request, "owner");
  await page.setViewportSize({ width, height: width === 320 ? 740 : 900 });
  await page.addInitScript(([t, l, th]) => { try { localStorage.setItem("kiorly.lab.token", t!); localStorage.setItem("kiorly.lang", l!); localStorage.setItem("kx-theme", th!); } catch { /* ignore */ } }, [token, lang, theme]);
  await page.goto("/plan");
  await expect(page.getByTestId("upgrade-plan")).toBeVisible({ timeout: 30_000 });
};
const axe = async (page: Page) => {
  await page.waitForTimeout(600); // let status chips and the theme cross-fade settle: axe measured contrast mid-transition (flaky color-contrast)
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
};
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

test.describe.configure({ mode: "serial" });
for (const lang of ["en", "ar"] as const) for (const width of [320, 1440]) {
  test(`plan page (${lang}, ${width}px): comparison, auto-renew; no overflow; axe clean`, async ({ page, request }) => {
    await open(page, request, lang, "light", width);
    await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    await expect(page.getByTestId("auto-renew-state")).toBeVisible();
    for (const e of ["LITE", "PRO", "CHAIN"]) await expect(page.getByTestId(`plan-col-${e}`)).toBeVisible();
    await expect(page.getByTestId("cell-home_collection-LITE")).toHaveAttribute("data-on", "0");
    await expect(page.getByTestId("cell-home_collection-PRO")).toHaveAttribute("data-on", "1");
    const text = await page.getByTestId("upgrade-plan").innerText();
    expect(text).not.toMatch(/\bsub\.[a-zA-Z_]+/);
    if (lang === "ar") expect(text).toMatch(/[؀-ۿ]/);
    await noOverflow(page);
    await axe(page);
    if (width === 1440) await page.screenshot({ path: `e2e/screenshots/sub01-plan-${lang}.png`, fullPage: true });
  });
}
test("dark mode axe", async ({ page, request }) => { await open(page, request, "en", "dark", 1440); await axe(page); });
test("turn auto-renew off: impact shown before confirming, confirmation needed, ends on period end; back on", async ({ page, request }) => {
  await open(page, request, "en", "light", 1440);
  const sw = page.getByRole("switch", { name: "Automatic renewal" });
  await sw.click();
  await expect(page.getByTestId("auto-renew-impact-lost")).toContainText("Home collection");
  await expect(page.getByTestId("auto-renew-confirm")).toBeDisabled();
  await page.getByTestId("auto-renew-understood").check();
  await page.getByTestId("auto-renew-confirm").click();
  await expect(page.getByTestId("auto-renew-state")).toContainText("moves to the free plan", { timeout: 15_000 });
  await sw.click({ force: true });
  await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
});
test("API: confirmation required; reception cannot change renewal", async ({ request }) => {
  const bad = await request.post(`${API}/api/v1/subscription/auto-renew`, { data: { enabled: false }, headers: { authorization: `Bearer ${await tokenFor(request, "owner")}` } });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).code).toBe("AUTO_RENEW_CONFIRMATION_REQUIRED");
  const r = await request.post(`${API}/api/v1/subscription/auto-renew`, { data: { enabled: false, confirmDowngrade: true }, headers: { authorization: `Bearer ${await tokenFor(request, "reception")}` } });
  expect([401, 403]).toContain(r.status());
});
