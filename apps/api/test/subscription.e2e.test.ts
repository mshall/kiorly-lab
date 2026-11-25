import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab } from "./helpers/app";
import { SubscriptionService } from "../src/subscription/subscription.service";

const DAY = 86_400_000;
describe("SUB-01 recurring subscription, auto-renew and Lite downgrade (lab)", () => {
  let t: TestApp, svc: SubscriptionService;
  before(async () => { t = await bootApp(); svc = t.app.get(SubscriptionService); await t.prisma.planPrice.deleteMany({}); await t.prisma.planPrice.create({ data: { edition: "PRO", marketCode: "EG", interval: "MONTHLY", currency: "EGP", amount: "100.00" } }); });
  after(async () => { await t.prisma.planPrice.deleteMany({}); await t.close(); });
  const sub = (l: Lab) => t.prisma.orgSubscription.findUniqueOrThrow({ where: { orgId: l.orgId } });
  const edition = async (l: Lab) => (await t.prisma.tenant.findUniqueOrThrow({ where: { id: l.orgId } })).edition;
  const expire = (l: Lab, extra: object = {}) => t.prisma.orgSubscription.update({ where: { orgId: l.orgId }, data: { currentPeriodEnd: new Date(Date.now() - DAY), currentPeriodStart: new Date(Date.now() - 31 * DAY), ...extra } });
  const events = (l: Lab, type: string) => t.prisma.subscriptionEvent.count({ where: { orgId: l.orgId, type } });
  const card = (l: Lab, tokenRef = "tok_visa_ok") => call(t, "PUT", "/subscription/payment-method", { token: l.tokens.OWNER, body: { tokenRef, brand: "Visa", last4: "4242", expMonth: 12, expYear: 2030 } });
  const slots = (l: Lab) => call(t, "GET", "/home-collection/slots?date=2027-01-10", { token: l.tokens.RECEPTION });

  it("default ON; state, plans and impact come from the kernel editions; missing price is a placeholder", async () => {
    const l = await makeLab(t, { edition: "PRO" });
    const s = await call(t, "GET", "/subscription", { token: l.tokens.OWNER });
    assert.equal(s.status, 200); assert.equal(s.body.autoRenew, true); assert.ok(s.body.renewsOn);
    assert.ok(s.body.downgradeImpact.lostFeatures.includes("home_collection"));
    const p = (await call(t, "GET", "/subscription/plans", { token: l.tokens.OWNER })).body;
    assert.deepEqual(p.plans.map((x: any) => x.edition), ["LITE", "PRO", "CHAIN"]);
    assert.equal(p.plans.find((x: any) => x.edition === "PRO").prices[0].amount, "100.00");
    assert.equal(p.plans.find((x: any) => x.edition === "CHAIN").priceNeedsHuman, true);
  });

  it("renew success charges the saved token once under 8 concurrent runs", async () => {
    const l = await makeLab(t, { edition: "PRO" });
    await card(l); await svc.ensure(l.orgId); await expire(l);
    await Promise.all(Array.from({ length: 8 }, () => svc.runDaily()));
    const invoices = await t.prisma.subscriptionInvoice.findMany({ where: { orgId: l.orgId } });
    assert.equal(invoices.length, 1); assert.equal(invoices[0]!.status, "PAID");
    assert.equal(await events(l, "renewed"), 1); assert.equal(await edition(l), "PRO");
  });

  it("renew failure -> retries -> Lite after the dunning window; staff kept, owner still signed in", async () => {
    const l = await makeLab(t, { edition: "PRO" });
    await card(l, "tok_fail_card"); await svc.ensure(l.orgId); await expire(l);
    await svc.runDaily();
    assert.equal((await sub(l)).status, "PAST_DUE"); assert.equal(await edition(l), "PRO");
    const first = (await sub(l)).firstFailedAt!.getTime(); const day = (n: number) => new Date(first + n * DAY);
    await t.prisma.orgSubscription.update({ where: { orgId: l.orgId }, data: { nextRetryAt: day(1) } });
    assert.equal((await svc.runDaily(day(1))).retried, 1);
    await svc.runDaily(day(14)); assert.equal(await edition(l), "PRO");
    await Promise.all([svc.runDaily(day(15)), svc.runDaily(day(15)), svc.runDaily(day(16))]);
    assert.equal(await edition(l), "LITE"); assert.equal(await events(l, "downgraded_to_lite"), 1);
    assert.equal((await sub(l)).downgradeReason, "payment_failed");
    assert.equal((await t.prisma.subscriptionNotice.count({ where: { orgId: l.orgId, kind: "downgrade_warning" } })), 1);
    assert.equal(await t.prisma.staffUser.count({ where: { orgId: l.orgId, active: true } }) >= 9, true);
    assert.equal((await call(t, "GET", "/subscription", { token: l.tokens.OWNER })).status, 200);
  });

  it("cancel auto-renew: confirmation first, PRO until period end, then Lite; capability read-only in grace, 402 for writes, 402 after grace", async () => {
    const l = await makeLab(t, { edition: "PRO" });
    const bad = await call(t, "POST", "/subscription/auto-renew", { token: l.tokens.OWNER, body: { enabled: false } });
    assert.equal(bad.status, 400); assert.equal(bad.body.code, "AUTO_RENEW_CONFIRMATION_REQUIRED"); assert.ok(bad.body.details.impact.dataRetained);
    const ok = await call(t, "POST", "/subscription/auto-renew", { token: l.tokens.OWNER, body: { enabled: false, confirmDowngrade: true } });
    assert.equal(ok.status, 201); assert.equal(ok.body.autoRenew, false); assert.equal(await edition(l), "PRO");
    assert.equal((await slots(l)).status, 200);
    await svc.ensure(l.orgId); await expire(l);
    await svc.runDaily(); await svc.runDaily();
    assert.equal(await edition(l), "LITE"); assert.equal(await events(l, "downgraded_to_lite"), 1);
    assert.equal((await slots(l)).status, 200, "GET stays readable during the grace window");
    assert.equal((await call(t, "POST", "/analyzers/simulate", { token: l.tokens.TECHNOLOGIST, body: {} })).status, 402);
    await t.prisma.orgSubscription.update({ where: { orgId: l.orgId }, data: { liteReadOnlyGraceUntil: new Date(Date.now() - 1000) } });
    assert.equal((await slots(l)).status, 402, "after the grace the capability needs an upgrade");
  });

  it("reactivate, roles, forced auto-renew, reminders in quiet hours, card number refused", async () => {
    const l = await makeLab(t, { edition: "PRO" }); const g = await makeLab(t, { edition: "PRO" });
    await svc.ensure(l.orgId); await svc.downgradeToLite(l.orgId, "auto_renew_off", null);
    assert.equal((await call(t, "POST", "/subscription/reactivate", { token: l.tokens.RECEPTION, body: {} })).status, 403);
    const r = await call(t, "POST", "/subscription/reactivate", { token: l.tokens.OWNER, body: {} });
    assert.equal(r.status, 201); assert.equal(r.body.reactivated, true); assert.equal(r.body.needsPaymentMethod, true);
    assert.equal(await edition(l), "PRO");
    assert.equal((await call(t, "POST", "/subscription/reactivate", { token: l.tokens.OWNER, body: {} })).body.code, "ALREADY_PAID");
    assert.equal((await call(t, "POST", "/subscription/auto-renew", { token: g.tokens.LAB_DIRECTOR, body: { enabled: false, confirmDowngrade: true } })).status, 403);
    await svc.forceAutoRenew(g.orgId, "ON", "contractual commitment", "ops");
    assert.equal((await call(t, "POST", "/subscription/auto-renew", { token: g.tokens.OWNER, body: { enabled: false, confirmDowngrade: true } })).body.code, "AUTO_RENEW_FORCED");
    await assert.rejects(svc.forceAutoRenew(g.orgId, "OFF", "  ", "ops"));
    const h = await makeLab(t, { edition: "PRO" });
    await svc.ensure(h.orgId); await t.prisma.orgSubscription.update({ where: { orgId: h.orgId }, data: { currentPeriodEnd: new Date(Date.now() + 2.5 * DAY) } });
    await svc.runDaily(); await svc.runDaily();
    const n = await t.prisma.subscriptionNotice.findMany({ where: { orgId: h.orgId } });
    assert.equal(n.length, 1); assert.equal(n[0]!.kind, "payment_method_missing");
    const hr = (n[0]!.notBefore.getUTCHours() + 2) % 24; assert.equal(hr >= 21 || hr < 8, false);
    const pan = await call(t, "PUT", "/subscription/payment-method", { token: h.tokens.OWNER, body: { tokenRef: "4111111111111111", last4: "1111" } });
    assert.equal(pan.status, 400); assert.equal(pan.body.code, "PAN_NOT_ACCEPTED");
    // tenant isolation: another lab's state is its own
    assert.notEqual((await call(t, "GET", "/subscription", { token: h.tokens.OWNER })).body.currentPeriodEnd, (await call(t, "GET", "/subscription", { token: g.tokens.OWNER })).body.currentPeriodEnd);
  });
});
