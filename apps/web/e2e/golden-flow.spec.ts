import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const API = `${process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200"}/api/v1`;
const slug = `e2e${Date.now().toString(36)}`;

async function post(r: APIRequestContext, path: string, token: string | null, data: unknown) {
  const res = await r.post(`${API}${path}`, { data, headers: token ? { authorization: `Bearer ${token}` } : {} });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return res.json();
}
const as = async (page: Page, token: string) => {
  await page.goto("/login");
  await page.evaluate((t) => { localStorage.setItem("kiorly.lab.token", t); localStorage.setItem("kiorly.lang", "en"); }, token);
};

test("golden flow: order -> collect -> QC -> results (dual control) -> validation -> signed report -> release -> patient OTP link", async ({ page, request }) => {
  // tenant + staff via API (bootstrapping); everything clinical happens through the UI
  const onb = await post(request, "/onboarding/tenants", null, { name: "E2E Lab", slug, labName: "E2E Main Lab", labCode: "E2E", ownerName: "E2E Owner", ownerEmail: `owner@${slug}.test`, edition: "PRO", loadStarterCatalogue: true });
  const owner = onb.token as string;
  const login = async (email: string) => (await post(request, "/auth/dev-login", null, { orgSlug: slug, email })).token as string;
  for (const [email, name, role, lic] of [["tech", "E2E Tech", "TECHNOLOGIST", undefined], ["tech2", "E2E Tech Two", "TECHNOLOGIST", undefined], ["sig", "Dr E2E Signatory", "AUTHORIZED_SIGNATORY", "E2E-LIC-1"], ["rec", "E2E Reception", "RECEPTION", undefined]] as const) {
    await post(request, "/staff", owner, { email: `${email}@${slug}.test`, displayName: name, role, ...(lic ? { signatoryLicenceNo: lic } : {}) });
  }
  const tech = await login(`tech@${slug}.test`);
  const tech2 = await login(`tech2@${slug}.test`);
  const sig = await login(`sig@${slug}.test`);
  const rec = await login(`rec@${slug}.test`);

  // 1. reception creates the order in the UI (two identifiers + consent)
  await as(page, rec);
  await page.goto("/orders/new");
  await page.getByRole("textbox", { name: "Full name" }).fill("Amira Golden");
  await page.locator('input[type="date"]').first().fill("1990-05-10");
  await page.getByRole("textbox", { name: "Phone", exact: true }).fill("+201000000123");
  await page.getByRole("checkbox", { name: "Date of birth" }).check();
  await page.getByRole("checkbox", { name: "Phone" }).check();
  await page.getByRole("checkbox", { name: /CBC/ }).check();
  await page.getByRole("checkbox", { name: "Printed report" }).check();
  await page.getByRole("checkbox", { name: "Patient link (OTP)" }).check();
  await page.getByRole("button", { name: "Create order" }).click();
  await expect(page).toHaveURL(/\/orders\/[a-z0-9]+$/);
  const orderUrl = page.url();
  const accession = (await page.locator("span.font-mono.font-semibold").first().textContent())!.trim();
  expect(accession).toMatch(/^E2E\d{10}$/);

  // 2. collect (reception) -> receive + process (technologist), all with the label scan
  const act = async (token: string, action: string) => {
    await as(page, token);
    await page.goto("/accessioning");
    await page.getByLabel("Scan or type a barcode").fill(accession);
    await page.getByRole("button", { name: "Open", exact: true }).first().click();
    await page.getByLabel("Scan the specimen label").fill(accession);
    await page.getByRole("button", { name: action }).click();
    await expect(page.getByText(/Chain of custody/)).toBeVisible();
  };
  await act(rec, "Mark collected");
  await act(tech, "Receive");
  await act(tech, "Start processing");
  // a wrong label is blocked in the UI (specimen is already processing, so open a fresh order's label check via the API instead)
  const o2 = await post(request, "/orders", rec, { patient: { fullName: "Label Check", dateOfBirth: "1991-01-01", phone: "+201000000321" }, testCodes: ["GLU"], identifiersChecked: ["dateOfBirth", "phone"] });
  await as(page, rec);
  await page.goto("/accessioning");
  await page.getByLabel("Scan or type a barcode").fill(o2.specimens[0].barcode);
  await page.getByRole("button", { name: "Open", exact: true }).first().click();
  await page.getByLabel("Scan the specimen label").fill("WRONG-LABEL");
  await page.getByRole("button", { name: "Mark collected" }).click();
  await expect(page.getByRole("alert")).toContainText("does not match");

  // 3. QC passes for the three analytes (API helper), then results entry in the UI with dual control
  const inst = (await (await request.get(`${API}/instruments`, { headers: { authorization: `Bearer ${tech}` } })).json()) as any[];
  const bench = inst.length ? inst[0].id : (await post(request, "/instruments", owner, { name: "Bench", kind: "MANUAL_BENCH" })).id;
  const mats = (await (await request.get(`${API}/qc/materials`, { headers: { authorization: `Bearer ${tech}` } })).json()) as any[];
  for (const m of mats.filter((x) => ["HB", "WBC", "PLT"].includes(x.analyte.code))) await post(request, "/qc/runs", tech, { instrumentId: bench, materialId: m.id, value: Number(m.targetMean) });

  await as(page, tech);
  await page.goto("/worklist");
  const values: Record<string, string> = { HB: "13.4", WBC: "7.1", PLT: "260" };
  for (const [code, v] of Object.entries(values)) {
    await page.getByLabel(`${code} Value`).fill(v);
    await page.getByRole("button", { name: "Enter", exact: true }).first().click();
    await expect(page.getByText(v, { exact: false }).first()).toBeVisible();
  }
  // the same person cannot confirm their own entry; a second technologist does
  await page.getByLabel("Re-key value").first().fill("13.4");
  await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
  await expect(page.getByText(/different person/i)).toBeVisible();
  await as(page, tech2);
  await page.goto("/worklist");
  await expect(page.getByLabel("Re-key value")).toHaveCount(3);
  for (const v of ["13.4", "7.1", "260"]) {
    await page.getByLabel("Re-key value").first().fill(v);
    await page.getByRole("button", { name: "Confirm", exact: true }).first().click();
    await page.waitForTimeout(300);
  }

  // 4. technical validation (UI), medical validation by the signatory (UI)
  await as(page, tech);
  await page.goto("/validation");
  await page.getByLabel("select all").check();
  await page.getByRole("button", { name: /Technically validate \(3\)/ }).click();
  await expect(page.getByText(/Nothing waiting for validation/)).toBeVisible();
  await as(page, sig);
  await page.goto("/validation");
  await page.getByRole("tab", { name: "Medical validation" }).click();
  await page.getByLabel("select all").check();
  await page.getByRole("button", { name: /Medically validate \(3\)/ }).click();
  await expect(page.getByText(/Nothing waiting for validation/)).toBeVisible();

  // 5. sign + release on consented channels (UI)
  await page.goto("/release");
  await page.getByRole("button", { name: "Sign report" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sign report" }).click(); // sign-off confirmation with the results summary
  await expect(page.getByText(/Signed, awaiting release/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Release", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Release", exact: true }).click();
  await expect(page.getByText("Kiorex vault")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Kiorex vault/ })).toBeDisabled(); // no consent recorded for this channel
  await page.getByRole("checkbox", { name: /Patient link/ }).check();
  await page.getByRole("dialog").getByRole("button", { name: "Release", exact: true }).click();
  await page.goto(orderUrl);
  await expect(page.getByText("Released").first()).toBeVisible();

  // 6. patient opens the secure link, gets an OTP in the (mock) dev inbox and downloads the PDF
  const inbox = (await (await request.get(`${API}/dev/inbox?purpose=RESULT_READY`, { headers: { authorization: `Bearer ${owner}` } })).json()) as any[];
  const link: string = inbox[0].params.link;
  await page.goto(new URL(link).pathname);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  let otp = "";
  await expect.poll(async () => {
    const msgs = (await (await request.get(`${API}/dev/inbox?purpose=REPORT_OTP`, { headers: { authorization: `Bearer ${owner}` } })).json()) as any[];
    otp = msgs[0]?.params?.otp ?? "";
    return otp;
  }).toMatch(/^\d{6}$/);
  await page.getByLabel("6-digit code").fill(otp);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Verify and download" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$|report/i);
});
