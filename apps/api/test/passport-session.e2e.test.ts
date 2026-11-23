import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SignJWT, exportJWK, generateKeyPair, type JWK } from "jose";
import { randomUUID } from "node:crypto";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";

/**
 * Passport web session end to end inside the real app (fake Passport over HTTP): code exchange -> product session -> Passport revokes it
 * (back-channel logout, form-encoded exactly as the IdP sends it) -> the next request is refused. Also: deactivation and the max age.
 */
describe("Passport web session + back-channel logout", () => {
  let t: TestApp, lab: Lab, server: http.Server, issuer = "", priv: CryptoKey, jwk: JWK, nextSid = "";
  const saved = { ...process.env };
  const SUB = `SUB-${Math.random().toString(36).slice(2, 10)}`; // unique per run: the staff row is linked by subject
  const S = (sid: string) => `${SUB}:${sid}`; // session ids are unique per run too
  const PHONE = `+2010${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`; // unique per run: phone linking matches across tenants
  const sign = (claims: Record<string, unknown>, aud: string) =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer(issuer).setAudience(aud).setSubject(SUB).setIssuedAt().setExpirationTime("10m").sign(priv);

  before(async () => {
    const kp = await generateKeyPair("RS256", { extractable: true });
    priv = kp.privateKey as CryptoKey; jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      res.setHeader("content-type", "application/json");
      if (req.url === "/.well-known/openid-configuration") return void res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, end_session_endpoint: `${issuer}/session/end`, jwks_uri: `${issuer}/jwks` }));
      if (req.url === "/jwks") return void res.end(JSON.stringify({ keys: [jwk] }));
      if (req.url === "/token") {
        const p = new URLSearchParams(Buffer.concat(chunks).toString());
        const claims = { phone_number: PHONE, phone_number_verified: true, client_id: "kiorly-lab-web", sid: nextSid };
        return void res.end(JSON.stringify({ access_token: await sign(claims, "kiorex-api"), id_token: await sign({ ...claims, nonce: p.get("code_verifier")!.slice(0, 8) }, "kiorly-lab-web"), token_type: "Bearer" }));
      }
      res.statusCode = 404; res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    process.env.AUTH_ACCEPT_PASSPORT = "true"; process.env.KIOREX_OIDC_ISSUER = issuer;
    t = await bootApp(); lab = await makeLab(t);
    await t.prisma.staffUser.update({ where: { id: lab.staff.TECHNOLOGIST.id }, data: { phone: PHONE } });
  });
  after(async () => { process.env = { ...saved }; await t.close(); server.close(); });

  const signIn = async (sid: string) => {
    nextSid = sid;
    const verifier = `${randomUUID()}${randomUUID()}`.slice(0, 50);
    const r = await call(t, "POST", "/auth/oidc/exchange", { body: { code: "c", codeVerifier: verifier, redirectUri: "http://localhost:5193/auth/callback", nonce: verifier.slice(0, 8) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body as { token: string; expiresIn: number };
  };
  const logout = (form: Record<string, string>) => call(t, "POST", "/auth/oidc/backchannel-logout", { rawBody: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded" } });
  const logoutToken = (sid: string, over: { aud?: string; jti?: string } = {}) =>
    new SignJWT({ sid, sub: SUB, events: { "http://schemas.openid.net/event/backchannel-logout": {} } }).setProtectedHeader({ alg: "RS256", typ: "logout+jwt", kid: "k1" })
      .setIssuer(issuer).setAudience(over.aud ?? "kiorly-lab-web").setIssuedAt().setExpirationTime("2m").setJti(over.jti ?? randomUUID()).sign(priv);

  it("a session lasts the configured max age (default 1 h, not 8 h) and works until Passport revokes it", async () => {
    const s = await signIn(S("sid-a"));
    assert.equal(s.expiresIn, 3600);
    const me = await call(t, "GET", "/auth/me", { token: s.token });
    assert.equal(me.status, 200);
    const row = await t.prisma.passportSession.findFirstOrThrow({ where: { sid: S("sid-a") } });
    assert.ok(row.expiresAt.getTime() - Date.now() <= 3600_000 && row.expiresAt.getTime() - Date.now() > 3500_000);
  });

  it("back-channel logout for the sid ends exactly that session; a replay and an invalid token change nothing", async () => {
    const keep = await signIn(S("sid-keep"));
    const gone = await signIn(S("sid-gone"));
    const tok = await logoutToken(S("sid-gone"));
    assert.equal((await logout({ logout_token: tok })).status, 200);
    const after = await call(t, "GET", "/auth/me", { token: gone.token });
    assert.equal(after.status, 401); assert.equal(after.body.code, "SESSION_REVOKED");
    assert.equal((await call(t, "GET", "/auth/me", { token: keep.token })).status, 200);
    assert.equal((await logout({ logout_token: tok })).status, 400, "replayed jti");
    assert.equal((await logout({ logout_token: await logoutToken(S("sid-keep"), { aud: "kiorly-pharmacy-web" }) })).status, 400, "wrong audience");
    assert.equal((await logout({ logout_token: "a.b.c" })).status, 400);
    assert.equal((await logout({})).status, 400);
    assert.equal((await call(t, "GET", "/auth/me", { token: keep.token })).status, 200);
    assert.equal((await logout({ logout_token: await logoutToken(S("sid-gone")) })).status, 200, "a second logout of an already ended session is accepted (idempotent)");
    assert.equal((await t.prisma.auditLog.findMany({ where: { orgId: lab.orgId, action: "auth.session_revoked" } })).length, 1);
  });

  it("deactivating the staff member ends the session, and it stays ended after reactivation", async () => {
    const s = await signIn(S("sid-d"));
    const patch = await call(t, "PUT", `/staff/${lab.staff.TECHNOLOGIST.id}`, { token: lab.tokens.OWNER, body: { active: false } });
    assert.equal(patch.status, 200);
    assert.equal((await call(t, "GET", "/auth/me", { token: s.token })).status, 401);
    const rows = await t.prisma.passportSession.findMany({ where: { sid: S("sid-d") } });
    assert.ok(rows.every((r) => r.revokedAt && r.revokedReason === "staff_deactivated"));
    await t.prisma.staffUser.update({ where: { id: lab.staff.TECHNOLOGIST.id }, data: { active: true } });
    assert.equal((await call(t, "GET", "/auth/me", { token: s.token })).status, 401, "revoked stays revoked after reactivation");
  });
});
