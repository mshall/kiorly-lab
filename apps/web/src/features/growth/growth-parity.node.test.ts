import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { GROWTH_AR, GROWTH_EN } from "./growth-strings-data";

/** The wording the three Growth screens (Clinic, Pharmacy, Lab) share is one canonical manifest (workspace scripts/growth-parity), copied here verbatim. Edit it there and run scripts/sync-growth-parity.sh. */
const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(join(here, "growth-parity.json"), "utf8");
const manifest = JSON.parse(raw) as { concepts: Record<string, { en: string; ar: string; keys: { clinic: string; lab: string; pharmacy: string } }> };
const PRODUCT = "lab" as const;
const flat = (o: unknown, p = ""): Record<string, string> => (o && typeof o === "object" ? Object.entries(o).reduce<Record<string, string>>((a, [k, v]) => ({ ...a, ...flat(v, p ? `${p}.${k}` : k) }), {}) : { [p]: String(o) });

test("the parity manifest copy matches the recorded canonical hash", () => {
  assert.equal(createHash("sha256").update(raw).digest("hex"), readFileSync(join(here, "growth-parity.sha256"), "utf8").trim(), "diverged: run scripts/sync-growth-parity.sh in the workspace");
});
test("every shared Growth string of this product equals the canonical wording (EN and AR)", () => {
  const en = flat(GROWTH_EN), ar = flat(GROWTH_AR);
  for (const [concept, c] of Object.entries(manifest.concepts)) {
    const key = c.keys[PRODUCT].replace(/^growth\./, "");
    assert.equal(en[key], c.en, `${concept} (EN, ${key})`);
    assert.equal(ar[key], c.ar, `${concept} (AR, ${key})`);
  }
});
