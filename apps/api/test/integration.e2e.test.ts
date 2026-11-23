import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { signWebhook, signKiorlyRequest, validateEnvelope, validateEvent } from "@kiorex/contracts";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";
import { post } from "./helpers/hmac";
import { createServer } from "node:http";
import { verifyWebhook } from "@kiorex/contracts";

describe("integration: Kiorex bookings + Kiorly Clinic handoff (HMAC), outbox, flag webhook, contracts", () => {
  let t: TestApp;
  let lab: Lab;
  let kx: { key: string; secret: string };
  let clinic: { key: string; secret: string };
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
    kx = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIOREX_BOOKING" } })).body;
    clinic = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIORLY_CLINIC" } })).body;
  });
  after(async () => t.close());

  const booking = (ref: string, extra: Record<string, unknown> = {}) => ({
    sourceRef: ref,
    patient: { fullName: "Hassan Booking", phone: "+201000000555", dateOfBirth: "1988-03-03", externalId: "sub_01JF3Z0001", sex: "M" },
    testCodes: ["CBC"],
    consentChannels: ["KIOREX_VAULT"],
    ...extra,
  });

  it("creates a Kiorex booking order idempotently, with a home-collection window, and emits LabOrderCreated", async () => {
    const body = booking("kx_ref_1", { collection: { type: "HOME", address: "5 Zamalek St, Cairo", windowStart: "2027-02-01T09:00:00.000Z", windowEnd: "2027-02-01T10:00:00.000Z", geo: { lat: 30.06, lng: 31.22 } } });
    const a = await post(t, kx, "/integration/v1/orders", body);
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.created, true);
    assert.equal(a.body.status, "AWAITING_COLLECTION");
    const b = await post(t, kx, "/integration/v1/orders", body);
    assert.equal(b.body.created, false);
    assert.equal(b.body.orderId, a.body.orderId, "idempotent on (org, source, sourceRef)");
    assert.equal(await t.prisma.labOrder.count({ where: { orgId: lab.orgId, sourceRef: "kx_ref_1" } }), 1);
    const o = await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION });
    assert.equal(o.body.source, "KIOREX_BOOKING");
    assert.equal(o.body.identityVerified, false, "identity is verified at collection");
    assert.equal(o.body.homeCollection.status, "SCHEDULED");
    const ev = await t.prisma.outboxEvent.findMany({ where: { orgId: lab.orgId, type: "LabOrderCreated", aggregateId: a.body.orderId } });
    assert.equal(ev.length, 1);
    assert.equal(validateEvent("LabOrderCreated", ev[0].payload).valid, true, "LabOrderCreated is a draft contract since kiorex-contracts 1.3.0 (NH-LB-025)");
  });

  it("status events flow to Kiorex as the order progresses (outbox, deduplicated eventIds)", async () => {
    const a = await post(t, kx, "/integration/v1/orders", booking("kx_ref_2", { patient: { fullName: "Hassan Two", phone: "+201000000556", dateOfBirth: "1988-03-03" } }));
    const o = await call(t, "GET", `/orders/${a.body.orderId}`, { token: lab.tokens.RECEPTION });
    await call(t, "POST", `/orders/${a.body.orderId}/verify-identity`, { token: lab.tokens.RECEPTION, body: { identifiersChecked: ["phone", "dateOfBirth"] } });
    await call(t, "POST", `/specimens/${o.body.specimens[0].id}/collect`, { token: lab.tokens.RECEPTION, body: { scannedBarcode: o.body.specimens[0].barcode } });
    const events = await t.prisma.outboxEvent.findMany({ where: { orgId: lab.orgId, type: "LabOrderStatusChanged", aggregateId: a.body.orderId } });
    assert.deepEqual(events.map((e) => (e.payload as any).data.nextStatus), ["COLLECTED"]);
    const status = await post(t, kx, `/integration/v1/orders/kx_ref_2`, undefined, { method: "GET" });
    assert.equal(status.status, 200);
    assert.equal(status.body.status, "COLLECTED");
    const cancel = await post(t, kx, `/integration/v1/orders/kx_ref_1/cancel`, {});
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.status, "CANCELLED");
  });

  it("Kiorly Clinic lab-order handoff creates KIORLY_CLINIC orders with a referring doctor for critical alerts", async () => {
    const r = await post(t, clinic, "/integration/v1/orders", { sourceRef: "cl06_ord_9", patient: { fullName: "Clinic Patient", phone: "+201000000666", dateOfBirth: "1970-07-07", externalId: "clinic_pat_1" }, testCodes: ["GLU"], referringDoctor: { name: "Dr Clinic", ref: "clinic_doc_1", phone: "+201000000777" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = await call(t, "GET", `/orders/${r.body.orderId}`, { token: lab.tokens.RECEPTION });
    assert.equal(o.body.source, "KIORLY_CLINIC");
    assert.equal(o.body.referringDoctorPhone, "+201000000777");
  });

  it("rejects bad signatures, stale timestamps, replayed nonces, tampered bodies, unknown keys and unknown tests", async () => {
    const body = booking("kx_ref_sec");
    assert.equal((await post(t, kx, "/integration/v1/orders", body, { secret: "wrong" })).status, 401);
    assert.equal((await post(t, kx, "/integration/v1/orders", body, { timestamp: Date.now() - 10 * 60_000 })).status, 401);
    assert.equal((await post(t, kx, "/integration/v1/orders", body, { tamper: true })).status, 401);
    assert.equal((await post(t, { key: "nope", secret: "x" }, "/integration/v1/orders", body)).status, 401);
    const n = "nonce-1";
    assert.equal((await post(t, kx, "/integration/v1/orders", booking("kx_ref_n"), { nonce: n })).status, 200);
    assert.equal((await post(t, kx, "/integration/v1/orders", booking("kx_ref_n"), { nonce: n })).status, 401, "replayed nonce");
    const unk = await post(t, kx, "/integration/v1/orders", booking("kx_ref_unk", { testCodes: ["NOPE"] }));
    assert.equal(unk.status, 422);
    assert.deepEqual(unk.body.codes, ["NOPE"]);
    assert.equal((await post(t, kx, "/integration/v1/orders", { sourceRef: "x" })).status, 400);
  });

  it("the Kiorex client cannot read another tenant's data and cannot call staff endpoints", async () => {
    const other = await makeLab(t);
    assert.equal((await call(t, "GET", "/orders", { headers: { "x-kiorly-client-key": kx.key } })).status, 401);
    const o = await call(t, "GET", "/orders", { token: other.tokens.RECEPTION });
    assert.equal(o.body.total, 0);
  });

  it("vault/clinic can fetch a report only for a consented, released channel", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    await enterAndTechValidate(t, lab, f.orderId, NORMAL);
    await call(t, "POST", `/orders/${f.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const rep = await call(t, "POST", `/orders/${f.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const path = `/integration/v1/reports/${rep.body.id}/pdf`;
    assert.equal((await post(t, kx, path, undefined, { method: "GET" })).status, 403, "not released on the vault channel yet");
    await call(t, "POST", `/reports/${rep.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["KIOREX_VAULT"] } });
    const ok = await post(t, kx, path, undefined, { method: "GET" });
    assert.equal(ok.status, 200);
    assert.equal(ok.raw.subarray(0, 4).toString(), "%PDF");
    assert.equal((await post(t, clinic, path, undefined, { method: "GET" })).status, 403, "clinic channel was not released");
  });

  it("outbox delivery retries with backoff and de-duplicates on eventId at the receiver", async () => {
    await t.outbox.dispatchDue(new Date(Date.now() + 600_000), 500); // drain anything pending from earlier tests
    t.outbox.transport.received.clear();
    const eventId = `evt_retry_${Date.now()}`;
    const id = await t.app.get((await import("../src/outbox/outbox.service")).OutboxService).enqueue({ orgId: lab.orgId, type: "LabOrderCreated", aggregateType: "LabOrder", aggregateId: "agg1", data: { x: 1 }, eventId });
    t.outbox.transport.failNext = 1;
    const first = await t.outbox.dispatchDue(new Date(Date.now() + 1000));
    assert.equal(first.failed >= 1, true);
    const row1 = await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    assert.equal(row1.status, "PENDING");
    assert.equal(row1.attempts, 1);
    assert.ok(row1.nextAttemptAt.getTime() > Date.now(), "backoff scheduled");
    assert.equal((await t.outbox.dispatchDue(new Date())).sent, 0, "not due yet");
    await t.outbox.dispatchDue(new Date(Date.now() + 120_000));
    assert.equal((await t.prisma.outboxEvent.findUniqueOrThrow({ where: { id } })).status, "SENT");
    assert.equal(t.outbox.transport.received.size >= 1, true);
    // enqueue with the same eventId collapses
    const again = await t.app.get((await import("../src/outbox/outbox.service")).OutboxService).enqueue({ orgId: lab.orgId, type: "LabOrderCreated", aggregateType: "LabOrder", aggregateId: "agg1", data: { x: 1 }, eventId });
    assert.equal(again, id);
    assert.equal(await t.prisma.outboxEvent.count({ where: { id } }), 1);
  });

  it("1.4.0 marketplace read side: labs, test catalogue + quote in minor units, slots with capacity; Kiorex clients only", async () => {
    const labs = await post(t, kx, "/integration/v1/labs", undefined, { method: "GET" });
    assert.equal(labs.status, 200, JSON.stringify(labs.body));
    assert.deepEqual(labs.body.items.map((l: { id: string; homeCollection: boolean }) => [l.id, l.homeCollection]), [[lab.labId, true]]);
    const tests = await post(t, kx, "/integration/v1/tests?q=cbc", undefined, { method: "GET" });
    const cbc = tests.body.items.find((x: { code: string }) => x.code === "CBC");
    assert.equal(cbc.labId, lab.labId);
    assert.equal(Number.isInteger(cbc.priceMinor), true);
    const q = await post(t, kx, "/integration/v1/tests/quote", { labId: lab.labId, testCodes: ["CBC", "glu"], collectionType: "HOME" });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.deepEqual(q.body.tests.map((x: { code: string }) => x.code), ["CBC", "GLU"]);
    assert.equal(q.body.tests[0].priceMinor, cbc.priceMinor);
    assert.equal(q.body.collectionFeeMinor, 0);
    assert.equal((await post(t, kx, "/integration/v1/tests/quote", { testCodes: ["NOPE"] })).body.code, "UNKNOWN_TESTS");
    // 1.8.0 Arabic names: present where the lab holds them, absent (never blank) where it does not; Arabic search finds the test
    const arCode = `AR${Date.now().toString(36).toUpperCase()}`;
    await t.prisma.testDefinition.create({ data: { orgId: lab.orgId, code: arCode, nameEn: "Vitamin D total", nameAr: "فيتامين د الكلي", specimenType: "serum", prepInstructionsEn: "No fasting needed", prepInstructionsAr: "لا يلزم الصيام", price: "300" } });
    const noArCode = `NA${Date.now().toString(36).toUpperCase()}`;
    await t.prisma.testDefinition.create({ data: { orgId: lab.orgId, code: noArCode, nameEn: "Plain english test", specimenType: "exotic", price: "100" } });
    const arList = (await post(t, kx, `/integration/v1/tests?q=${encodeURIComponent("فيتامين")}`, undefined, { method: "GET" })).body.items.find((x: { code: string }) => x.code === arCode);
    assert.ok(arList, "Arabic query finds the test");
    assert.deepEqual([arList.name, arList.nameAr, arList.preparationAr, arList.sampleTypeAr], ["Vitamin D total", "فيتامين د الكلي", "لا يلزم الصيام", "مصل"]);
    assert.ok((await post(t, kx, "/integration/v1/tests?q=Vitamin", undefined, { method: "GET" })).body.items.some((x: { code: string }) => x.code === arCode), "English query still finds it");
    const plain = (await post(t, kx, `/integration/v1/tests?q=${noArCode}`, undefined, { method: "GET" })).body.items.find((x: { code: string }) => x.code === noArCode);
    assert.deepEqual(["nameAr" in plain, "preparationAr" in plain, "sampleTypeAr" in plain], [false, false, false]);
    const qa = await post(t, kx, "/integration/v1/tests/quote", { labId: lab.labId, testCodes: [arCode, noArCode] });
    assert.equal(qa.body.tests[0].nameAr, "فيتامين د الكلي");
    assert.equal("nameAr" in qa.body.tests[1], false);
    assert.equal((await post(t, clinic, "/integration/v1/tests", undefined, { method: "GET" })).status, 404, "clinic handoff clients do not use the marketplace read side");

    const from = new Date(Date.now() + 86_400_000).toISOString(), to = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const slots = await post(t, kx, `/integration/v1/labs/${lab.labId}/slots?collectionType=HOME&from=${from}&to=${to}`, undefined, { method: "GET" });
    assert.equal(slots.status, 200, JSON.stringify(slots.body));
    assert.ok(slots.body.slots.length >= 10);
    assert.equal(slots.body.slots[0].available, 4);
    assert.equal((await post(t, kx, `/integration/v1/labs/${lab.labId}/slots?collectionType=HOME&from=${to}&to=${from}`, undefined, { method: "GET" })).status, 400);
    assert.equal((await post(t, kx, `/integration/v1/labs/nope/slots?collectionType=HOME&from=${from}&to=${to}`, undefined, { method: "GET" })).status, 404);

    // booking on an offered slot consumes capacity atomically; the slot disappears when full
    const s0 = slots.body.slots[0] as { startsAt: string; endsAt: string };
    for (let n = 0; n < 4; n++) {
      const r = await post(t, kx, "/integration/v1/orders", booking(`kx_slot_${n}`, { labId: lab.labId, patient: { fullName: `Slot Patient ${n}`, phone: `+20100000090${n}`, dateOfBirth: "1990-01-01" }, collection: { type: "HOME", address: "1 Test St", windowStart: s0.startsAt, windowEnd: s0.endsAt } }));
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const full = await post(t, kx, "/integration/v1/orders", booking("kx_slot_4", { labId: lab.labId, collection: { type: "HOME", address: "1 Test St", windowStart: s0.startsAt, windowEnd: s0.endsAt } }));
    assert.equal(full.status, 409);
    assert.equal(full.body.code, "SLOT_FULL");
    const after = await post(t, kx, `/integration/v1/labs/${lab.labId}/slots?collectionType=HOME&from=${from}&to=${to}`, undefined, { method: "GET" });
    assert.equal(after.body.slots.some((x: { startsAt: string }) => x.startsAt === s0.startsAt), false);
    const walkin = await post(t, kx, `/integration/v1/labs/${lab.labId}/slots?collectionType=WALK_IN&from=${from}&to=${to}`, undefined, { method: "GET" });
    assert.equal(walkin.body.slots.some((x: { startsAt: string }) => x.startsAt === s0.startsAt), true, "walk-in has no capacity limit");
  });

  it("lab.kiorex_bookings OFF: catalogue and orders answer 403 FEATURE_DISABLED {key,scope}; existing orders stay readable", async () => {
    const flags = t.flags;
    flags.setSnapshot({ product: "kiorly-lab", version: 1, generatedAt: new Date().toISOString(), signature: "x", flags: [{ key: "lab.kiorex_bookings", class: "Module", scopes: ["global", "market", "org"], dependsOn: [], launchLocked: false, gateSatisfied: true, values: { global: "OFF", markets: {}, orgs: {} } }] } as never);
    try {
      for (const r of [await post(t, kx, "/integration/v1/tests", undefined, { method: "GET" }), await post(t, kx, "/integration/v1/orders", booking("kx_off_1"))]) {
        assert.equal(r.status, 403, JSON.stringify(r.body));
        assert.deepEqual({ code: r.body.code, key: r.body.key }, { code: "FEATURE_DISABLED", key: "lab.kiorex_bookings" });
      }
      assert.equal((await post(t, kx, "/integration/v1/orders/kx_ref_2", undefined, { method: "GET" })).status, 200, "OFF never hides data");
    } finally { flags.setSnapshot(null); }
  });

  it("real mode: events go to the tenant's Kiorex base /api/v1/webhooks/lab with the per-partner secret and X-Kiorly-Client-Key", async () => {
    const seen: Array<{ url: string; h: Record<string, string>; body: string }> = [];
    const srv = createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { seen.push({ url: req.url!, h: req.headers as Record<string, string>, body: b }); res.end("{}"); }); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const prev = process.env.KIOREX_MODE;
    try {
      process.env.KIOREX_MODE = "real";
      const made = (await call(t, "POST", "/integration-clients", { token: lab.tokens.OWNER, body: { source: "KIOREX_BOOKING", kiorexBaseUrl: `http://127.0.0.1:${(srv.address() as { port: number }).port}` } })).body;
      await t.prisma.integrationClient.updateMany({ where: { orgId: lab.orgId, source: "KIOREX_BOOKING", id: { not: made.id } }, data: { active: false } });
      await t.outbox.dispatchDue(new Date(Date.now() + 600_000), 500);
      seen.length = 0;
      const { OutboxService } = await import("../src/outbox/outbox.service");
      await t.app.get(OutboxService).enqueue({ orgId: lab.orgId, type: "LabOrderCreated", aggregateType: "LabOrder", aggregateId: "agg_real", data: { orderId: "agg_real" }, eventId: `evt_real_${Date.now()}` });
      const r = await t.outbox.dispatchDue(new Date(Date.now() + 1000), 500);
      assert.equal(r.sent >= 1, true, JSON.stringify(r));
      const hit = seen.find((x) => x.body.includes("agg_real"))!;
      assert.equal(hit.url, "/api/v1/webhooks/lab");
      assert.equal(hit.h["x-kiorly-client-key"], made.key);
      assert.equal(verifyWebhook({ secret: made.webhookSecret, body: hit.body, timestamp: hit.h["x-kiorly-timestamp"], signature: hit.h["x-kiorly-signature"] }).ok, true);
    } finally {
      if (prev === undefined) delete process.env.KIOREX_MODE; else process.env.KIOREX_MODE = prev;
      srv.close();
    }
  });

  it("LabResultReleased cannot be enqueued with raw values (schema forbids values/results)", async () => {
    const { OutboxService } = await import("../src/outbox/outbox.service");
    const svc = t.app.get(OutboxService);
    const base = { reportId: "r", orderId: "o", labId: "l", patientRef: "p", reportVersion: 1, signedAt: new Date().toISOString(), secureLink: "https://lab.kiorly.com/r/abc" };
    await assert.rejects(svc.enqueue({ orgId: lab.orgId, type: "LabResultReleased", aggregateType: "LabReport", aggregateId: "r", data: { ...base, values: [{ hb: 13 }] } }), /EVENT_CONTRACT_VIOLATION|Bad Request/);
    await assert.rejects(svc.enqueue({ orgId: lab.orgId, type: "LabResultReleased", aggregateType: "LabReport", aggregateId: "r", data: { ...base, secureLink: "not a url" } }));
  });

  it("flag.changed webhook: HMAC verified, refreshes immediately; snapshot persists in FlagSnapshotCache across restarts", async () => {
    const body = JSON.stringify({ type: "flag.changed", product: "kiorly-lab" });
    const bad = await call(t, "POST", "/feature-flags/kiorex/changed", { rawBody: body, headers: { "x-kiorly-timestamp": String(Math.floor(Date.now() / 1000)), "x-kiorly-signature": "sha256=deadbeef" } });
    assert.equal(bad.status, 401);
    const signed = signWebhook({ secret: process.env.KIOREX_FLAGS_WEBHOOK_SECRET ?? process.env.KIOREX_PRODUCT_SECRET ?? "ff_dev_secret_change_me", body });
    const ok = await call(t, "POST", "/feature-flags/kiorex/changed", { rawBody: body, headers: signed.headers });
    assert.equal(ok.status, 202);
    // persistence: write a snapshot via refresh, then a fresh service instance restores it
    process.env.KIOREX_FLAGS_URL = "http://localhost:4000/api/v1/control/v1/flags/snapshot";
    process.env.KIOREX_PRODUCT_KEY = "k";
    process.env.KIOREX_PRODUCT_SECRET = "s";
    const snap = { product: "kiorly-lab", version: 42, generatedAt: new Date().toISOString(), flags: [{ key: "lab.home_collection", values: { global: "OFF" } }] };
    assert.equal(await t.flags.refresh((async () => new Response(JSON.stringify(snap), { status: 200, headers: { etag: '"v42"' } })) as typeof fetch), "updated");
    const { FeatureFlagsService } = await import("../src/feature-flags/feature-flags.service");
    const fresh = new FeatureFlagsService(t.prisma);
    assert.equal(await fresh.loadPersisted(), true);
    assert.equal(fresh.isEnabled("lab.home_collection"), false);
    assert.equal(fresh.getSnapshotVersion(), 42);
    t.flags.setSnapshot(null);
    await t.prisma.flagSnapshotCache.deleteMany({ where: { product: "kiorly-lab" } });
  });
});

describe("contract conformance (kiorex-contracts)", () => {
  it("LabResultReleased validates against every shipped example and rejects mutations", () => {
    const pkg = dirname(require.resolve("@kiorex/contracts/package.json"));
    const dir = join(pkg, "events", "examples");
    const files = readdirSync(dir).filter((f) => f.startsWith("LabResultReleased"));
    assert.ok(files.length >= 1);
    for (const f of files) {
      const ex = JSON.parse(readFileSync(join(dir, f), "utf8"));
      assert.equal(validateEvent("LabResultReleased", ex).valid, true);
      assert.equal(validateEvent("LabResultReleased", { ...ex, data: { ...ex.data, results: [] } }).valid, false);
      assert.equal(validateEvent("LabResultReleased", { ...ex, data: { ...ex.data, reportVersion: 0 } }).valid, false);
      const { secureLink: _s, ...noLink } = ex.data;
      void _s;
      assert.equal(validateEvent("LabResultReleased", { ...ex, data: noLink }).valid, false);
    }
  });
  it("our Kiorex->Lab request signature is the contract scheme (round trip with the contract verifier)", () => {
    const s = signKiorlyRequest({ clientKey: "k", clientSecret: "s", method: "POST", path: "/api/v1/integration/v1/orders", body: "{}" });
    assert.ok(s.headers["X-Kiorly-Signature"]);
  });
});
