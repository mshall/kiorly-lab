import { config } from "dotenv";
import { resolve } from "node:path";

const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab?schema=public";
const LOCAL_TEST_DB = "postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab_test?schema=public";

/**
 * Loads apps/api/.env (if any) and applies local-dev defaults. Never put secrets in defaults.
 * Under NODE_ENV=test (outside CI) the database is ALWAYS the *_test database, so tests never touch dev data.
 */
export function loadEnv(): void {
  if (process.env.NODE_ENV === "test" && !process.env.CI) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? LOCAL_TEST_DB;
  }
  config({ path: resolve(__dirname, "../../.env") });
  process.env.DATABASE_URL ??= LOCAL_DB;
  process.env.PORT ??= "3200";
}
