import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

describe("auth, tenancy isolation, RBAC, audit, catalogue versioning, onboarding", () => {
  let t: TestApp;
  let a: Lab;
  let b: Lab;
  before(async () => {
    t = await bootApp();
    a = await makeLab(t);
    b = await makeLab(t);
  });
  after(async () => t.close());

  it("requires a valid JWT (aud/iss/exp/signature); health and public routes stay open", async () => {
    assert.equal((await call(t, "GET", "/orders")).status, 401);
    assert.equal((await call(t, "GET", "/orders", { token: "garbage" })).status, 401);
    const secret = new TextEncoder().encode(process.env.JWT_DEV_SECRET ?? "dev-only-secret-change-me-dev-only-secret");
    const mk = (iss: string, aud: string, exp = "1h", key = secret) => new SignJWT({ staffId: a.staff.OWNER.id }).setProtectedHeader({ alg: "HS256" }).setSubject("x").setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);
    assert.equal((await call(t, "GET", "/auth/me", { token: await mk("kiorly-lab-dev", "kiorly-lab") })).status, 200);
    assert.equal((await call(t, "GET", "/auth/me", { token: await mk("evil", "kiorly-lab") })).status, 401, "wrong issuer");
    assert.equal((await call(t, "GET", "/auth/me", { token: await mk("kiorly-lab-dev", "other-app") })).status, 401, "wrong audience");
    assert.equal((await call(t, "GET", "/auth/me", { token: await mk("kiorly-lab-dev", "kiorly-lab", "-1h") })).status, 401, "expired");
    assert.equal((await call(t, "GET", "/auth/me", { token: await mk("kiorly-lab-dev", "kiorly-lab", "1h", new TextEncoder().encode("another-secret-another-secret-123456")) })).status, 401, "bad signature");
    assert.equal((await call(t, "GET", "/health/live")).status, 200);
    await t.prisma.staffUser.update({ where: { id: a.staff.RECEPTION.id }, data: { active: false } });
    assert.equal((await call(t, "GET", "/orders", { token: a.tokens.RECEPTION })).status, 401, "deactivated staff are locked out immediately");
    await t.prisma.staffUser.update({ where: { id: a.staff.RECEPTION.id }, data: { active: true } });
  });

  it("every read and write is tenant-scoped: tenant B cannot see or touch tenant A's records", async () => {
    const f = await makeOrder(t, a, ["CBC"]);
    const sp = f.specimens[0];
    const patient = f.order.patient.id;
    const checks: [string, string, unknown?][] = [
      ["GET", `/orders/${f.orderId}`], ["GET", `/specimens/${sp.id}`], ["GET", `/specimens/${sp.id}/custody`], ["GET", `/specimens/${sp.id}/label`],
      ["GET", `/patients/${patient}`], ["GET", `/orders/${f.orderId}/results`], ["GET", `/orders/${f.orderId}/report-readiness`], ["GET", `/orders/${f.orderId}/reports`],
    ];
    for (const [m, p] of checks) assert.equal((await call(t, m, p, { token: b.tokens.OWNER })).status, 404, `${m} ${p}`);
    assert.equal((await call(t, "POST", `/specimens/${sp.id}/collect`, { token: b.tokens.OWNER, body: { scannedBarcode: sp.barcode } })).status, 404);
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/cancel`, { token: b.tokens.OWNER, body: {} })).status, 404);
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: b.tokens.OWNER })).status, 404);
    assert.equal((await call(t, "POST", "/orders", { token: b.tokens.OWNER, body: { patientId: patient, testCodes: ["GLU"] } })).status, 404, "cannot attach another tenant's patient");
    assert.equal((await call(t, "POST", "/qc/runs", { token: b.tokens.OWNER, body: { instrumentId: a.instruments.bench, materialId: b.materials.HB.l1, value: 14 } })).status, 404);
    assert.equal((await call(t, "POST", "/qc/runs", { token: b.tokens.OWNER, body: { instrumentId: b.instruments.bench, materialId: a.materials.HB.l1, value: 14 } })).status, 404);
    const list = await call(t, "GET", "/orders", { token: b.tokens.OWNER });
    assert.ok(list.body.rows.every((o: any) => o.orgId === b.orgId));
    assert.equal((await call(t, "GET", "/catalogue/tests", { token: b.tokens.OWNER })).body.every((x: any) => x.orgId === b.orgId), true);
    assert.equal((await call(t, "GET", "/audit-logs", { token: b.tokens.OWNER })).body.every((x: any) => x.orgId === b.orgId), true);
    // spoofed tenant headers are ignored
    const spoof = await call(t, "GET", `/orders/${f.orderId}`, { token: b.tokens.OWNER, headers: { "x-org-id": a.orgId } });
    assert.equal(spoof.status, 404);
  });

  it("RBAC: each role can do its job and nothing more", async () => {
    const f = await makeOrder(t, a, ["GLU"]);
    const sp = f.specimens[0];
    const st = (m: string, p: string, role: keyof Lab["tokens"], body?: unknown) => call(t, m, p, { token: a.tokens[role], body }).then((r) => r.status);
    assert.equal(await st("POST", "/orders", "PHLEBOTOMIST", { patient: { fullName: "X Y" }, testCodes: ["GLU"] }), 403);
    assert.equal(await st("POST", `/specimens/${sp.id}/collect`, "PHLEBOTOMIST", { scannedBarcode: sp.barcode }), 201);
    assert.equal(await st("POST", `/specimens/${sp.id}/receive`, "RECEPTION", { scannedBarcode: sp.barcode }), 403);
    assert.equal(await st("POST", `/specimens/${sp.id}/receive`, "TECHNOLOGIST", { scannedBarcode: sp.barcode }), 201);
    assert.equal(await st("POST", "/qc/runs", "RECEPTION", { instrumentId: a.instruments.bench, materialId: a.materials.GLU.l1, value: 100 }), 403);
    assert.equal(await st("GET", "/invoices", "TECHNOLOGIST"), 403);
    assert.equal(await st("GET", "/invoices", "RECEPTION"), 200);
    assert.equal(await st("GET", "/staff", "RECEPTION"), 403);
    assert.equal(await st("GET", "/audit-logs", "TECHNOLOGIST"), 403);
    assert.equal(await st("GET", "/audit-logs", "AUTHORIZED_SIGNATORY"), 200);
    assert.equal(await st("PUT", "/settings", "BRANCH_MANAGER", { vatRatePercent: 0 }), 403);
    assert.equal(await st("POST", `/analytes/${a.analytes.GLU}/auto-verification`, "OWNER"), 404);
  });

  it("privileged roles need an MFA claim when enforcement is on (production behaviour, switched on for the test)", async () => {
    process.env.FORCE_PRIVILEGED_MFA = "true";
    try {
      const noMfa = await t.tokens.signDev({ staffId: a.staff.AUTHORIZED_SIGNATORY.id, amr: ["pwd"] });
      const r = await call(t, "GET", "/auth/me", { token: noMfa });
      assert.equal(r.status, 403);
      assert.equal(r.body.code, "MFA_REQUIRED");
      assert.equal((await call(t, "GET", "/auth/me", { token: a.tokens.AUTHORIZED_SIGNATORY })).status, 200);
      const recepNoMfa = await t.tokens.signDev({ staffId: a.staff.RECEPTION.id, amr: ["pwd"] });
      assert.equal((await call(t, "GET", "/auth/me", { token: recepNoMfa })).status, 200, "non-privileged roles are not MFA-gated");
    } finally {
      delete process.env.FORCE_PRIVILEGED_MFA;
    }
  });

  it("audit: state changes write append-only audit rows without PHI", async () => {
    const f = await makeOrder(t, a, ["GLU"]);
    await toProcessing(t, a, f);
    await qcPass(t, a, a.instruments.bench, ["GLU"]);
    await enterAndTechValidate(t, a, f.orderId, NORMAL);
    const logs = await t.prisma.auditLog.findMany({ where: { orgId: a.orgId } });
    const actions = new Set(logs.map((l) => l.action));
    for (const x of ["order.create", "order.consent", "specimen.collect", "specimen.receive", "specimen.process", "qc.run", "result.enter", "result.second_entry", "result.tech_validate", "http.POST"]) assert.ok(actions.has(x), x);
    const blob = JSON.stringify(logs.map((l) => l.meta));
    assert.ok(!/Amira|\+2010000001|13\.5|85/.test(blob), "no names, phones or values in audit meta");
    const one = logs[0];
    await assert.rejects(t.prisma.auditLog.update({ where: { id: one.id }, data: { action: "tampered" } }), /append-only/);
    await assert.rejects(t.prisma.auditLog.delete({ where: { id: one.id } }), /append-only/);
  });

  it("catalogue: unique codes per tenant, versioned reference intervals by age/sex, critical rules, results use the right interval", async () => {
    const dup = await call(t, "POST", "/catalogue/tests", { token: a.tokens.LAB_DIRECTOR, body: { code: "cbc", nameEn: "Dup", specimenType: "Blood", price: 1, analyteCodes: ["HB"] } });
    assert.equal(dup.status, 409);
    assert.equal((await call(t, "POST", "/catalogue/tests", { token: b.tokens.LAB_DIRECTOR, body: { code: "NEWT", nameEn: "New", specimenType: "Blood", price: 5, analyteCodes: ["HB"] } })).status, 201, "same code space is per tenant");
    assert.equal((await call(t, "POST", "/catalogue/tests", { token: a.tokens.LAB_DIRECTOR, body: { code: "NOAN", nameEn: "No analyte", specimenType: "Blood", price: 5 } })).status, 400);
    const before = await call(t, "GET", `/catalogue/analytes/${a.analytes.HB}/reference-intervals`, { token: a.tokens.TECHNOLOGIST });
    const adultF = before.body.find((i: any) => i.sex === "F" && i.ageMinDays === 6570);
    assert.equal(adultF.version, 1);
    const v2 = await call(t, "POST", `/catalogue/analytes/${a.analytes.HB}/reference-intervals`, { token: a.tokens.LAB_DIRECTOR, body: { sex: "F", ageMinDays: 6570, low: 11.5, high: 15, source: "SYNTHETIC v2" } });
    assert.equal(v2.status, 201);
    assert.equal(v2.body.version, 2);
    const after = await call(t, "GET", `/catalogue/analytes/${a.analytes.HB}/reference-intervals`, { token: a.tokens.TECHNOLOGIST });
    assert.ok(after.body.find((i: any) => i.id === adultF.id).effectiveTo, "previous version closed, not edited");
    assert.equal(Number(after.body.find((i: any) => i.id === adultF.id).low), 12, "old values untouched");
    assert.equal((await call(t, "POST", `/catalogue/analytes/${a.analytes.HB}/reference-intervals`, { token: a.tokens.LAB_DIRECTOR, body: { low: 9, high: 3 } })).status, 400);
    // a female adult result uses version 2 and flags against it
    const f = await makeOrder(t, a, ["CBC"]);
    await toProcessing(t, a, f);
    await qcPass(t, a, a.instruments.bench, ["HB"]);
    const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: a.tokens.TECHNOLOGIST })).body.items[0];
    const e = await call(t, "POST", "/results", { token: a.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: a.analytes.HB, instrumentId: a.instruments.bench, value: 11.7 } });
    assert.equal(e.body.refLow, 11.5);
    assert.equal(e.body.flag, "NORMAL");
  });

  it("staff & onboarding: only owners grant OWNER, signatories need a licence, self-lockout refused; onboarding creates a working tenant", async () => {
    const newStaff = { email: "new@x.test", displayName: "New Tech", role: "TECHNOLOGIST" };
    assert.equal((await call(t, "POST", "/staff", { token: a.tokens.BRANCH_MANAGER, body: newStaff })).status, 201);
    assert.equal((await call(t, "POST", "/staff", { token: a.tokens.BRANCH_MANAGER, body: newStaff })).status, 409);
    assert.equal((await call(t, "POST", "/staff", { token: a.tokens.BRANCH_MANAGER, body: { ...newStaff, email: "o@x.test", role: "OWNER" } })).status, 403);
    assert.equal((await call(t, "POST", "/staff", { token: a.tokens.OWNER, body: { ...newStaff, email: "s@x.test", role: "AUTHORIZED_SIGNATORY" } })).status, 400);
    assert.equal((await call(t, "PUT", `/staff/${a.staff.OWNER.id}`, { token: a.tokens.OWNER, body: { active: false } })).status, 409);
    const slug = `onb${Date.now().toString(36)}`;
    const onb = await call(t, "POST", "/onboarding/tenants", { body: { name: "Onboard Lab", slug, labName: "Main Lab", labCode: "ML", ownerName: "Owner One", ownerEmail: "owner@onb.test", edition: "PRO", loadStarterCatalogue: true } });
    assert.equal(onb.status, 201, JSON.stringify(onb.body));
    const me = await call(t, "GET", "/auth/me", { token: onb.body.token });
    assert.equal(me.body.user.role, "OWNER");
    assert.equal(me.body.tenant.edition, "PRO");
    assert.ok(me.body.permissions.includes("reports.sign"));
    assert.equal((await call(t, "GET", "/catalogue/tests", { token: onb.body.token })).body.length, 5);
    assert.equal((await call(t, "POST", "/onboarding/tenants", { body: { name: "Onboard Lab", slug, labName: "Main Lab", labCode: "ML", ownerName: "Owner One", ownerEmail: "owner@onb.test" } })).status, 409);
    const login = await call(t, "POST", "/auth/dev-login", { body: { orgSlug: slug, email: "owner@onb.test" } });
    assert.equal(login.status, 201);
    assert.equal((await call(t, "POST", "/auth/dev-login", { body: { orgSlug: slug, email: "nobody@onb.test" } })).status, 403);
    // multi-branch needs the Chain plan
    assert.equal((await call(t, "POST", "/labs", { token: onb.body.token, body: { name: "Second", code: "SB" } })).status, 402);
  });
});
