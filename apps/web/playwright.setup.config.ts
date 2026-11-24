import { defineConfig, devices } from "@playwright/test";

/** Quick-setup E2E against the already running workspace stack (web :5193, API :3200). Fresh organisations only; never starts servers. */
const WEB = process.env.LAB_SETUP_WEB ?? "http://127.0.0.1:5193";
process.env.LAB_API_ORIGIN = process.env.LAB_API_ORIGIN ?? "http://127.0.0.1:3200";
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(quick-setup|zz-debug)\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: WEB, locale: "en", trace: "retain-on-failure", actionTimeout: 20_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
