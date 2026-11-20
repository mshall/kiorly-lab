import { expect, test } from "@playwright/test";

const API = `${process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200"}/api/v1`;
const slug = `lis${Date.now().toString(36)}`;

/**
 * Standalone-LIS smoke: a fresh (STANDALONE) tenant, patient registry round trip in the UI, then every LIS page loads in English and Arabic (RTL)
 * without console errors or failed API calls.
 */
test("standalone LIS: register a patient and open every module page in EN and AR without errors", async ({ page, request }) => {
  const onb = await (await request.post(`${API}/onboarding/tenants`, { data: { name: "LIS Smoke Lab", slug, labName: "Smoke Lab", labCode: "SML", ownerName: "Smoke Owner", ownerEmail: `owner@${slug}.test`, edition: "PRO", loadStarterCatalogue: true } })).json();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", (r) => { if (r.url().includes("/api/v1/") && r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto("/login");
  await page.evaluate((t) => { localStorage.setItem("kiorly.lab.token", t); localStorage.setItem("kiorly.lang", "en"); }, onb.token as string);

  // standalone badge + patient registry round trip
  await page.goto("/patients");
  await expect(page.getByText("Standalone", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New patient" }).click();
  await page.getByRole("textbox", { name: "Full name" }).fill("Smoke Patient");
  await page.getByRole("textbox", { name: "Phone", exact: true }).fill("+201000099001");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Smoke Patient" })).toBeVisible();
  await expect(page.getByText(/^MRN-\d{6}/).first()).toBeVisible();

  const routes = ["/", "/reception", "/orders", "/patients", "/referrers", "/accessioning", "/storage", "/worklist", "/microbiology", "/validation", "/release", "/critical", "/qc", "/quality", "/inventory", "/billing", "/finance", "/analytics", "/reports", "/catalogue", "/settings", "/queue-board"];
  for (const lang of ["en", "ar"]) {
    await page.evaluate((l) => localStorage.setItem("kiorly.lang", l), lang);
    for (const r of routes) {
      await page.goto(r);
      await expect(page.locator("main, h1, h2").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
    }
  }
  expect(errors, errors.join("\n")).toEqual([]);
});
