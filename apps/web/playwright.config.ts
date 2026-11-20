import { defineConfig } from "@playwright/test";

/**
 * Golden-flow browser test. Uses the system Chrome (no browser download) and a dedicated test database.
 * Run: npm run e2e -w web   (needs Postgres on :5433 and `npm run db:setup`).
 */
/** Override the ports to run beside a dev stack: LAB_E2E_API_PORT / LAB_E2E_WEB_PORT (default 3200 / 5191); LAB_E2E_DATABASE_URL points the API at another database. */
const API_PORT = process.env.LAB_E2E_API_PORT ?? "3200";
const WEB_PORT = process.env.LAB_E2E_WEB_PORT ?? "5191";
process.env.LAB_API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
process.env.LAB_WEB_PORT = WEB_PORT;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, channel: "chrome", trace: "retain-on-failure", locale: "en" },
  webServer: [
    {
      command: "npm run build && node dist/main.js",
      cwd: "../api",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health/live`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: API_PORT, LISTEN_HOST: "127.0.0.1", TIMERS_ENABLED: "false", NODE_ENV: "development", DATABASE_URL: process.env.LAB_E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab_test?schema=public", STORAGE_DIR: "./.data/e2e-storage" },
    },
    { command: "npx vite", url: `http://127.0.0.1:${WEB_PORT}`, reuseExistingServer: false, timeout: 60_000 },
  ],
});
