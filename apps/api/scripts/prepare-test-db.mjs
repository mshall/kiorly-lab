// Applies migrations to the TEST database (never the dev database). In CI the service database is the test database.
import { spawnSync } from "node:child_process";

const local = "postgresql://postgres:postgres@127.0.0.1:5433/kiorly_lab_test?schema=public";
const url = process.env.TEST_DATABASE_URL ?? (process.env.CI ? process.env.DATABASE_URL : undefined) ?? local;
const r = spawnSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
process.exit(r.status ?? 1);
