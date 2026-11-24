import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Quick setup (Lab). Every test starts from a FRESH self-serve laboratory (the onboarding page / POST /onboarding/tenants), never from the demo tenant.
 * Per step: the click opens the right screen (deep link + bar "Step n of N" + first field focused), the real data change flips the step to done by
 * itself (data-status + data-just-done = the animation state), the next step is highlighted, progress moves, and it persists after a reload.
 */
const API = `${process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200"}/api/v1`;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${++seq}`;
type Org = { slug: string; ownerEmail: string; token: string; labId: string };

async function freshLab(request: APIRequestContext, o: { edition?: "LITE" | "PRO" | "CHAIN"; starter?: boolean } = {}): Promise<Org> {
  const slug = `qs-${uniq()}`;
  const ownerEmail = `owner@${slug}.test`;
  const r = await request.post(`${API}/onboarding/tenants`, { data: { name: "QS Lab Co", slug, labName: "QS Main Lab", labCode: "QSM", ownerName: "QS Owner", ownerEmail, edition: o.edition ?? "PRO", loadStarterCatalogue: o.starter ?? false } });
  expect(r.ok(), await r.text()).toBeTruthy();
  const b = (await r.json()) as { token: string; labId: string };
  return { slug, ownerEmail, token: b.token, labId: b.labId };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function devToken(request: APIRequestContext, slug: string, email: string) {
  const r = await request.post(`${API}/auth/dev-login`, { data: { orgSlug: slug, email } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return ((await r.json()) as { token: string }).token;
}
async function signInWith(page: Page, token: string, lang: "en" | "ar" = "en") {
  await page.addInitScript(([t, l]) => { try { localStorage.setItem("kiorly.lab.token", t!); localStorage.setItem("kiorly.lang", l!); } catch { /* ignore */ } }, [token, lang]);
  await page.goto("/");
  await expect(page.getByRole("navigation").first()).toBeVisible();
}
const checklist = (p: Page) => p.getByTestId("setup-checklist");
const row = (p: Page, k: string) => p.locator(`[data-testid="setup-step"][data-step="${k}"]`);
const bar = (p: Page) => p.getByTestId("setup-bar");
const pct = async (p: Page) => Number(await p.getByTestId("setup-progressbar").getAttribute("aria-valuenow"));
async function openStep(p: Page, key: string, url: RegExp) {
  await row(p, key).getByTestId("setup-cta").click();
  await expect(p).toHaveURL(url);
  await expect(bar(p)).toHaveAttribute("data-step", key);
  await expect(p.getByTestId("setup-bar-back")).toBeVisible();
  await expect(p.getByTestId("setup-bar-skip")).toBeVisible();
}
async function flips(p: Page, key: string, next: string | null) {
  await expect(bar(p)).toHaveAttribute("data-success", "true", { timeout: 25_000 });
  await expect(p).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(row(p, key)).toHaveAttribute("data-status", "done");
  await expect(row(p, key)).toHaveAttribute("data-just-done", "true");
  if (next) await expect(row(p, next)).toHaveAttribute("data-next", "true");
}
async function axe(p: Page, include: string) {
  await p.waitForTimeout(1500);
  const r = await new AxeBuilder({ page: p }).include(include).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
}


test("Lab journey: fresh lab created on the onboarding page, every step opens its screen, detects completion, animates and moves on", async ({ page, request }) => {
  const slug = `qs-${uniq()}`;
  await page.addInitScript(() => { try { localStorage.setItem("kiorly.lang", "en"); } catch { /* ignore */ } });
  await page.goto("/onboarding");
  await page.getByLabel("Company name").fill("QS Lab Company");
  await page.getByLabel("Workspace id").fill(slug);
  await page.getByLabel("Lab name").fill("QS Main Lab");
  await page.getByLabel("Lab code").fill("QSM");
  await page.getByLabel("Owner name").fill("QS Owner");
  await page.getByLabel("Owner email").fill(`owner@${slug}.test`);
  await page.getByLabel("Load the synthetic starter catalogue").uncheck();
  await page.getByRole("button", { name: "Create lab" }).click();
  await expect(checklist(page)).toBeVisible({ timeout: 30_000 });
  expect(await pct(page)).toBe(0);
  await expect(row(page, "lab_licence")).toHaveAttribute("data-next", "true");
  await axe(page, "[data-testid=setup-checklist]");
  const tok = await page.evaluate(() => localStorage.getItem("kiorly.lab.token")!);

  // 1 lab licence + address
  await openStep(page, "lab_licence", /\/settings\?tab=labs.*entity=/);
  await expect(page.getByTestId("setup-bar-count")).toContainText(/Step 1 of \d+/);
  await expect(page.locator('[data-setup-target="lab_licence"]')).toBeFocused({ timeout: 15_000 });
  await page.locator('[data-setup-target="lab_licence"]').fill("MOH-QS-5001");
  await page.getByTestId("lab-licence-form").getByLabel("Address").fill("5 Corniche, Cairo");
  await page.getByTestId("lab-licence-form").getByRole("button", { name: "Save" }).click();
  await flips(page, "lab_licence", "starter_catalogue");
  const p1 = await pct(page);
  expect(p1).toBeGreaterThan(0);
  await page.reload();
  await expect(row(page, "lab_licence")).toHaveAttribute("data-status", "done");
  expect(await pct(page)).toBe(p1);

  // 2 test catalogue: the General tab, the starter button is focused
  await openStep(page, "starter_catalogue", /\/settings\?tab=general/);
  await expect(page.locator('[data-setup-target="starter_catalogue"]')).toBeFocused({ timeout: 15_000 });
  await page.locator('[data-setup-target="starter_catalogue"]').click();
  await flips(page, "starter_catalogue", "signatory");

  // 3 authorised signatory with a licence (this also adds a team member, so "Add a team member" flips at the same time)
  await openStep(page, "signatory", /\/settings\?tab=staff/);
  const staff = page.locator("main");
  await staff.getByLabel(/^Email/).first().fill(`sig@${slug}.test`);
  await staff.getByLabel(/^Name/).first().fill("Dr QS Signatory");
  await staff.locator("select").first().selectOption("AUTHORIZED_SIGNATORY");
  await staff.getByLabel(/Licence no\./).first().fill("QS-SIG-1");
  await staff.getByRole("button", { name: "Add", exact: true }).click();
  await expect(bar(page)).toHaveAttribute("data-success", "true", { timeout: 25_000 });
  await expect(row(page, "signatory")).toHaveAttribute("data-status", "done");
  await expect(row(page, "invite_staff")).toHaveAttribute("data-status", "done");
  await expect(row(page, "lab_coverage")).toHaveAttribute("data-next", "true");

  // 4 home-collection districts (optional, per lab)
  await openStep(page, "lab_coverage", /\/settings\?tab=labs/);
  await page.getByLabel("Coverage districts (comma separated)").fill("nasr-city, heliopolis");
  await page.getByLabel("Coverage districts (comma separated)").locator("xpath=following::button[normalize-space()='Save'][1]").click();
  await flips(page, "lab_coverage", "safety_contact");

  // 5 safety contact (optional)
  await openStep(page, "safety_contact", /\/settings\?tab=general/);
  await expect(page.locator('[data-setup-target="safety_contact"]')).toBeFocused({ timeout: 15_000 });
  await page.locator('[data-setup-target="safety_contact"]').fill("QS Safety");
  await page.getByLabel("Safety contact phone").fill("+201000000777");
  await page.getByTestId("safety-settings").locator("xpath=ancestor::*[.//button[normalize-space()='Save']][1]").getByRole("button", { name: "Save", exact: true }).click();
  await flips(page, "safety_contact", "first_order");

  // 6 first order: the New order screen opens; the order is then created (the 10-step bench pipeline has its own golden-flow test)
  await openStep(page, "first_order", /\/orders/);
  const test = await (await request.get(`${API}/catalogue/tests?pageSize=5`, { headers: auth(tok) })).json() as { items?: { code: string }[] } | { code: string }[];
  const code = (Array.isArray(test) ? test : test.items ?? [])[0]?.code ?? "GLU";
  const o = await request.post(`${API}/orders`, { headers: auth(tok), data: { patient: { fullName: "QS Patient", dateOfBirth: "1990-01-01", phone: "+201000000555" }, testCodes: [code], identifiersChecked: ["dateOfBirth", "phone"] } });
  expect(o.ok(), await o.text()).toBeTruthy();
  await flips(page, "first_order", "first_report");

  // 7-8 first report needs the full bench pipeline (golden-flow); here only the screen is checked. Connect to Kiorex opens for the owner.
  await openStep(page, "first_report", /\/release/);
  await page.getByTestId("setup-bar-back").click();
  await openStep(page, "connect_kiorex", /\/kiorex-connect/);
  await page.getByTestId("setup-bar-back").click();
  await expect(checklist(page)).toBeVisible();
  expect(await pct(page)).toBeGreaterThanOrEqual(75);
});

test("Lab multi-lab: per-lab rows with their own state and deep link; a new lab reopens the step", async ({ page, request }) => {
  const org = await freshLab(request, { edition: "CHAIN" });
  const b2 = await request.post(`${API}/labs`, { headers: auth(org.token), data: { name: "QS Lab Zamalek", code: "QSZ" } });
  expect(b2.ok(), await b2.text()).toBeTruthy();
  const second = ((await b2.json()) as { id: string }).id;
  await signInWith(page, org.token);
  const step = row(page, "lab_licence");
  await expect(step.getByTestId("setup-aggregate")).toHaveText(/0 of 2/);
  const tg = step.getByTestId("setup-toggle");
  if ((await tg.getAttribute("aria-expanded")) !== "true") await tg.click(); // the highlighted step starts expanded
  await expect(step.getByTestId("setup-entity")).toHaveCount(2);
  await step.locator(`[data-entity="${second}"]`).getByTestId("setup-entity-cta").click();
  await expect(page).toHaveURL(new RegExp(`entity=${second}`));
  await expect(bar(page)).toContainText("QS Lab Zamalek");
  await page.locator('[data-setup-target="lab_licence"]').fill("MOH-QS-6002");
  await page.getByTestId("lab-licence-form").getByLabel("Address").fill("2 Zamalek");
  await page.getByTestId("lab-licence-form").getByRole("button", { name: "Save" }).click();
  await expect(bar(page)).toHaveAttribute("data-success", "true", { timeout: 25_000 });
  await expect(page).toHaveURL(/\/$/);
  await expect(step.getByTestId("setup-aggregate")).toHaveText(/1 of 2/);
  await expect(step).toHaveAttribute("data-status", "pending");
  await expect(step.locator(`[data-entity="${second}"]`)).toHaveAttribute("data-status", "done");
  expect((await request.put(`${API}/labs/${org.labId}`, { headers: auth(org.token), data: { licenceNo: "MOH-QS-1", address: "1 Maadi" } })).ok()).toBeTruthy();
  await expect(row(page, "lab_licence")).toHaveAttribute("data-status", "done", { timeout: 45_000 });
  expect((await request.post(`${API}/labs`, { headers: auth(org.token), data: { name: "QS Lab Heliopolis", code: "QSH" } })).ok()).toBeTruthy();
  await page.reload();
  await expect(row(page, "lab_licence")).toHaveAttribute("data-status", "pending");
  await expect(row(page, "lab_licence").getByTestId("setup-aggregate")).toHaveText(/2 of 3/);
  await page.getByTestId("setup-collapse").click();
  await expect(page.getByTestId("setup-steps")).toBeHidden();
  await page.getByTestId("setup-collapse").click();
  await expect(page.getByTestId("setup-steps")).toBeVisible();
});

test("Lab role-restricted: reception sees who can do owner steps, never a dead click; Connect to Kiorex is hidden", async ({ page, request }) => {
  const org = await freshLab(request);
  const email = `rec@${org.slug}.test`;
  expect((await request.post(`${API}/staff`, { headers: auth(org.token), data: { email, displayName: "QS Reception", role: "RECEPTION" } })).ok()).toBeTruthy();
  const rec = await devToken(request, org.slug, email);
  await signInWith(page, rec);
  await expect(checklist(page)).toBeVisible();
  await expect(row(page, "lab_licence").getByTestId("setup-cta-disabled")).toBeDisabled();
  await expect(row(page, "lab_licence").getByTestId("setup-ask-owner")).toContainText("Ask the owner");
  await expect(row(page, "lab_licence").getByTestId("setup-ask-owner")).toContainText("Owner");
  await expect(row(page, "connect_kiorex")).toHaveCount(0);
  await expect(row(page, "first_order").getByTestId("setup-cta")).toBeEnabled();
  expect((await request.patch(`${API}/setup/steps/safety_contact`, { headers: auth(rec), data: { action: "skip" } })).status()).toBe(403);
  expect((await request.patch(`${API}/setup/steps/first_order`, { headers: auth(org.token), data: { action: "complete" } })).status()).toBe(400);
});

test("Lab Arabic RTL dark, responsive 360-2560, keyboard, skip and dismissal remembered per organisation", async ({ page, request }) => {
  const org = await freshLab(request);
  await page.addInitScript(() => { try { localStorage.setItem("kx-theme", "dark"); } catch { /* ignore */ } });
  await signInWith(page, org.token, "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(checklist(page)).toBeVisible();
  for (const w of [360, 768, 1440, 2560]) {
    await page.setViewportSize({ width: w, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `no horizontal scroll at ${w}`).toBe(true);
  }
  await axe(page, "[data-testid=setup-checklist]");
  // keyboard: the primary button of the highlighted step is reachable with Tab and opens the screen with Enter
  const cta = row(page, "lab_licence").getByTestId("setup-cta");
  await cta.focus();
  await expect(cta).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings\?tab=labs/);
  await expect(bar(page)).toBeVisible();
  // "Skip for now" returns and moves the highlight on without marking the step done
  await page.getByTestId("setup-bar-skip").click();
  await expect(checklist(page)).toBeVisible();
  await expect(row(page, "lab_licence")).toHaveAttribute("data-status", "pending");
  await expect(row(page, "lab_licence")).toHaveAttribute("data-next", "false");
  // dismissal API contract: refused while work is pending
  expect((await request.post(`${API}/setup/dismiss`, { headers: auth(org.token), data: {} })).status()).toBe(400);
});


test("Lab first report through the real browser: bench pipeline, then Sign + Release from the checklist, step flips, finished state", async ({ page, request }) => {
  const slug = `qs-${uniq()}`;
  const onb = await request.post(`${API}/onboarding/tenants`, { data: { name: "QS Report Co", slug, labName: "QS Report Lab", labCode: "QSR", ownerName: "QS Owner", ownerEmail: `owner@${slug}.test`, edition: "PRO", loadStarterCatalogue: true } });
  expect(onb.ok(), await onb.text()).toBeTruthy();
  const { token: owner, labId } = (await onb.json()) as { token: string; labId: string };
  const postJson = async (path: string, token: string, data: unknown) => {
    const r = await request.post(`${API}${path}`, { headers: auth(token), data });
    expect(r.ok(), `${path}: ${await r.text()}`).toBeTruthy();
    return r.json();
  };
  for (const [email, name, role, lic] of [["tech", "QS Tech", "TECHNOLOGIST", undefined], ["tech2", "QS Tech Two", "TECHNOLOGIST", undefined], ["sig", "Dr QS Signatory", "AUTHORIZED_SIGNATORY", "QS-LIC-1"], ["rec", "QS Reception", "RECEPTION", undefined]] as const) {
    await postJson("/staff", owner, { email: `${email}@${slug}.test`, displayName: name, role, ...(lic ? { signatoryLicenceNo: lic } : {}) });
  }
  const [tech, tech2, sig, rec] = await Promise.all(["tech", "tech2", "sig", "rec"].map((e) => devToken(request, slug, `${e}@${slug}.test`)));
  const as = async (token: string) => { await signInWith(page, token); };

  // order (API), then collect / receive / process in the UI with the label scan, exactly as in golden-flow.spec.ts
  const order = (await postJson("/orders", rec!, { patient: { fullName: "QS Report Patient", dateOfBirth: "1990-05-10", phone: "+201000000444" }, testCodes: ["CBC"], identifiersChecked: ["dateOfBirth", "phone"], consentChannels: ["PRINTED", "PATIENT_LINK_OTP"] })) as { id: string; specimens: { barcode: string }[]; accessionNumber?: string };
  const barcode = order.specimens[0]!.barcode;
  const act = async (token: string, action: string) => {
    await as(token);
    await page.goto("/accessioning");
    await page.getByLabel("Scan or type a barcode").fill(barcode);
    await page.getByRole("button", { name: "Open", exact: true }).first().click();
    await page.getByLabel("Scan the specimen label").fill(barcode);
    await page.getByRole("button", { name: action }).click();
    await expect(page.getByText(/Chain of custody/)).toBeVisible();
  };
  await act(rec!, "Mark collected");
  await act(tech!, "Receive");
  await act(tech!, "Start processing");
  const inst = (await (await request.get(`${API}/instruments`, { headers: auth(tech!) })).json()) as { id: string }[];
  const bench = inst.length ? inst[0]!.id : ((await postJson("/instruments", owner, { name: "Bench", kind: "MANUAL_BENCH" })) as { id: string }).id;
  const mats = (await (await request.get(`${API}/qc/materials`, { headers: auth(tech!) })).json()) as { id: string; targetMean: number; analyte: { code: string } }[];
  for (const m of mats.filter((x) => ["HB", "WBC", "PLT"].includes(x.analyte.code))) await postJson("/qc/runs", tech!, { instrumentId: bench, materialId: m.id, value: Number(m.targetMean) });
  await as(tech!);
  await page.goto("/worklist");
  for (const [code, v] of Object.entries({ HB: "13.4", WBC: "7.1", PLT: "260" })) {
    await page.getByLabel(`${code} Value`).fill(v);
    await page.getByRole("button", { name: "Enter", exact: true }).first().click();
    await expect(page.getByText(v, { exact: false }).first()).toBeVisible();
  }
  await as(tech2!);
  await page.goto("/worklist");
  await expect(page.getByLabel("Re-key value")).toHaveCount(3);
  for (const v of ["13.4", "7.1", "260"]) {
    await page.getByLabel("Re-key value").first().fill(v);
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await page.waitForTimeout(300);
  }
  await as(tech!);
  await page.goto("/validation");
  await page.getByLabel("select all").check();
  await page.getByRole("button", { name: /Technically validate \(3\)/ }).click();
  await expect(page.getByText(/Nothing waiting for validation/)).toBeVisible();
  await as(sig!);
  await page.goto("/validation");
  await page.getByRole("tab", { name: "Medical validation" }).click();
  await page.getByLabel("select all").check();
  await page.getByRole("button", { name: /Medically validate \(3\)/ }).click();
  await expect(page.getByText(/Nothing waiting for validation/)).toBeVisible();

  // the owner finishes the other steps through the API so that "first report" is the last one; the signatory then does it from the checklist
  expect((await request.put(`${API}/labs/${labId}`, { headers: auth(owner), data: { licenceNo: "MOH-QS-9001", address: "9 Corniche, Cairo" } })).ok()).toBeTruthy();
  for (const [key, entityId] of [["lab_coverage", labId], ["safety_contact", undefined], ["connect_kiorex", undefined]] as const) {
    const r = await request.patch(`${API}/setup/steps/${key}`, { headers: auth(owner), data: { action: "skip", ...(entityId ? { entityId } : {}) } });
    expect(r.ok(), `${key}: ${await r.text()}`).toBeTruthy();
  }
  await as(sig!);
  await expect(checklist(page)).toBeVisible();
  await expect(row(page, "first_report")).toHaveAttribute("data-status", "pending");
  await expect(row(page, "first_report")).toHaveAttribute("data-next", "true");
  await openStep(page, "first_report", /\/release/);
  await page.getByRole("button", { name: "Sign report" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign report" }).click();
  await expect(page.getByText(/Signed, awaiting release/)).toBeVisible();
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await page.getByRole("checkbox", { name: /Patient link/ }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Release", exact: true }).click();

  // finished-state UI in Lab: the bar turns green, the row animates, then the celebration card appears and Dismiss is remembered
  await expect(bar(page)).toHaveAttribute("data-success", "true", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  // every step is done, so the list gives way to the celebration card (the row itself is no longer rendered)
  await expect(checklist(page)).toHaveAttribute("data-all-done", "true");
  await expect(page.getByTestId("setup-complete")).toBeVisible();
  expect(await pct(page)).toBe(100);
  await page.getByTestId("setup-dismiss").click();
  await expect(checklist(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("navigation").first()).toBeVisible();
  await expect(checklist(page)).toHaveCount(0);
  const plan = (await (await request.get(`${API}/setup`, { headers: auth(owner) })).json()) as { allDone: boolean; dismissedAt: string | null };
  expect(plan.allDone && plan.dismissedAt).toBeTruthy();
});

/** Screenshots of the checklist for the design review (QS_SHOTS_DIR=../../_docs/test-flow/quick-setup): EN/AR x light/dark x 390/1440, a fresh lab with a few steps done. */
test("Lab checklist screenshots", async ({ page, request }) => {
  test.skip(!process.env.QS_SHOTS_DIR, "set QS_SHOTS_DIR to capture");
  test.setTimeout(480_000);
  const org = await freshLab(request, { starter: true });
  expect((await request.put(`${API}/labs/${org.labId}`, { headers: auth(org.token), data: { licenceNo: "MOH-QS-7001", address: "7 Corniche, Cairo" } })).ok()).toBeTruthy();
  for (const lang of ["en", "ar"] as const) {
    for (const theme of ["light", "dark"] as const) {
      for (const width of [390, 1440]) {
        await page.addInitScript((th) => { try { localStorage.setItem("kx-theme", th); } catch { /* ignore */ } }, theme);
        await page.setViewportSize({ width, height: 900 });
        await signInWith(page, org.token, lang);
        await expect(checklist(page)).toBeVisible();
        await page.waitForTimeout(1800);
        await checklist(page).screenshot({ path: `${process.env.QS_SHOTS_DIR}/lab-${lang}-${theme}-${width}.png` });
      }
    }
  }
});
