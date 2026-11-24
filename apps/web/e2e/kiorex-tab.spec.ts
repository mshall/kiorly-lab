import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const API = process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200";
const tokens = new Map<string, string>();
const tokenOf = async (page: Page, email: string, orgSlug = "demo-lab") => { const k = `${orgSlug}|${email}`; if (!tokens.has(k)) tokens.set(k, ((await (await page.request.post(`${API}/api/v1/auth/dev-login`, { data: { orgSlug, email } })).json()) as { token: string }).token); return tokens.get(k)!; };
const signedIn = async (page: Page, email: string, lang: "en" | "ar", orgSlug = "demo-lab") => {
  const token = await tokenOf(page, email, orgSlug);
  await page.addInitScript(([t, l]) => { try { localStorage.setItem("kiorly.lab.token", t!); localStorage.setItem("kiorly.lang", l!); } catch { /* ignore */ } }, [token, lang]);
};

/** The "Connect to Kiorex" nav item is a state-aware front door (ADR-040). NOT_CONNECTED (basic-lab), LIVE (demo-lab, legacy-connected), pause/resume and the per-user card dismissal run against the REAL dev stack; IN_PROGRESS, WAITING and ATTENTION are mocked on a real session because producing them would mutate shared demo data and need Kiorex ops decisions; backend flows: e2e/test/24-kiorex-front-door.e2e.ts in the workspace repo. */
const SHOTS = process.env.KIOREX_TAB_SHOTS_DIR;
const shot = async (page: Page, name: string) => { if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `lab-${name}.png`), fullPage: true }); };
const KEYS = ["lab_site", "catalogue", "price_list", "hours_collection", "home_collection", "licence", "payout", "terms", "request", "live"];
const steps = (done: number, extra: Record<string, string> = {}) => KEYS.map((key, i) => ({ key, status: extra[key] ?? (i < done ? "done" : i === done ? "action_needed" : "blocked") }));
const door = (state: string, status: string, doneN: number, o: Record<string, unknown> = {}, extra: Record<string, string> = {}) => ({ state, status, legacy: false, started: state !== "NOT_CONNECTED", interestedAt: null, leadAt: null, month: null, recent: [], connect: { legacy: false, status, progress: Math.round((doneN / (KEYS.length - 1)) * 100), steps: steps(doneN, extra) }, ...o });
const axe = async (page: Page) => { await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity)); await page.waitForTimeout(250); const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).exclude('[data-testid="dev-test-users"]').analyze(); expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]); };
const noOverflow = async (page: Page) => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(1500); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); };
const mock = async (page: Page, d: unknown) => { await page.route(/\/api\/v1\/kiorex-connect\/front-door$/, (r) => r.fulfill({ json: d })); await page.route(/\/api\/v1\/kiorex-connect\/front-door\/(interest|start)$/, (r) => r.fulfill({ json: d })); };
const SOLO = { email: "owner@basic-lab.test", org: "basic-lab" }; // real stack: a standalone lab that never connected (NOT_CONNECTED), no mocks
const open = async (page: Page, lang: "en" | "ar" = "en", who: { email: string; org: string } = { email: "director@demo-lab.test", org: "demo-lab" }) => { await signedIn(page, who.email, lang, who.org); await page.goto("/kiorex-connect"); await expect(page.getByTestId("kiorex-state")).toBeVisible({ timeout: 60_000 }); };

test.describe("Connect to Kiorex front door (lab)", () => {
  test("1 not connected (REAL standalone lab, no mocks): landing, true benefits, how it works, readiness, reassurance, fees confirmed by the team, Start and Talk to us", async ({ page }) => {
    await open(page, "en", SOLO);
    await expect(page.getByRole("heading", { name: /Reach more (customers|patients) with Kiorex/ })).toBeVisible();
    await expect(page.locator('[data-testid^="benefit-"]')).toHaveCount(5);
    await expect(page.getByTestId("landing-how").locator("li")).toHaveCount(4);
    await expect(page.getByTestId("landing-readiness-count")).toContainText(/\d+ of/);
    await expect(page.getByTestId("landing-fee")).toContainText("confirmed by the Kiorex team");
    await expect(page.getByTestId("landing-reassure")).toContainText("reversible");
    await expect(page.getByTestId("landing-start")).toBeVisible();
    await shot(page, "1-not-connected-1440"); await axe(page);
  });
  test("1c Talk to us: inline form, consent and a contact required, payload", async ({ page }) => {
    await mock(page, door("NOT_CONNECTED", "STANDALONE", 2)); let sent: Record<string, unknown> | undefined;
    await page.route(/\/front-door\/talk$/, async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ json: door("NOT_CONNECTED", "STANDALONE", 2, { leadAt: new Date().toISOString() }) }); });
    await open(page); await page.getByTestId("landing-talk").click();
    await expect(page.getByTestId("talk-form")).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("talk-send")).toBeDisabled();
    await page.getByTestId("talk-phone").fill("+201000000123"); await page.getByTestId("talk-time").selectOption("EVENING");
    await expect(page.getByTestId("talk-send")).toBeDisabled(); await page.getByTestId("talk-consent").check(); await expect(page.getByTestId("talk-send")).toBeEnabled();
    await shot(page, "1-talk-form"); await axe(page); await page.getByTestId("talk-send").click();
    await expect(page.getByTestId("landing-lead-sent")).toBeVisible(); expect(sent).toMatchObject({ phone: "+201000000123", preferredTime: "EVENING", consent: true });
  });
  test("2 in progress: progress bar and the next step highlighted", async ({ page }) => {
    await mock(page, door("IN_PROGRESS", "STANDALONE", 3)); await open(page);
    await expect(page.getByTestId("kiorex-progress")).toBeVisible(); await expect(page.getByTestId("next-step")).toHaveAttribute("data-step", KEYS[3]!);
    await expect(page.getByTestId("panel-open-wizard")).toHaveAttribute("href", "/kiorex-connect/steps"); await shot(page, "2-in-progress-1440"); await axe(page);
  });
  test("3 waiting for review: status and what happens next", async ({ page }) => {
    await mock(page, door("WAITING", "REQUESTED", KEYS.length - 2, {}, { request: "waiting_kiorex", live: "blocked" })); await open(page);
    await expect(page.getByTestId("waiting-card").locator("li")).toHaveCount(3); await shot(page, "3-waiting-1440"); await axe(page);
  });
  for (const s of ["CHANGES_REQUESTED", "REJECTED", "PAUSED"]) test(`5 attention ${s}: decision banner and what is missing`, async ({ page }) => {
    await mock(page, door("ATTENTION", s, 3)); await open(page); await expect(page.getByTestId("connect-decision")).toBeVisible();
    if (s !== "PAUSED") await expect(page.getByTestId("attention-missing")).toBeVisible(); await shot(page, `5-attention-${s.toLowerCase()}-1440`); await axe(page);
  });
  test("4 live: dashboard with this month, listings, recent, settings link", async ({ page }) => {
    await mock(page, door("LIVE", "APPROVED", KEYS.length - 1, { month: { orders: 7, completed: 5, rejected: 0 }, recent: [{ id: "o1", createdAt: new Date().toISOString(), status: "VALIDATED", lab: "Main lab", collection: "HOME" }], labs: [{ id: "l1", name: "Main lab" }] }));
    await open(page);
    await expect(page.getByTestId("kiorex-live-dashboard")).toBeVisible(); await expect(page.getByTestId("live-recent")).toBeVisible(); await expect(page.getByTestId("live-settings")).toHaveAttribute("href", "/kiorex-connect/steps");
    await shot(page, "4-live-1440"); await axe(page);
  });
  for (const w of [360, 768, 1024, 1440, 2560]) test(`responsive ${w}px: no overflow, axe-clean`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 }); await open(page, "en", SOLO); await noOverflow(page);
    if (w === 360 || w === 2560) await shot(page, `1-not-connected-${w}`); await axe(page);
  });
  for (const theme of ["light", "dark"]) test(`Arabic RTL ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 }); if (theme === "dark") await page.addInitScript(() => { try { localStorage.setItem("kx-theme", "dark"); } catch { /* ignore */ } });
    await open(page, "ar", SOLO); await expect(page.locator("html")).toHaveAttribute("dir", "rtl"); await expect(page.getByRole("heading", { name: /اوصل إلى (عملاء|مرضى) أكثر مع كيوريكس/ })).toBeVisible();
    await noOverflow(page); await shot(page, `not_connected-ar-${theme}`); await axe(page);
  });
  test("home card (REAL): dismissal is stored per user on the server, survives a fresh browser, returns only on request; an old browser flag is migrated once", async ({ page, browser }) => {
    const H = async () => ({ authorization: `Bearer ${await tokenOf(page, SOLO.email, SOLO.org)}` });
    const keys = async () => ((await (await page.request.get(`${API}/api/v1/me/preferences/dismissed-cards`, { headers: await H() })).json()) as { keys: string[] }).keys;
    const put = async (k: string[]) => page.request.put(`${API}/api/v1/me/preferences/dismissed-cards`, { headers: await H(), data: { keys: k } });
    await put([]); await signedIn(page, SOLO.email, "en", SOLO.org); await page.goto("/");
    await expect(page.getByTestId("kiorex-home-card")).toBeVisible({ timeout: 60_000 }); await shot(page, "home-card"); await axe(page);
    await page.getByTestId("home-card-dismiss").click(); await expect(page.getByTestId("kiorex-home-card")).toHaveCount(0);
    await expect.poll(keys).toEqual(["kiorex-home"]);
    const ctx = await browser.newContext({ baseURL: page.url().split("/").slice(0, 3).join("/") }); const p2 = await ctx.newPage(); const tok = await tokenOf(page, SOLO.email, SOLO.org);
    await p2.addInitScript((t) => { try { localStorage.setItem("kiorly.lab.token", t); localStorage.setItem("kiorly.lang", "en"); } catch { /* ignore */ } }, tok);
    await p2.goto("/"); await p2.waitForLoadState("networkidle"); await expect(p2.getByTestId("kiorex-home-card")).toHaveCount(0); await ctx.close();
    await page.goto("/kiorex-connect"); await page.getByTestId("home-card-show").click(); await expect.poll(keys).toEqual([]);
    await page.goto("/"); await expect(page.getByTestId("kiorex-home-card")).toBeVisible();
    const me = await (await page.request.get(`${API}/api/v1/auth/me`, { headers: await H() })).json() as { user?: { id?: string }; id?: string };
    const id = me.user?.id ?? me.id ?? ""; expect(id).not.toBe("");
    await page.addInitScript(([i]) => { try { localStorage.setItem(`kiorex.homeCard.dismissed.${i}`, "1"); } catch { /* ignore */ } }, [id]);
    await page.goto("/"); await page.waitForLoadState("networkidle"); await expect(page.getByTestId("kiorex-home-card")).toHaveCount(0);
    await expect.poll(keys).toEqual(["kiorex-home"]);
    expect(await page.evaluate((i) => localStorage.getItem(`kiorex.homeCard.dismissed.${i}`), id)).toBeNull();
    await put([]);
  });
  test("live (REAL demo lab): the whole listing can be paused and resumed; no fee or rating tile is invented", async ({ page }) => {
    await open(page); await expect(page.getByTestId("kiorex-live-dashboard")).toBeVisible();
    await expect(page.getByTestId("live-deliveryFee")).toHaveCount(0); await expect(page.getByTestId("live-rating")).toHaveCount(0);
    await expect(page.getByTestId("live-listing-pause")).toHaveAttribute("data-paused", "false"); await shot(page, "4-live-real-1440"); await axe(page);
    try {
      await page.getByTestId("listing-pause").click(); await expect(page.getByTestId("live-listing-pause")).toHaveAttribute("data-paused", "true");
      await expect(page.getByTestId("listing-resume")).toBeVisible(); await shot(page, "4-live-real-paused-1440"); await axe(page);
      await page.reload(); await expect(page.getByTestId("live-listing-pause")).toHaveAttribute("data-paused", "true");
    } finally {
      await page.request.post(`${API}/api/v1/kiorex-connect/front-door/listing/resume`, { headers: { authorization: `Bearer ${await tokenOf(page, "director@demo-lab.test")}` }, data: {} });
    }
    await page.reload(); await expect(page.getByTestId("live-listing-pause")).toHaveAttribute("data-paused", "false");
  });
  test("a role without settings access does not see the nav item", async ({ page }) => {
    await signedIn(page, "reception@demo-lab.test", "en"); await page.goto("/"); await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('a[href="/kiorex-connect"]')).toHaveCount(0);
  });
});
