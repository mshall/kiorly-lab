import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * ADR-011 / KX-01 / FD-02: no product reports to a tax authority. This test fails if code references tax-authority integrations.
 * VAT *lines* on invoices/exports are allowed; submission clients, signing certificates, UUID submission, fiscal devices are not.
 */
const FORBIDDEN = [
  /\beta[\s_-]?(e-?invoice|e-?receipt|portal|api)\b/i, /e-?invoic(e|ing)[\s_-]?(submission|submit|authority|portal)/i, /\bzatca\b/i, /\bfta\b.*(vat|tax)/i,
  /invoicing\.eta\.gov/i, /eta\.gov\.eg/i, /tax[\s_-]?authority[\s_-]?(api|client|submit|submission|status)/i, /fiscal[\s_-]?(device|printer|memory)/i,
  /e-?seal/i, /signing[\s_-]?certificate/i, /submit(Invoice|Receipt|ToTax)/i, /taxCompliance(Status)?/i,
];
const roots = [resolve(__dirname), resolve(__dirname, "../test"), resolve(__dirname, "../../web/src"), resolve(__dirname, "../prisma")];
const SKIP = ["no-tax-authority.node.test.ts", "node_modules", "dist", ".data", "locales"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.includes(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|json|sql|prisma|md)$/.test(p) ? [p] : [];
  });
}

describe("no-tax-authority (ADR-011)", () => {
  it("no source file references a tax-authority integration", () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        // lines that cite the ADR-011 prohibition itself (comments saying "never do X") are allowed
        const src = readFileSync(f, "utf8").split("\n").filter((l) => !/ADR-011|no-tax-authority/i.test(l)).join("\n");
        for (const re of FORBIDDEN) if (re.test(src)) offenders.push(`${f} ~ ${re}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
  it("the Prisma schema has no tax-authority fields (VAT lines only)", () => {
    const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
    assert.ok(/vatRatePercent/.test(schema));
    assert.ok(!/etaUuid|submissionUuid|taxAuthority|fiscal/i.test(schema.replace(/ADR-011[^\n]*/g, "")));
  });
  it("invoice export columns are plain VAT columns", () => {
    const src = readFileSync(resolve(__dirname, "modules/business/exports.service.ts"), "utf8");
    assert.match(src, /vat_rate_percent/);
  });
});
