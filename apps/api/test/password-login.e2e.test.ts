import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";
import { hashPassword } from "../src/auth/password";
import { setCoverageFetcher, type Coverage } from "../src/auth/mfa-policy";

/** Lab e-mail + password sign-in (founder decision 28 Nov 2026): login, lockout, uniform failures, change, reset, role refusal in production-like `both` mode. */
describe("Lab password sign-in", () => {
  let t: TestApp, lab: Lab;
  const saved = { ...process.env };
  const PW = "correct-horse-battery";
  before(async () => {
    process.env.SIGNIN_RATE_PER_IP_PER_MINUTE = "100000"; // the Postgres limiter keeps its counters across test runs
    t = await bootApp(); lab = await makeLab(t);
    for (const role of ["TECHNOLOGIST", "OWNER"] as const) await t.prisma.staffUser.update({ where: { id: lab.staff[role].id }, data: { passwordHash: await hashPassword(PW) } });
  });
  after(async () => { process.env = { ...saved }; await t.close(); });
  const email = (r: string) => `${r.toLowerCase()}@${lab.slug}.test`;
  const login = (r: string, password: string, extra: object = {}) => call(t, "POST", "/auth/login", { body: { email: email(r), password, ...extra }, headers: { "x-forwarded-for": "10.9.9.9" } });

  it("signs in with e-mail and password and the token works", async () => {
    const r = await login("TECHNOLOGIST", PW);
    assert.equal(r.status, 200);
    const me = await call(t, "GET", "/auth/me", { token: r.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, "TECHNOLOGIST");
  });
  it("works with the optional organisation slug and refuses a wrong slug", async () => {
    assert.equal((await login("TECHNOLOGIST", PW, { orgSlug: lab.slug })).status, 200);
    assert.equal((await login("TECHNOLOGIST", PW, { orgSlug: "no-such-org" })).status, 401);
  });
  it("answers the same 401 for a wrong password, an unknown e-mail and a user without a password", async () => {
    const a = await login("TECHNOLOGIST", "wrong-password-1");
    const b = await call(t, "POST", "/auth/login", { body: { email: `nobody-${lab.slug}@nowhere.test`, password: "whatever-pass-1" } });
    const c = await login("RECEPTION", PW);
    for (const r of [a, b, c]) { assert.equal(r.status, 401); assert.equal(r.body.code, "BAD_CREDENTIALS"); }
    assert.equal(a.body.message, b.body.message);
  });
  it("locks the account after the threshold and answers the uniform 401 even with the right password", async () => {
    process.env.LAB_LOGIN_LOCK_THRESHOLD = "3";
    const u = await t.prisma.staffUser.create({ data: { orgId: lab.orgId, email: `lock@${lab.slug}.test`, displayName: "Lock Test", role: "RECEPTION", passwordHash: await hashPassword(PW) } });
    const go = (pw: string) => call(t, "POST", "/auth/login", { body: { email: u.email, password: pw } });
    for (let i = 0; i < 3; i++) assert.equal((await go("wrong-password-x")).status, 401);
    assert.equal((await go(PW)).status, 401, "locked");
    await t.prisma.staffUser.update({ where: { id: u.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    assert.equal((await go(PW)).status, 200, "lock expired");
    delete process.env.LAB_LOGIN_LOCK_THRESHOLD;
  });
  it("changes the password (current required, policy enforced) and the old one stops working", async () => {
    const u = await t.prisma.staffUser.create({ data: { orgId: lab.orgId, email: `chg@${lab.slug}.test`, displayName: "Change Test", role: "RECEPTION", passwordHash: await hashPassword(PW) } });
    const tok = (await call(t, "POST", "/auth/login", { body: { email: u.email, password: PW } })).body.token;
    assert.equal((await call(t, "POST", "/auth/password/change", { token: tok, body: { currentPassword: "nope-nope-nope", newPassword: "another-long-pass-1" } })).status, 401);
    assert.equal((await call(t, "POST", "/auth/password/change", { token: tok, body: { currentPassword: PW, newPassword: "short" } })).body.code, "WEAK_PASSWORD");
    assert.equal((await call(t, "POST", "/auth/password/change", { token: tok, body: { currentPassword: PW, newPassword: "another-long-pass-1" } })).status, 200);
    assert.equal((await call(t, "POST", "/auth/login", { body: { email: u.email, password: PW } })).status, 401);
    assert.equal((await call(t, "POST", "/auth/login", { body: { email: u.email, password: "another-long-pass-1" } })).status, 200);
  });
  it("forgot gives one uniform answer; reset is single use, expires, and sets the new password", async () => {
    const u = await t.prisma.staffUser.create({ data: { orgId: lab.orgId, email: `rst@${lab.slug}.test`, displayName: "Reset Test", role: "RECEPTION", passwordHash: await hashPassword(PW) } });
    const known = await call(t, "POST", "/auth/password/forgot", { body: { email: u.email } });
    const unknown = await call(t, "POST", "/auth/password/forgot", { body: { email: `ghost-${lab.slug}@nowhere.test` } });
    assert.deepEqual(known.body, unknown.body);
    const row = await t.prisma.passwordResetToken.findFirstOrThrow({ where: { staffId: u.id } });
    assert.equal((await call(t, "POST", "/auth/password/reset", { body: { token: "x".repeat(43), newPassword: "brand-new-password" } })).body.code, "RESET_INVALID");
    // the plain token is only in the message; mint a known one for the test
    const { createHash } = await import("node:crypto");
    const token = `T${lab.slug}`.padEnd(43, "x");
    await t.prisma.passwordResetToken.update({ where: { id: row.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });
    assert.equal((await call(t, "POST", "/auth/password/reset", { body: { token, newPassword: "brand-new-password" } })).status, 200);
    assert.equal((await call(t, "POST", "/auth/password/reset", { body: { token, newPassword: "brand-new-password-2" } })).body.code, "RESET_INVALID", "single use");
    assert.equal((await call(t, "POST", "/auth/login", { body: { email: u.email, password: "brand-new-password" } })).status, 200);
  });
  it("owner staff creation stores a hash and never returns it; weak passwords are refused", async () => {
    const weak = await call(t, "POST", "/staff", { token: lab.tokens.OWNER, body: { email: `n1@${lab.slug}.test`, displayName: "New One", role: "RECEPTION", password: "short" } });
    assert.equal(weak.status, 400);
    const ok = await call(t, "POST", "/staff", { token: lab.tokens.OWNER, body: { email: `n2@${lab.slug}.test`, displayName: "New Two", role: "RECEPTION", password: "a-fine-long-password" } });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.passwordHash, undefined); assert.equal(ok.body.hasPassword, true);
    assert.equal((await call(t, "POST", "/auth/login", { body: { email: `n2@${lab.slug}.test`, password: "a-fine-long-password" } })).status, 200);
  });
  it("production-like both mode: privileged roles are told to use Passport, others sign in; password tokens never carry MFA", async () => {
    process.env.NODE_ENV = "production"; process.env.AUTH_MODE = "both"; process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";
    try {
      const owner = await login("OWNER", PW);
      assert.equal(owner.status, 403); assert.equal(owner.body.code, "PASSPORT_REQUIRED_FOR_ROLE");
      const tech = await login("TECHNOLOGIST", PW);
      assert.equal(tech.status, 200);
      const cfg = await call(t, "GET", "/auth/config");
      assert.equal(cfg.body.localLogin, true);
    } finally { process.env.NODE_ENV = "test"; delete process.env.AUTH_MODE; }
  });
  it("MFA follows the Passport policy: OFF = the owner may sign in with a password and works; ON = Passport required and old password sessions refused; unreadable = fail closed", async () => {
    process.env.NODE_ENV = "production"; process.env.AUTH_MODE = "both"; process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret"; process.env.KIOREX_OIDC_ISSUER = "http://passport.invalid";
    const cov = (mandatory: string[], partial: string[] = []): Coverage => ({ enabled: mandatory.length + partial.length > 0, types: { lab: { mandatory, partial } } });
    try {
      setCoverageFetcher(async () => cov([]));
      const off = await login("OWNER", PW);
      assert.equal(off.status, 200);
      assert.equal((await call(t, "GET", "/auth/me", { token: off.body.token })).status, 200, "an owner without the MFA claim works while the policy is off");
      setCoverageFetcher(async () => cov(["owner"]));
      const on = await login("OWNER", PW);
      assert.equal(on.status, 403); assert.equal(on.body.code, "PASSPORT_REQUIRED_FOR_ROLE");
      const old = await call(t, "GET", "/auth/me", { token: off.body.token });
      assert.equal(old.status, 403); assert.equal(old.body.code, "MFA_REQUIRED");
      assert.equal((await login("TECHNOLOGIST", PW)).status, 200);
      setCoverageFetcher(async () => cov([], ["*"])); // only some laboratories covered
      assert.equal((await login("OWNER", PW)).status, 403);
      setCoverageFetcher(async () => { throw new Error("down"); });
      assert.equal((await login("OWNER", PW)).status, 403);
    } finally { process.env.NODE_ENV = "test"; delete process.env.AUTH_MODE; delete process.env.KIOREX_OIDC_ISSUER; setCoverageFetcher(undefined); }
  });
  it("oidc mode: password sign-in is switched off", async () => {
    process.env.AUTH_MODE = "oidc";
    try { const r = await login("TECHNOLOGIST", PW); assert.equal(r.status, 404); assert.equal(r.body.code, "LOCAL_LOGIN_DISABLED"); } finally { delete process.env.AUTH_MODE; }
  });
});
