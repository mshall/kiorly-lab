import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signKiorlyRequest } from "@kiorex/contracts";
import { IntegrationAuthService, hmacRejected } from "./integration-auth.service";
import { seal } from "../common/secret-box";

/** The Lab answers a rejected partner request exactly like the Pharmacy's MarketplaceHmacGuard: 401 { statusCode, code: HMAC_REJECTED, message: reason }. */
const SECRET = "unit-test-partner-secret";
const client = { id: "ic1", key: "kl_unit", active: true, orgId: "o1", secretEnc: seal(SECRET) };
const prisma = { integrationClient: { findUnique: async ({ where }: { where: { key: string } }) => (where.key === client.key ? client : null) }, tenant: { findUnique: async () => ({ integrationMode: "CONNECTED" }) } };
const svc = () => new IntegrationAuthService(prisma as never);
const path = "/api/v1/integration/v1/tests";
const req = (headers: Record<string, string>) => ({ headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), method: "GET", originalUrl: path, rawBody: undefined }) as never;
const signed = (over: { secret?: string; timestamp?: number; nonce?: string } = {}) => {
  const s = signKiorlyRequest({ clientKey: client.key, clientSecret: over.secret ?? SECRET, method: "GET", path, body: "", timestamp: over.timestamp, nonce: over.nonce });
  const h = { ...s.headers }; delete h["X-Kiorly-Client-Secret"]; return h;
};
const reasonOf = async (p: Promise<unknown>) => { try { await p; } catch (e) { return (e as { getStatus(): number; getResponse(): unknown }); } throw new Error("expected a rejection"); };

describe("Lab partner HMAC rejection shape (same as the Pharmacy)", () => {
  it("hmacRejected builds the contract shape", () => { assert.deepEqual(hmacRejected("bad_signature").getResponse(), { statusCode: 401, code: "HMAC_REJECTED", message: "bad_signature" }); });
  it("accepts a correctly signed request", async () => { assert.equal((await svc().authenticate(req(signed()))).key, "kl_unit"); });
  it("names the reason for every kind of rejection, with the one code and no secret", async () => {
    const cases: Array<[string, Record<string, string>, string]> = [
      ["no headers at all", {}, "unknown client key"],
      ["unknown key", { ...signed(), "X-Kiorly-Client-Key": "nope" }, "unknown client key"],
      ["missing signature", (() => { const h = signed(); delete h["X-Kiorly-Signature"]; return h; })(), "missing_headers"],
      ["forged signature", signed({ secret: "not-the-secret" }), "bad_signature"],
      ["stale timestamp", signed({ timestamp: Date.now() - 3_600_000 }), "stale_timestamp"],
    ];
    for (const [label, headers, reason] of cases) {
      const e = await reasonOf(svc().authenticate(req(headers)));
      assert.equal(e.getStatus(), 401, label);
      assert.deepEqual(e.getResponse(), { statusCode: 401, code: "HMAC_REJECTED", message: reason }, label);
      assert.doesNotMatch(JSON.stringify(e.getResponse()), new RegExp(`${SECRET}|canonical`, "i"), label);
    }
  });
  it("rejects a replayed nonce with the same shape", async () => {
    const s = svc(); const h = signed({ nonce: "replay-1" });
    await s.authenticate(req(h));
    const e = await reasonOf(s.authenticate(req(h)));
    assert.deepEqual(e.getResponse(), { statusCode: 401, code: "HMAC_REJECTED", message: "nonce replay" });
  });
});
