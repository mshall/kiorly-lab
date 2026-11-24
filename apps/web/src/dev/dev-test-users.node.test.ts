import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEV_ORGS, DEV_USERS } from "./dev-test-users-data.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

test("dev test users are the 27 documented synthetic lab dev-logins", () => {
  assert.equal(DEV_USERS.length, 27);
  assert.equal(Object.keys(DEV_ORGS).length, 3);
  for (const u of DEV_USERS) assert.match(u.email, /^(owner|director|signatory|tech|phleb|reception|manager|supervisor|finance)@(demo|chain|basic)-lab\.test$/);
  assert.equal(new Set(DEV_USERS.map((u) => u.email)).size, 27);
});

test("the panel and its credentials are absent from a production build (and present in a development build)", { timeout: 240_000 }, () => {
  execFileSync("node", [path.join(here, "../../scripts/check-no-dev-test-users.mjs")], { stdio: "pipe", cwd: path.join(here, "../..") });
});

test("the DEV chip uses dark coral ink on the coral pill (axe colour-contrast AA), never white", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(path.join(here, "dev-test-users.tsx"), "utf8");
  const chip = /<span className="[^"]*">DEV<\/span>/.exec(src)?.[0] ?? "";
  assert.match(chip, /coral-950/);
  assert.doesNotMatch(chip, /text-white/);
});
