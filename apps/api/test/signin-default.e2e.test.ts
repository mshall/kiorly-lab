import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

/** ADR-038 amendment: per-organisation default sign-in method (setting, audit, permission, public non-enumerating config). */
describe("default sign-in method per organisation", () => {
  let t: TestApp, lab: Lab, server: http.Server;
  const saved = { ...process.env };
  before(async () => {
    let issuer = "";
    server = http.createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if (req.url === "/.well-known/openid-configuration") return void res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.AUTH_ACCEPT_PASSPORT = "true"; process.env.KIOREX_OIDC_ISSUER = issuer;
    delete process.env.SIGNIN_DEFAULT_METHOD;
    t = await bootApp(); lab = await makeLab(t);
  });
  after(async () => { process.env = { ...saved }; await t.close(); server.close(); });
  const slug = async () => (await t.prisma.tenant.findFirstOrThrow({ where: { staff: { some: { id: lab.staff.OWNER.id } } } })).slug!;

  it("standalone org with no choice: PASSWORD; unknown org and no org: the deployment default, same shape", async () => {
    const s = await slug();
    const known = await call(t, "GET", `/auth/config?org=${s}`);
    assert.equal(known.body.passportAvailable, true);
    assert.equal(known.body.defaultMethod, "PASSWORD");
    const unknown = await call(t, "GET", "/auth/config?org=does-not-exist");
    assert.deepEqual(Object.keys(unknown.body).sort(), Object.keys(known.body).sort());
    assert.equal(unknown.body.defaultMethod, "PASSWORD");
    process.env.SIGNIN_DEFAULT_METHOD = "PASSPORT";
    assert.equal((await call(t, "GET", "/auth/config")).body.defaultMethod, "PASSPORT");
    assert.equal((await call(t, "GET", "/auth/config?org=does-not-exist")).body.defaultMethod, "PASSPORT");
    assert.equal((await call(t, "GET", `/auth/config?org=${s}`)).body.defaultMethod, "PASSWORD", "an org answers for itself, not the deployment");
    delete process.env.SIGNIN_DEFAULT_METHOD;
  });

  it("an org linked to Kiorex is PASSPORT automatically; the owner can override it, with an audit entry", async () => {
    const s = await slug();
    const me = await call(t, "GET", "/settings", { token: lab.tokens.OWNER });
    assert.equal(me.body.defaultSignInMethod, null);
    assert.equal(me.body.linkedToKiorex, false);
    await t.prisma.staffUser.update({ where: { id: lab.staff.TECHNOLOGIST.id }, data: { subject: `SUB-${s}` } });
    assert.equal((await call(t, "GET", `/auth/config?org=${s}`)).body.defaultMethod, "PASSPORT");
    assert.equal((await call(t, "GET", "/settings", { token: lab.tokens.OWNER })).body.effectiveSignInMethod, "PASSPORT");
    const set = await call(t, "PUT", "/settings", { token: lab.tokens.OWNER, body: { defaultSignInMethod: "PASSWORD" } });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.defaultSignInMethod, "PASSWORD");
    assert.equal((await call(t, "GET", `/auth/config?org=${s}`)).body.defaultMethod, "PASSWORD");
    const audit = await t.prisma.auditLog.findFirst({ where: { action: "settings.default_signin_method", entityId: (await t.prisma.tenant.findUniqueOrThrow({ where: { slug: s } })).id } });
    assert.deepEqual((audit?.meta as { from: unknown; to: unknown }), { from: null, to: "PASSWORD" });
    assert.equal((await call(t, "PUT", "/settings", { token: lab.tokens.OWNER, body: { defaultSignInMethod: null } })).body.defaultSignInMethod, null);
  });

  it("only owner/admin roles may change it; invalid values are refused", async () => {
    for (const role of ["RECEPTION", "TECHNOLOGIST", "BRANCH_MANAGER", "FINANCE"] as const) {
      assert.equal((await call(t, "PUT", "/settings", { token: lab.tokens[role], body: { defaultSignInMethod: "PASSPORT" } })).status, 403, role);
    }
    assert.equal((await call(t, "PUT", "/settings", { token: lab.tokens.LAB_DIRECTOR, body: { defaultSignInMethod: "PASSPORT" } })).status, 200);
    assert.equal((await call(t, "PUT", "/settings", { token: lab.tokens.OWNER, body: { defaultSignInMethod: "TELEPATHY" } })).status, 400);
    await call(t, "PUT", "/settings", { token: lab.tokens.OWNER, body: { defaultSignInMethod: null } });
  });
});
