import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash, createHmac } from "node:crypto";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";
import { post } from "./helpers/hmac";
import { seal } from "../src/common/secret-box";

/** COM-3 (lab): disclosure and counsel status with the rate view, and the settlement statement through the signed Kiorex statement API (an in-process fake). Every text and figure is a TEST placeholder. */
describe("COM-3 lab: disclosure, counsel status, settlement statement", () => {
  let t: TestApp, f: Lab, other: Lab, kx: { key: string; secret: string }, fake: Server; const seen: { url: string; headers: Record<string, string | string[] | undefined> }[] = []; const WH = "whsec_com3_lab_test";
  const statement = (ref: string) => ({ orgRef: ref, period: { from: "2026-12-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" }, currency: "EGP", payoutMethod: "BANK_TRANSFER", onlineCollectionsMinor: 9000, cashVisitCommissionAccruedMinor: 0, cashVisitCommissionNettedMinor: 0, cashVisitCommissionOpenMinor: 0, cashVisitCharges: 0, deductions: { commissionMinor: 900, feesMinor: 100, refundsMinor: 0, chargebacksMinor: 0 }, commission: { totalMinor: 900, collectedMinor: 900, openMinor: 0, disputedOpen: 0 }, netPayableMinor: 8000, paidByBankTransferMinor: 8000, payouts: [{ payoutRef: "po1", paidAt: "2026-12-04T00:00:00.000Z", cashMinor: 8000, commissionDeductedMinor: 900, bankReference: "po1", reconciliation: "MATCHED" }], reconciliation: "MATCHED", future: { x: 1 } });
  before(async () => {
    t = await bootApp(); f = await makeLab(t); other = await makeLab(t);
    kx = (await call(t, "POST", "/integration-clients", { token: f.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
    fake = createServer((req, res) => { seen.push({ url: req.url ?? "", headers: req.headers }); const ref = decodeURIComponent((req.url ?? "").split("/settlement-statement/")[1]?.split(/[/?]/)[0] ?? ""); const csv = (req.url ?? "").includes("/export"); res.setHeader("content-type", csv ? "text/csv" : "application/json"); res.end(csv ? "item,amount,deducted,bankReference,status\r\nnetPayable,80.00,,,\r\n" : JSON.stringify(statement(ref))); });
    await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
    await t.prisma.integrationClient.updateMany({ where: { orgId: f.orgId, key: kx.key }, data: { kiorexBaseUrl: `http://127.0.0.1:${(fake.address() as { port: number }).port}`, webhookSecretEnc: seal(WH) } });
  });
  after(async () => { delete process.env.KIOREX_MODE; await new Promise((r) => fake.close(r)); await t.close(); });
  const view = (ref: string, version: string, extra: object = {}) => ({ orgRef: ref, product: "LAB", version, history: [{ version: 1, scope: "DEFAULT", kind: "RATE", effectiveFrom: "2020-01-01T00:00:00Z", reason: null, spec: { feeType: "PERCENT", percentBps: 800, flatMinor: null, minMinor: null, maxMinor: null, mode: null, graceDays: 4, invoiceDueDays: 9 } }], ...extra });
  const push = (body: object) => post(t, kx, "/integration/v1/commission-rates", body);
  const rate = (token: string) => call(t, "GET", "/growth/commission-rate", { token });
  const get = (token: string, path: string) => call(t, "GET", path, { token });

  it("a view without the new blocks shows no wording and no counsel chip; wording appears only when set; only the counsel status is kept", async () => {
    await push(view("lab_ref_1", "100"));
    let r = (await rate(f.tokens.OWNER)).body;
    assert.deepEqual([r.disclosure, r.counsel, r.params.graceDays, r.params.invoiceDueDays, r.params.retryDays], [null, null, 4, 9, null]);
    await push(view("lab_ref_1", "101", { disclosure: { rateDisclosure: { en: "", ar: "" }, termsSummary: { en: "", ar: "" }, wordingSet: false }, counsel: { status: "NOT_REVIEWED" } }));
    r = (await rate(f.tokens.OWNER)).body; assert.deepEqual([r.disclosure, r.counsel], [null, { status: "NOT_REVIEWED" }]);
    await push(view("lab_ref_1", "102", { disclosure: { rateDisclosure: { en: "TEST text", ar: "نص" }, termsSummary: { en: "", ar: "" } }, counsel: { status: "APPROVED", reviewerName: "Secret", documentId: "DOC-9", conditions: "hidden" }, unknownBlock: [] }));
    r = (await rate(f.tokens.OWNER)).body;
    assert.deepEqual(r.disclosure.rateDisclosure, { en: "TEST text", ar: "نص" }); assert.deepEqual(r.counsel, { status: "APPROVED" });
    assert.doesNotMatch(JSON.stringify(r), /Secret|DOC-9|hidden/);
    assert.doesNotMatch(JSON.stringify((await t.prisma.kiorexCommissionRateView.findUniqueOrThrow({ where: { orgId: f.orgId } })).view), /Secret|DOC-9|hidden/);
    assert.equal((await push(view("lab_ref_1", "103", { disclosure: "junk", counsel: 5 }))).status, 200);
    r = (await rate(f.tokens.OWNER)).body; assert.deepEqual([r.disclosure, r.counsel, r.state], [null, null, "SET"]);
    assert.equal((await rate(other.tokens.OWNER)).body.known, false);
  });

  it("mock mode invents nothing: 503 STATEMENT_NOT_CONNECTED", async () => {
    delete process.env.KIOREX_MODE;
    const r = await get(f.tokens.OWNER, "/growth/commission-statement?period=2026-12");
    assert.equal(r.status, 503); assert.equal(r.body.code ?? r.body.message?.code, "STATEMENT_NOT_CONNECTED");
  });

  it("real mode: the statement comes from the Kiorex statement API with the partner HMAC; roles, isolation, CSV, bad period", async () => {
    process.env.KIOREX_MODE = "real";
    const ok = await get(f.tokens.OWNER, "/growth/commission-statement?period=2026-12");
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.source, ok.body.orgRef, ok.body.netPayableMinor, ok.body.deductions.feesMinor, ok.body.reconciliation, ok.body.payouts[0].bankReference, ok.body.period.key], ["KIOREX", "lab_ref_1", 8000, 100, "MATCHED", "po1", "2026-12"]);
    assert.equal("future" in ok.body, false);
    const call1 = seen.at(-1)!; const h = call1.headers; const path = call1.url.split("?")[0]!;
    assert.equal(path, "/api/v1/admin/commissions/settlement-statement/lab_ref_1"); assert.equal(h["x-kiorly-org-ref"], "lab_ref_1"); assert.equal(h["x-kiorly-client-key"], kx.key);
    assert.equal(h["x-kiorly-signature"], createHmac("sha256", WH).update(`${h["x-kiorly-timestamp"]}\n${h["x-kiorly-nonce"]}\nGET\n${path}\n${createHash("sha256").update("").digest("hex")}`).digest("base64url"));
    assert.ok(call1.url.includes("from=2026-12-01") && call1.url.includes("to=2027-01-01"));
    for (const r of ["LAB_DIRECTOR", "BRANCH_MANAGER", "FINANCE"] as const) assert.equal((await get(f.tokens[r]!, "/growth/commission-statement?period=2026-12")).status, 200, r);
    for (const r of ["RECEPTION", "SUPERVISOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST"] as const) assert.equal((await get(f.tokens[r]!, "/growth/commission-statement?period=2026-12")).status, 403, r);
    assert.equal((await get(f.tokens.OWNER, "/growth/commission-statement?period=2026-13")).status, 400);
    assert.equal((await get(other.tokens.OWNER, "/growth/commission-statement?period=2026-12")).status, 503);
    const csv = await get(f.tokens.OWNER, "/growth/commission-statement/2026-12/export.csv");
    assert.equal(csv.status, 200); assert.match(JSON.stringify(csv.body ?? csv.text ?? ""), /netPayable/);
    assert.equal((await get(f.tokens.RECEPTION, "/growth/commission-statement/2026-12/export.csv")).status, 403);
    assert.ok(await t.prisma.auditLog.findFirst({ where: { orgId: f.orgId, action: "kiorex.commission_statement.exported" } }));
    await t.prisma.integrationClient.updateMany({ where: { orgId: f.orgId, key: kx.key }, data: { kiorexBaseUrl: "http://127.0.0.1:1" } });
    const down = await get(f.tokens.OWNER, "/growth/commission-statement?period=2026-12");
    assert.equal(down.status, 503); assert.equal(down.body.code ?? down.body.message?.code, "STATEMENT_UNAVAILABLE");
  });
});
