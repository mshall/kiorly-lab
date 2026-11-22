import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

const APP = { "x-kiorly-client": "kiorly-team/1.0.0" };
const snapshot = (flags: object[]) => ({ product: "kiorly-lab", version: 1, generatedAt: new Date().toISOString(), flags: flags as never });
const DEV = "8f14e45f-ceea-467a-9575-5d0e5c3b7d11";

describe("Kiorly Team mobile API", () => {
  let t: TestApp;
  let pro: Lab;
  let chain: Lab;
  let basic: Lab;
  before(async () => {
    t = await bootApp();
    pro = await makeLab(t, { edition: "PRO" });
    chain = await makeLab(t, { edition: "CHAIN" });
    basic = await makeLab(t, { edition: "LITE" });
  });
  after(async () => t.close());

  it("entitlement mobile_staff_app by plan: PRO/CHAIN on, LITE off (PLAN_BELOW_PRO), safety-alerts-only fallback", async () => {
    const p = await call(t, "GET", "/mobile/bootstrap", { token: pro.tokens.OWNER });
    assert.equal(p.status, 200);
    assert.equal(p.body.apiVersion, 1);
    assert.equal(p.body.product, "lab");
    assert.equal(p.body.org.plan, "PRO");
    assert.equal(p.body.org.rawPlan, "PRO");
    assert.deepEqual(p.body.entitlement, { key: "mobile_staff_app", enabled: true, requiredPlan: "PRO", reason: null });
    assert.equal(p.body.safetyAlertsOnly, false);
    assert.equal(p.body.modules.length, 9);
    assert.equal(p.body.device, null);
    const c = await call(t, "GET", "/mobile/bootstrap", { token: chain.tokens.OWNER });
    assert.equal(c.body.org.plan, "ENTERPRISE");
    assert.equal(c.body.entitlement.enabled, true);
    const b = await call(t, "GET", "/mobile/bootstrap", { token: basic.tokens.OWNER });
    assert.equal(b.status, 200, "bootstrap works on every plan");
    assert.equal(b.body.org.plan, "BASIC");
    assert.deepEqual(b.body.entitlement, { key: "mobile_staff_app", enabled: false, requiredPlan: "PRO", reason: "PLAN_BELOW_PRO" });
    assert.equal(b.body.safetyAlertsOnly, true);
    assert.deepEqual(b.body.modules, []);
  });

  it("bootstrap modules follow the role", async () => {
    const on = async (lab: Lab, role: keyof Lab["tokens"]) => {
      const r = await call(t, "GET", "/mobile/bootstrap", { token: lab.tokens[role] });
      return Object.fromEntries(r.body.modules.map((m: any) => [m.key, m]));
    };
    const phleb = await on(pro, "PHLEBOTOMIST");
    assert.equal(phleb["lab.phlebotomy"].enabled, true);
    assert.ok(phleb["lab.phlebotomy"].screens.includes("round"));
    assert.equal(phleb["lab.validation"].enabled, false);
    assert.equal(phleb["lab.critical"].enabled, false);
    const sig = await on(pro, "AUTHORIZED_SIGNATORY");
    assert.equal(sig["lab.validation"].enabled, true);
    assert.ok(sig["lab.validation"].screens.includes("sign-off"));
    assert.equal(sig["lab.critical"].enabled, true);
    assert.equal(sig["lab.phlebotomy"].enabled, false);
    const tech = await on(pro, "TECHNOLOGIST");
    assert.ok(tech["lab.validation"].screens.includes("tech-validate"));
    assert.ok(!tech["lab.validation"].screens.includes("sign-off"));
    assert.equal(tech["lab.qc"].enabled, true);
    const fin = await on(pro, "FINANCE");
    assert.equal(fin["lab.critical"].enabled, false);
    assert.equal(fin["lab.reagents"].enabled, true);
  });

  it("flag OFF at org scope removes the entitlement even on PRO (FLAG_OFF)", async () => {
    t.flags.setSnapshot(snapshot([{ key: "mobile_staff_app", values: { orgs: { [pro.orgId]: "OFF" } } }]));
    try {
      const r = await call(t, "GET", "/mobile/bootstrap", { token: pro.tokens.OWNER });
      assert.equal(r.body.entitlement.enabled, false);
      assert.equal(r.body.entitlement.reason, "FLAG_OFF");
      assert.equal(r.body.safetyAlertsOnly, true);
      const other = await call(t, "GET", "/mobile/bootstrap", { token: chain.tokens.OWNER });
      assert.equal(other.body.entitlement.enabled, true);
    } finally {
      t.flags.setSnapshot(null);
    }
  });

  it("device lifecycle: register (token once, hashed), list, push-token, revoked guard, remote sign-out", async () => {
    const reg = await call(t, "POST", "/mobile/devices", { token: pro.tokens.TECHNOLOGIST, body: { deviceId: DEV, platform: "ios", name: "Omar's iPhone", appVersion: "1.0.0", pushToken: "ExponentPushToken[abc]" } });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.status, "ACTIVE");
    assert.ok(reg.body.deviceToken.length >= 32);
    const row = await t.prisma.mobileDevice.findUniqueOrThrow({ where: { id: reg.body.id } });
    assert.notEqual(row.tokenHash, reg.body.deviceToken, "stored hashed");
    assert.equal(row.tokenHash.length, 64);

    const dh = { "x-kiorly-device": reg.body.id, "x-kiorly-device-token": reg.body.deviceToken };
    const boot = await call(t, "GET", "/mobile/bootstrap", { token: pro.tokens.TECHNOLOGIST, headers: { ...APP, ...dh } });
    assert.deepEqual(boot.body.device, { id: reg.body.id, status: "ACTIVE" });

    // re-register rotates the token; the old one stops working
    const re = await call(t, "POST", "/mobile/devices", { token: pro.tokens.TECHNOLOGIST, body: { deviceId: DEV, platform: "ios", name: "Omar's iPhone", appVersion: "1.0.1" } });
    assert.equal(re.body.id, reg.body.id);
    assert.notEqual(re.body.deviceToken, reg.body.deviceToken);
    const stale = await call(t, "GET", "/mobile/summary", { token: pro.tokens.TECHNOLOGIST, headers: { ...APP, ...dh } });
    assert.equal(stale.status, 401);
    assert.equal(stale.body.code, "DEVICE_REVOKED");
    const dh2 = { "x-kiorly-device": re.body.id, "x-kiorly-device-token": re.body.deviceToken };
    assert.equal((await call(t, "GET", "/mobile/summary", { token: pro.tokens.TECHNOLOGIST, headers: { ...APP, ...dh2 } })).status, 200);
    // token must belong to the caller
    assert.equal((await call(t, "GET", "/mobile/summary", { token: pro.tokens.OWNER, headers: { ...APP, ...dh2 } })).status, 401);

    const pt = await call(t, "PUT", `/mobile/devices/${re.body.id}/push-token`, { token: pro.tokens.TECHNOLOGIST, body: { token: "ExponentPushToken[xyz]", provider: "expo" } });
    assert.equal(pt.status, 200);

    // own list vs owner (staff.manage) list
    const mine = await call(t, "GET", "/mobile/devices", { token: pro.tokens.TECHNOLOGIST });
    assert.equal(mine.body.items.length, 1);
    assert.equal(mine.body.items[0].tokenHash, undefined);
    const all = await call(t, "GET", "/mobile/devices", { token: pro.tokens.OWNER });
    assert.ok(all.body.items.some((d: any) => d.id === re.body.id && d.mine === false));

    // another non-admin cannot revoke it; owner can (remote sign-out)
    assert.equal((await call(t, "DELETE", `/mobile/devices/${re.body.id}`, { token: pro.tokens.PHLEBOTOMIST })).status, 403);
    const del = await call(t, "DELETE", `/mobile/devices/${re.body.id}`, { token: pro.tokens.OWNER });
    assert.equal(del.status, 200);
    assert.equal(del.body.status, "REVOKED");
    const after = await call(t, "GET", "/mobile/bootstrap", { token: pro.tokens.TECHNOLOGIST, headers: { ...APP, ...dh2 } });
    assert.equal(after.status, 401);
    assert.equal(after.body.code, "DEVICE_REVOKED");
    // unknown device header also rejected
    assert.equal((await call(t, "GET", "/mobile/bootstrap", { token: pro.tokens.TECHNOLOGIST, headers: { "x-kiorly-device": "nope", "x-kiorly-device-token": "nope" } })).status, 401);
    // audited
    assert.ok(await t.prisma.auditLog.findFirst({ where: { orgId: pro.orgId, action: "mobile.device_revoked", entityId: re.body.id } }));
    // idempotent revoke; re-registering reactivates with a fresh token
    assert.equal((await call(t, "DELETE", `/mobile/devices/${re.body.id}`, { token: pro.tokens.TECHNOLOGIST })).status, 200);
    const again = await call(t, "POST", "/mobile/devices", { token: pro.tokens.TECHNOLOGIST, body: { deviceId: DEV, platform: "ios", name: "Omar's iPhone" } });
    assert.equal(again.body.status, "ACTIVE");
  });

  it("client enforcement: BASIC org via the app is refused everywhere except auth, bootstrap, alerts and remote sign-out", async () => {
    const F = (r: { status: number; body: any }) => {
      assert.equal(r.status, 403, JSON.stringify(r.body));
      assert.equal(r.body.code, "FEATURE_DISABLED");
      assert.equal(r.body.key, "mobile_staff_app");
      assert.equal(r.body.scope, "org");
    };
    F(await call(t, "GET", "/orders", { token: basic.tokens.RECEPTION, headers: APP }));
    F(await call(t, "GET", "/worklist", { token: basic.tokens.TECHNOLOGIST, headers: APP }));
    F(await call(t, "POST", "/mobile/devices", { token: basic.tokens.TECHNOLOGIST, body: { deviceId: DEV, platform: "android", name: "Pixel" } }));
    F(await call(t, "GET", "/mobile/inbox", { token: basic.tokens.TECHNOLOGIST }));
    F(await call(t, "GET", "/mobile/summary", { token: basic.tokens.TECHNOLOGIST }));
    // the plan gate beats RBAC: a BASIC user LACKING the permission (reception has no results.read / inventory.read) still gets FEATURE_DISABLED, not FORBIDDEN
    F(await call(t, "GET", "/mobile/worklist/progress", { token: basic.tokens.RECEPTION }));
    F(await call(t, "GET", "/mobile/reagents/low-stock", { token: basic.tokens.RECEPTION }));
    F(await call(t, "GET", "/validation-queue?stage=medical", { token: basic.tokens.RECEPTION, headers: APP }));
    // ... while on PRO the same permission miss stays FORBIDDEN
    assert.equal((await call(t, "GET", "/mobile/worklist/progress", { token: pro.tokens.RECEPTION })).body.code, "FORBIDDEN");
    // the web console (no app header) is unaffected
    assert.equal((await call(t, "GET", "/orders", { token: basic.tokens.RECEPTION })).status, 200);
    // exempt on every plan
    assert.equal((await call(t, "GET", "/mobile/bootstrap", { token: basic.tokens.RECEPTION, headers: APP })).status, 200);
    assert.equal((await call(t, "GET", "/mobile/alerts", { token: basic.tokens.TECHNOLOGIST, headers: APP })).status, 200);
    assert.equal((await call(t, "GET", "/auth/me", { token: basic.tokens.TECHNOLOGIST, headers: APP })).status, 200);
    // PRO with the app header works
    assert.equal((await call(t, "GET", "/orders", { token: pro.tokens.RECEPTION, headers: APP })).status, 200);
  });

  it("inbox + mock push: test push, unread count, read, read-all, paging", async () => {
    const tk = pro.tokens.SUPERVISOR;
    const p1 = await call(t, "POST", "/mobile/push/test", { token: tk });
    assert.equal(p1.status, 201);
    assert.equal(p1.body.provider, "mock");
    await call(t, "POST", "/mobile/push/test", { token: tk });
    const inbox = await call(t, "GET", "/mobile/inbox?limit=1", { token: tk });
    assert.equal(inbox.status, 200);
    assert.equal(inbox.body.items.length, 1);
    assert.ok(inbox.body.nextCursor);
    assert.equal(inbox.body.unread, 2);
    const it = inbox.body.items[0];
    assert.ok(it.title && it.titleAr && it.body && it.bodyAr);
    assert.equal(it.kind, "GENERAL");
    const page2 = await call(t, "GET", `/mobile/inbox?limit=5&cursor=${inbox.body.nextCursor}`, { token: tk });
    assert.equal(page2.body.items.length, 1);
    assert.equal((await call(t, "POST", `/mobile/inbox/${it.id}/read`, { token: tk })).status, 201);
    assert.equal((await call(t, "GET", "/mobile/inbox", { token: tk })).body.unread, 1);
    assert.equal((await call(t, "POST", "/mobile/inbox/read-all", { token: tk })).body.updated, 1);
    assert.equal((await call(t, "GET", "/mobile/inbox", { token: tk })).body.unread, 0);
    // another user never sees it
    assert.equal((await call(t, "GET", "/mobile/inbox", { token: pro.tokens.OWNER })).body.items.length, 0);
    assert.equal((await call(t, "POST", `/mobile/inbox/${it.id}/read`, { token: pro.tokens.OWNER })).status, 404);
  });

  it("critical value: lands in the alert inbox and the push inbox; acknowledge is idempotent, audited and RBAC-checked; works on a BASIC plan", async () => {
    for (const lab of [pro, basic]) {
      const f = await makeOrder(t, lab, ["CBC"]);
      await toProcessing(t, lab, f);
      await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT"]);
      const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
      const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.HB, instrumentId: lab.instruments.bench, value: 6 } });
      assert.equal(e.body.flag, "CRITICAL_LOW");
      const list = await call(t, "GET", "/mobile/alerts?status=open", { token: lab.tokens.LAB_DIRECTOR, headers: APP });
      assert.equal(list.status, 200);
      const a = list.body.items.find((x: any) => x.kind === "CRITICAL_VALUE");
      assert.ok(a, JSON.stringify(list.body));
      assert.equal(a.severity, "CRITICAL");
      assert.equal(a.ackedAt, null);
      assert.ok(a.titleAr && a.bodyAr);
      assert.ok(!/\b6\b/.test(a.body), "no raw value in the alert text");
      assert.equal(a.subject.type, "ORDER");
      // phlebotomist has no critical.read: sees none
      const ph = await call(t, "GET", "/mobile/alerts", { token: lab.tokens.PHLEBOTOMIST, headers: APP });
      assert.ok(!ph.body.items.some((x: any) => x.kind === "CRITICAL_VALUE"));
      assert.equal((await call(t, "POST", `/mobile/alerts/${a.id}/ack`, { token: lab.tokens.RECEPTION, headers: APP, body: {} })).status, 403);
      const ack = await call(t, "POST", `/mobile/alerts/${a.id}/ack`, { token: lab.tokens.LAB_DIRECTOR, headers: APP, body: { note: "clinician informed" } });
      assert.equal(ack.status, 201, JSON.stringify(ack.body));
      assert.ok(ack.body.ackedAt);
      assert.equal(ack.body.ackedBy, lab.staff.LAB_DIRECTOR.id);
      const again = await call(t, "POST", `/mobile/alerts/${a.id}/ack`, { token: lab.tokens.SUPERVISOR, headers: APP, body: {} });
      assert.equal(again.status, 201, "idempotent");
      assert.equal(again.body.ackedBy, lab.staff.LAB_DIRECTOR.id, "first acknowledger is kept");
      const open = await call(t, "GET", "/mobile/alerts?status=open", { token: lab.tokens.LAB_DIRECTOR, headers: APP });
      assert.ok(!open.body.items.some((x: any) => x.id === a.id));
      const all = await call(t, "GET", "/mobile/alerts?status=all", { token: lab.tokens.LAB_DIRECTOR, headers: APP });
      assert.ok(all.body.items.some((x: any) => x.id === a.id && x.ackedAt));
      const crit = await t.prisma.criticalAlert.findFirstOrThrow({ where: { id: a.id.replace("crit_", "") } });
      assert.equal(crit.status, "ACKNOWLEDGED");
      assert.ok(await t.prisma.auditLog.findFirst({ where: { orgId: lab.orgId, action: "critical.acknowledged", entityId: crit.id } }));
      assert.equal((await call(t, "POST", "/mobile/alerts/crit_missing/ack", { token: lab.tokens.LAB_DIRECTOR, body: {} })).status, 404);
      assert.equal((await call(t, "POST", "/mobile/alerts/bogus/ack", { token: lab.tokens.LAB_DIRECTOR, body: {} })).status, 404);
    }
    // mock push mirror of the PUSH-channel critical notification (lab director) reached the app inbox without a raw value
    const msgs = await call(t, "GET", "/mobile/inbox", { token: pro.tokens.LAB_DIRECTOR });
    const m = msgs.body.items.find((x: any) => x.kind === "SAFETY");
    assert.ok(m, JSON.stringify(msgs.body));
    assert.ok(m.titleAr.length > 0);
    assert.ok(!/g\/dL/i.test(m.body));
    // other tenants never see this tenant's alerts
    const foreign = await call(t, "GET", "/mobile/alerts?status=all", { token: chain.tokens.LAB_DIRECTOR, headers: APP });
    assert.equal(foreign.body.items.length, 0);
  });

  it("derived alerts: QC block and breached STAT TAT are listed and acknowledgeable", async () => {
    const inst = pro.instruments.bench;
    const m = await t.prisma.qcMaterialLevel.findUniqueOrThrow({ where: { id: pro.materials.GLU.l1 } });
    const run = await call(t, "POST", "/qc/runs", { token: pro.tokens.TECHNOLOGIST, body: { instrumentId: inst, materialId: m.id, value: Number(m.targetMean) + 4 * Number(m.targetSd) } });
    assert.equal(run.status, 201);
    const list = await call(t, "GET", "/mobile/alerts", { token: pro.tokens.TECHNOLOGIST, headers: APP });
    const q = list.body.items.find((x: any) => x.kind === "QC_FAILURE");
    assert.ok(q, JSON.stringify(list.body));
    const ack = await call(t, "POST", `/mobile/alerts/${q.id}/ack`, { token: pro.tokens.TECHNOLOGIST, headers: APP, body: { note: "re-running" } });
    assert.equal(ack.status, 201);
    assert.ok(ack.body.ackedAt);
    assert.equal((await call(t, "POST", `/mobile/alerts/${q.id}/ack`, { token: pro.tokens.TECHNOLOGIST, headers: APP, body: {} })).status, 201);
    const audits = await t.prisma.auditLog.count({ where: { orgId: pro.orgId, action: "mobile.alert_acknowledged", entityId: q.id } });
    assert.equal(audits, 1, "acknowledged once");

    const f = await makeOrder(t, pro, ["GLU"], { priority: "STAT" });
    await t.prisma.orderItem.updateMany({ where: { orderId: f.orderId }, data: {} });
    await t.prisma.testDefinition.updateMany({ where: { orgId: pro.orgId, code: "GLU" }, data: { tatMinutes: 1 } });
    await t.prisma.labOrder.update({ where: { id: f.orderId }, data: { createdAt: new Date(Date.now() - 3 * 3_600_000) } });
    const sweep = await t.insights.slaSweep(new Date(), { orgId: pro.orgId });
    assert.ok(sweep.raised >= 1);
    const l2 = await call(t, "GET", "/mobile/alerts", { token: pro.tokens.BRANCH_MANAGER, headers: APP });
    const tat = l2.body.items.find((x: any) => x.kind === "TAT_BREACH_CRITICAL");
    assert.ok(tat, JSON.stringify(l2.body));
    assert.equal(tat.severity, "CRITICAL");
    assert.equal((await call(t, "POST", `/mobile/alerts/${tat.id}/ack`, { token: pro.tokens.BRANCH_MANAGER, headers: APP, body: {} })).status, 201);
  });

  it("scan resolves a barcode / accession / order number with the caller's allowed next actions; search + summary + reagents are scoped", async () => {
    const f = await makeOrder(t, pro, ["GLU"]);
    const sp = f.specimens[0];
    const byBarcode = await call(t, "GET", `/mobile/scan?code=${encodeURIComponent(sp.barcode)}`, { token: pro.tokens.PHLEBOTOMIST, headers: APP });
    assert.equal(byBarcode.status, 200, JSON.stringify(byBarcode.body));
    assert.equal(byBarcode.body.type, "SPECIMEN");
    assert.equal(byBarcode.body.specimen.status, "PENDING_COLLECTION");
    const collect = byBarcode.body.nextActions.find((a: any) => a.action === "collect");
    assert.deepEqual({ requiresScan: collect.requiresScan, allowed: collect.allowed }, { requiresScan: true, allowed: true });
    assert.equal(byBarcode.body.nextActions.find((a: any) => a.action === "reject").allowed, false);
    const acc = await call(t, "GET", `/mobile/scan?code=${encodeURIComponent(byBarcode.body.specimen.accessionNumber)}`, { token: pro.tokens.TECHNOLOGIST, headers: APP });
    assert.equal(acc.body.type, "SPECIMEN");
    const ord = await call(t, "GET", `/mobile/scan?code=${encodeURIComponent(f.order.orderNumber)}`, { token: pro.tokens.RECEPTION, headers: APP });
    assert.equal(ord.body.type, "ORDER");
    assert.equal(ord.body.specimens.length, 1);
    assert.equal((await call(t, "GET", "/mobile/scan?code=NOPE", { token: pro.tokens.PHLEBOTOMIST, headers: APP })).status, 404);
    assert.equal((await call(t, "GET", `/mobile/scan?code=${sp.barcode}`, { token: chain.tokens.OWNER, headers: APP })).status, 404, "tenant isolation");
    // chain of custody via the existing collect endpoint, then the scan shows it
    assert.equal((await call(t, "POST", `/specimens/${sp.id}/collect`, { token: pro.tokens.PHLEBOTOMIST, headers: APP, body: { scannedBarcode: sp.barcode } })).status, 201);
    const after = await call(t, "GET", `/mobile/scan?code=${encodeURIComponent(sp.barcode)}`, { token: pro.tokens.TECHNOLOGIST, headers: APP });
    assert.equal(after.body.specimen.status, "COLLECTED");
    assert.equal(after.body.custody[0].type, "COLLECTED");

    const s = await call(t, "GET", `/mobile/search?q=${encodeURIComponent(f.order.orderNumber.slice(0, 8))}`, { token: pro.tokens.RECEPTION, headers: APP });
    assert.ok(s.body.orders.length >= 1);
    assert.equal((await call(t, "GET", "/mobile/search?q=a", { token: pro.tokens.RECEPTION, headers: APP })).body.orders.length, 0);
    const phlebSearch = await call(t, "GET", `/mobile/search?q=${encodeURIComponent("Amira")}`, { token: pro.tokens.PHLEBOTOMIST, headers: APP });
    assert.ok(phlebSearch.body.patients.length >= 1);
    assert.deepEqual((await call(t, "GET", "/mobile/search?q=Amira", { token: chain.tokens.OWNER, headers: APP })).body.patients, []);

    const sum = await call(t, "GET", "/mobile/summary", { token: pro.tokens.PHLEBOTOMIST, headers: APP });
    assert.equal(sum.status, 200);
    assert.equal(sum.body.openCriticalValues, null, "role-scoped");
    assert.equal(typeof sum.body.ordersToday, "number");
    const sum2 = await call(t, "GET", "/mobile/summary", { token: pro.tokens.LAB_DIRECTOR, headers: APP });
    assert.equal(typeof sum2.body.openCriticalValues, "number");
    assert.equal(typeof sum2.body.unreadInbox, "number");

    const wl = await call(t, "GET", "/mobile/worklist/progress", { token: pro.tokens.TECHNOLOGIST, headers: APP });
    assert.equal(wl.status, 200);
    assert.ok(Array.isArray(wl.body.sections));
    assert.equal((await call(t, "GET", "/mobile/worklist/progress", { token: pro.tokens.FINANCE, headers: APP })).status, 403);

    const reag = await call(t, "GET", "/mobile/reagents/low-stock", { token: pro.tokens.SUPERVISOR, headers: APP });
    assert.equal(reag.status, 200);
    assert.ok(Array.isArray(reag.body.lowStock) && Array.isArray(reag.body.expiring));
    assert.equal((await call(t, "GET", "/mobile/reagents/low-stock", { token: pro.tokens.PHLEBOTOMIST, headers: APP })).status, 403);
  });

  it("push templates never carry raw values (KLCRIT03) and real mode needs PUSH_API_URL", async () => {
    const { MobilePushService } = await import("../src/adapters/mobile-push.adapter");
    const svc = t.app.get(MobilePushService);
    await assert.rejects(() => svc.send({ orgId: pro.orgId, staffId: pro.staff.OWNER.id, templateId: "TEST", params: { value: 6 } }));
    await assert.rejects(() => svc.send({ orgId: pro.orgId, staffId: pro.staff.OWNER.id, templateId: "NOPE" }));
    process.env.MOBILE_PUSH_MODE = "real";
    try {
      await assert.rejects(() => svc.send({ orgId: pro.orgId, staffId: pro.staff.OWNER.id, templateId: "TEST" }), /PUSH_API_URL/);
    } finally {
      delete process.env.MOBILE_PUSH_MODE;
    }
  });
});
