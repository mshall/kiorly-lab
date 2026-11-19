import { defineConfig } from "@playwright/test";

/**
 * Golden-flow browser test. Uses the system Chrome (no browser download) and a dedicated test database.
 * Run: npm run e2e -w web   (needs Postgres on :5433 and `npm run db:setup`).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: 0,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5191", channel: "chrome", trace: "retain-on-failure", locale: "en" },
  webServer: [
    {
      command: "npm run build && node dist/main.js",
      cwd: "../api",
      url: "http://127.0.0.1:3200/api/v1/health/live",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: "3200", LISTEN_HOST: "127.0.0.1", TIMERS_ENABLED: "false", NODE_ENV: "development", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab_test?schema=public", STORAGE_DIR: "./.data/e2e-storage" },
    },
    { command: "npx vite", url: "http://127.0.0.1:5191", reuseExistingServer: false, timeout: 60_000 },
  ],
});
