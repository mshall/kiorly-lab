import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Lab, type TestApp, bootApp, call, makeLab, makeOrder } from "./helpers/app";

describe("M2 reception: appointments, queue, order edit/cancel with revisions, ICD hints, labels (1D + QR)", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => { t = await bootApp(); lab = await makeLab(t); });
  after(async () => t.close());
  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

  it("appointments: slot grid, capacity, opening hours, check-in issues a ticket, conversion creates the order", async () => {
    await t.prisma.lab.update({ where: { id: lab.labId }, data: { appointmentCapacity: 2 } });
    const av = await call(t, "GET", `/appointments/availability?date=${day}`, { token: lab.tokens.RECEPTION });
    assert.equal(av.status, 200);
    assert.equal(av.body.length, 24, "08:00-20:00 in 30 minute slots");
    assert.equal(av.body[0].free, 2);
    const mk = (name: string, time = "09:00", extra: object = {}) => call(t, "POST", "/appointments", { token: lab.tokens.RECEPTION, body: { patientName: name, startsAt: `${day}T${time}:00.000Z`, testCodes: ["GLU"], fasting: true, ...extra } });
    assert.equal((await mk("Ann")).status, 201);
    assert.equal((await mk("Bob", "09:10")).status, 201);
    const full = await mk("Cal", "09:20");
    assert.equal(full.status, 409);
    assert.equal(full.body.code, "SLOT_FULL");
    assert.equal((await mk("Dan", "05:00")).body.code, "OUTSIDE_OPENING_HOURS");
    assert.equal((await call(t, "POST", "/appointments", { token: lab.tokens.PHLEBOTOMIST, body: { patientName: "x", startsAt: `${day}T10:00:00.000Z` } })).status, 403);
    const av2 = await call(t, "GET", `/appointments/availability?date=${day}`, { token: lab.tokens.RECEPTION });
    assert.equal(av2.body.find((s: any) => s.startsAt.startsWith(`${day}T09:00`)).free, 0);

    const pat = (await call(t, "POST", "/patients", { token: lab.tokens.RECEPTION, body: { fullName: "Appt Patient", dateOfBirth: "1991-02-03", phone: "+201555000111" } })).body;
    const ap = (await mk("Appt Patient", "11:00", { patientId: pat.id, phone: pat.phone })).body;
    const ci = await call(t, "POST", `/appointments/${ap.id}/check-in`, { token: lab.tokens.RECEPTION, body: { priority: "STAT" } });
    assert.equal(ci.status, 201);
    assert.match(ci.body.ticket.code, /^S001$/);
    assert.equal((await call(t, "POST", `/appointments/${ap.id}/cancel`, { token: lab.tokens.RECEPTION })).status, 409, "already checked in");
    const ord = await call(t, "POST", `/appointments/${ap.id}/order`, { token: lab.tokens.RECEPTION, body: { identifiersChecked: ["dateOfBirth", "phone"] } });
    assert.equal(ord.status, 201, JSON.stringify(ord.body));
    assert.equal(ord.body.fastingConfirmed, true);
    assert.equal(ord.body.items[0].test.code, "GLU");
    assert.equal((await call(t, "GET", `/appointments?date=${day}`, { token: lab.tokens.RECEPTION })).body.find((a: any) => a.id === ap.id).status, "COMPLETED");
    const first = (await call(t, "GET", `/appointments?date=${day}&search=Ann`, { token: lab.tokens.RECEPTION })).body.find((a: any) => a.patientName === "Ann");
    assert.equal((await call(t, "POST", `/appointments/${first.id}/cancel`, { token: lab.tokens.RECEPTION })).body.status, "CANCELLED");
    assert.equal((await mk("Cal", "09:20")).status, 201, "cancelled booking frees the slot");
  });

  it("queue: tickets per lane, STAT is called first, state machine, board hides names", async () => {
    const a1 = (await call(t, "POST", "/queue/tickets", { token: lab.tokens.RECEPTION, body: { patientName: "Walk 1" } })).body;
    const a2 = (await call(t, "POST", "/queue/tickets", { token: lab.tokens.RECEPTION, body: { patientName: "Walk 2" } })).body;
    const s1 = (await call(t, "POST", "/queue/tickets", { token: lab.tokens.RECEPTION, body: { priority: "URGENT", patientName: "Urgent" } })).body;
    assert.match(a1.code, /^A\d{3}$/);
    assert.equal(Number(a2.code.slice(1)), Number(a1.code.slice(1)) + 1);
    assert.match(s1.code, /^S\d{3}$/);
    const board0 = await call(t, "GET", "/queue/board", { token: lab.tokens.RECEPTION });
    assert.ok(board0.body.waiting.every((w: any) => w.patientName === undefined), "public board shows codes only");
    const c0 = await call(t, "POST", "/queue/call-next", { token: lab.tokens.RECEPTION, body: { counter: "3" } });
    assert.equal(c0.body.priority, "STAT", "the STAT check-in from the appointment test is first");
    await call(t, "POST", `/queue/tickets/${c0.body.id}/done`, { token: lab.tokens.RECEPTION });
    const c1 = await call(t, "POST", "/queue/call-next", { token: lab.tokens.RECEPTION, body: { counter: "1" } });
    assert.equal(c1.status, 201);
    assert.equal(c1.body.priority, "URGENT", "urgent lane jumps the line");
    const c2 = await call(t, "POST", "/queue/call-next", { token: lab.tokens.RECEPTION, body: { counter: "2" } });
    assert.equal(c2.body.code, a1.code);
    assert.equal((await call(t, "POST", `/queue/tickets/${a2.id}/done`, { token: lab.tokens.RECEPTION })).status, 409, "waiting tickets cannot be completed");
    assert.equal((await call(t, "POST", `/queue/tickets/${c2.body.id}/serve`, { token: lab.tokens.RECEPTION })).body.status, "SERVING");
    assert.equal((await call(t, "POST", `/queue/tickets/${c2.body.id}/done`, { token: lab.tokens.RECEPTION })).body.status, "DONE");
    assert.equal((await call(t, "POST", `/queue/tickets/${c1.body.id}/skip`, { token: lab.tokens.RECEPTION })).body.status, "SKIPPED");
    assert.equal((await call(t, "POST", `/queue/tickets/${c1.body.id}/recall`, { token: lab.tokens.RECEPTION })).body.status, "WAITING");
    const board = await call(t, "GET", "/queue/board", { token: lab.tokens.RECEPTION });
    assert.ok(board.body.stats.served >= 1);
    assert.equal((await call(t, "POST", "/queue/tickets", { token: lab.tokens.PHLEBOTOMIST, body: {} })).status, 403);
  });

  it("order edit: field-level revisions, ICD validation, add/remove tests with re-pricing and new specimens, invoice lock, cancel keeps reason", async () => {
    const f = await makeOrder(t, lab, ["GLU"], { clinicalInfo: "polyuria", icdCodes: ["E11"] });
    assert.deepEqual(f.order.icdCodes, ["E11"]);
    const e = await call(t, "PUT", `/orders/${f.orderId}`, { token: lab.tokens.RECEPTION, body: { priority: "STAT", clinicalInfo: "polyuria, weight loss", reason: "doctor call" } });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.priority, "STAT");
    assert.equal(e.body.revision, 1);
    assert.equal((await call(t, "PUT", `/orders/${f.orderId}`, { token: lab.tokens.RECEPTION, body: { icdCodes: ["diabetes"] } })).status, 400);
    assert.equal((await call(t, "PUT", `/orders/${f.orderId}`, { token: lab.tokens.PHLEBOTOMIST, body: { priority: "ROUTINE" } })).status, 403);
    const noop = await call(t, "PUT", `/orders/${f.orderId}`, { token: lab.tokens.RECEPTION, body: { priority: "STAT" } });
    assert.equal(noop.body.revision, 1, "no-op edits do not create revisions");
    const add = await call(t, "POST", `/orders/${f.orderId}/tests`, { token: lab.tokens.RECEPTION, body: { testCodes: ["TSH", "CBC"] } });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.items.length, 3);
    assert.ok(add.body.specimens.length >= 2, "new specimens accessioned for the added tests");
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/tests`, { token: lab.tokens.RECEPTION, body: { testCodes: ["TSH"] } })).body.code, "TEST_ALREADY_ORDERED");
    const tsh = add.body.items.find((i: any) => i.test.code === "TSH");
    const rm = await call(t, "DELETE", `/orders/${f.orderId}/tests/${tsh.id}?reason=duplicate`, { token: lab.tokens.RECEPTION });
    assert.equal(rm.status, 200);
    assert.equal(rm.body.items.find((i: any) => i.id === tsh.id).status, "CANCELLED");
    const revs = await call(t, "GET", `/orders/${f.orderId}/revisions`, { token: lab.tokens.RECEPTION });
    assert.deepEqual(revs.body.map((r: any) => r.revision), [3, 2, 1]);
    assert.equal(revs.body[0].reason, "duplicate");
    const aud = await t.prisma.auditLog.findMany({ where: { orgId: lab.orgId, action: "order.edit", entityId: f.orderId } });
    assert.equal(aud.length, 3);
    assert.ok(!JSON.stringify(aud).includes("polyuria"), "clinical text never in the audit log");
    // invoice lock
    const inv = await call(t, "POST", `/orders/${f.orderId}/invoice`, { token: lab.tokens.RECEPTION });
    assert.equal(inv.status, 201);
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/tests`, { token: lab.tokens.RECEPTION, body: { testCodes: ["KFT"] } })).body.code, "ORDER_INVOICED");
    await call(t, "POST", `/invoices/${inv.body.id}/void`, { token: lab.tokens.RECEPTION, body: { reason: "edit" } });
    assert.equal((await call(t, "POST", `/orders/${f.orderId}/tests`, { token: lab.tokens.RECEPTION, body: { testCodes: ["KFT"] } })).status, 201);
    // package items are locked
    const pk = await makeOrder(t, lab, [], { packageCodes: ["CHECKUP1"], patient: { fullName: "Pk", dateOfBirth: "1980-01-01", phone: "+201999000111" } });
    assert.equal((await call(t, "DELETE", `/orders/${pk.orderId}/tests/${pk.order.items[0].id}`, { token: lab.tokens.RECEPTION })).body.code, "PACKAGE_ITEM_LOCKED");
    // cancel records reason, who and when
    const c = await call(t, "POST", `/orders/${f.orderId}/cancel`, { token: lab.tokens.RECEPTION, body: { reason: "patient left" } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.equal(c.body.cancelReason, "patient left");
    assert.ok(c.body.cancelledAt && c.body.cancelledBy);
    assert.equal((await call(t, "PUT", `/orders/${f.orderId}`, { token: lab.tokens.RECEPTION, body: { priority: "ROUTINE" } })).body.code, "ORDER_NOT_EDITABLE");
  });

  it("ICD-10 hints search and specimen labels carry a QR plus ZPL for the whole order", async () => {
    const r = await call(t, "GET", "/icd/search?q=thyroid", { token: lab.tokens.RECEPTION });
    assert.ok(r.body.length >= 2 && r.body.every((h: any) => h.suggest.length));
    const f = await makeOrder(t, lab, ["CBC", "GLU"], { patient: { fullName: "Label Pt", dateOfBirth: "1975-05-05", phone: "+201777000222" } });
    const labels = await call(t, "GET", `/orders/${f.orderId}/labels`, { token: lab.tokens.PHLEBOTOMIST });
    assert.equal(labels.status, 200);
    assert.equal(labels.body.length, 2);
    for (const l of labels.body) {
      assert.match(l.svg, /^<svg/);
      assert.match(l.qrSvg, /^<svg[^>]*viewBox/);
      assert.match(l.qrPayload, /^KLB\|/);
      assert.match(l.zpl, /\^BQN/);
    }
    assert.ok(labels.body.some((l: any) => l.fasting), "glucose label flags fasting");
  });
});
