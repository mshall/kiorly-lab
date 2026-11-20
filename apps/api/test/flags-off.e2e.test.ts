import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SAFETY_CONTROLS } from "@kiorly/lab-shared";
import { REQUIRES_FLAG } from "../src/feature-flags/requires-flag.guard";
import { FLAG_DEFINITIONS, FLAG_KEYS } from "../src/feature-flags/feature-flag-keys";
import { SAFETY_PATH_DIRS, SafetyControlNotAFlagError } from "../src/feature-flags/safety-controls";
import { BOUNDED_CONTEXTS } from "../src/modules/modules.registry";
import { AnalysisQcController } from "../src/modules/analysis-qc/analysis-qc.controller";
import { CriticalController } from "../src/modules/critical/critical.controller";
import { FieldSafetyController } from "../src/modules/field-safety/field-safety.controller";
import { ReleaseController } from "../src/modules/release/release.controller";
import { SpecimensController } from "../src/modules/specimens/specimens.controller";
import { type Lab, type TestApp, NORMAL, bootApp, call, enterAndTechValidate, makeLab, makeOrder, qcPass, toProcessing } from "./helpers/app";

const snapshot = (flags: object[]) => ({ product: "kiorly-lab", version: 1, generatedAt: new Date().toISOString(), flags: flags as never });
const off = (key: string, scope: "global" | { org: string } | { market: string } = "global") => ({ key, values: scope === "global" ? { global: "OFF" } : "org" in scope ? { orgs: { [scope.org]: "OFF" } } : { markets: { [scope.market]: "OFF" } } });
const FORBIDDEN = (r: { status: number; body: any }, key: string, scope = "global") => {
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, "FEATURE_DISABLED");
  assert.equal(r.body.key, key);
  assert.equal(r.body.scope, scope);
};

describe("OFF contract tests (LB-OFF01..04): OFF => 403 FEATURE_DISABLED {key,scope}, never hides data", () => {
  let t: TestApp;
  let lab: Lab;
  let other: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
    other = await makeLab(t);
  });
  after(async () => t.close());
  beforeEach(() => t.flags.setSnapshot(null));

  it("LB-OFF01 lab.module OFF: no new sign-ups/orders/catalogue edits; existing data stays readable; safety work continues", async () => {
    const existing = await makeOrder(t, lab, ["CBC"]);
    t.flags.setSnapshot(snapshot([off("lab.module")]));
    FORBIDDEN(await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "New Person" }, testCodes: ["GLU"] } }), "lab.module");
    FORBIDDEN(await call(t, "POST", "/catalogue/tests", { token: lab.tokens.LAB_DIRECTOR, body: { code: "X1", nameEn: "X", specimenType: "Serum", price: 1, analyteCodes: ["GLU"] } }), "lab.module");
    FORBIDDEN(await call(t, "POST", "/onboarding/tenants", { body: { name: "Newco", slug: "newco-lab", labName: "Lab Name", labCode: "NL", ownerName: "Owner", ownerEmail: "o@newco.test" } }), "lab.module");
    // reads are never hidden
    const read = await call(t, "GET", `/orders/${existing.orderId}`, { token: lab.tokens.RECEPTION });
    assert.equal(read.status, 200);
    assert.equal((await call(t, "GET", "/orders", { token: lab.tokens.RECEPTION })).status, 200);
    assert.equal((await call(t, "GET", "/catalogue/tests", { token: lab.tokens.RECEPTION })).status, 200);
    t.flags.setSnapshot(null);
  });

  it("LB-OFF02 lab.analyzer_interfaces OFF: bridge + simulator refused, manual entry with dual control still works", async () => {
    const f = await makeOrder(t, lab, ["GLU"]);
    await toProcessing(t, lab, f);
    t.flags.setSnapshot(snapshot([off("lab.analyzer_interfaces")]));
    const key = await call(t, "POST", `/instruments/${lab.instruments.astm}/api-key`, { token: lab.tokens.TECHNOLOGIST });
    assert.equal(key.status, 201);
    const post = await call(t, "POST", "/analyzers/ingest", { headers: { "x-instrument-key": key.body.apiKey }, body: { instrumentId: lab.instruments.astm, payload: "H|\\^&\rL|1|N\r" } });
    FORBIDDEN(post, "lab.analyzer_interfaces");
    FORBIDDEN(await call(t, "POST", "/analyzers/simulate", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.astm, specimenId: f.specimens[0].id } }), "lab.analyzer_interfaces");
    FORBIDDEN(await call(t, "GET", "/analyzers/messages", { token: lab.tokens.TECHNOLOGIST }), "lab.analyzer_interfaces");
    // manual entry remains available
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    assert.equal((await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.GLU, instrumentId: lab.instruments.bench, value: 88 } })).status, 201);
    t.flags.setSnapshot(null);
  });

  it("LB-OFF03 lab.home_collection OFF: walk-in only; home endpoints refused; existing home data stays readable", async () => {
    const home = await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "Home Pat", phone: "+201000000333", dateOfBirth: "1985-01-01" }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { address: "12 Nile St, Cairo", geo: { lat: 30.05, lng: 31.24 } } } });
    assert.equal(home.status, 400, "slot required");
    const slots = await call(t, "GET", "/home-collection/slots?date=2027-01-10", { token: lab.tokens.RECEPTION });
    assert.equal(slots.status, 200);
    const ok = await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "Home Pat", phone: "+201000000333", dateOfBirth: "1985-01-01" }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { slotId: slots.body[0].id, address: "12 Nile St, Cairo", geo: { lat: 30.05, lng: 31.24 } } } });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    t.flags.setSnapshot(snapshot([off("lab.home_collection")]));
    FORBIDDEN(await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "Home Pat 2" }, testCodes: ["GLU"], collectionType: "HOME", homeCollection: { slotId: slots.body[1].id, address: "Somewhere 5" } } }), "lab.home_collection");
    FORBIDDEN(await call(t, "GET", "/home-collection/slots?date=2027-01-10", { token: lab.tokens.RECEPTION }), "lab.home_collection");
    FORBIDDEN(await call(t, "GET", "/home-collections", { token: lab.tokens.RECEPTION }), "lab.home_collection");
    // walk-in works, and the already-booked home order is still visible
    assert.equal((await call(t, "POST", "/orders", { token: lab.tokens.RECEPTION, body: { patient: { fullName: "Walk In" }, testCodes: ["GLU"] } })).status, 201);
    const seen = await call(t, "GET", `/orders/${ok.body.id}`, { token: lab.tokens.RECEPTION });
    assert.equal(seen.body.homeCollection.status, "SCHEDULED");
    t.flags.setSnapshot(null);
  });

  it("LB-OFF04 lab.kiorex_bookings OFF: Kiorex-sourced orders refused (403) while clinic handoff and existing bookings are unaffected", async () => {
    const owner = lab.tokens.OWNER;
    const kx = (await call(t, "POST", "/integration-clients", { token: owner, body: { source: "KIOREX_BOOKING" } })).body;
    const cl = (await call(t, "POST", "/integration-clients", { token: owner, body: { source: "KIORLY_CLINIC" } })).body;
    const { post } = await import("./helpers/hmac");
    const body = { sourceRef: "kx_book_1", patient: { fullName: "Kiorex Patient", phone: "+201000000444", dateOfBirth: "1992-02-02" }, testCodes: ["GLU"] };
    assert.equal((await post(t, kx, "/integration/v1/orders", body)).status, 200);
    t.flags.setSnapshot(snapshot([off("lab.kiorex_bookings", { org: lab.orgId })]));
    FORBIDDEN(await post(t, kx, "/integration/v1/orders", { ...body, sourceRef: "kx_book_2" }), "lab.kiorex_bookings", "org");
    assert.equal((await post(t, cl, "/integration/v1/orders", { ...body, sourceRef: "clinic_ord_1" })).status, 200, "clinic handoff is not governed by this flag");
    const replay = await post(t, kx, "/integration/v1/orders", body);
    assert.equal(replay.body.created, false, "existing booking is honoured (replay returns it)");
    const list = await call(t, "GET", "/orders?source=KIOREX_BOOKING", { token: lab.tokens.RECEPTION });
    assert.equal(list.body.total, 1, "data is not hidden");
    t.flags.setSnapshot(null);
  });

  it("scopes: market and org OFF only affect that context; dependent flags go OFF with scope dependency", async () => {
    t.flags.setSnapshot(snapshot([off("lab.home_collection", { org: other.orgId })]));
    const me = await call(t, "GET", "/auth/me", { token: lab.tokens.OWNER });
    assert.equal(me.body.flags["lab.home_collection"].enabled, true);
    const me2 = await call(t, "GET", "/auth/me", { token: other.tokens.OWNER });
    assert.equal(me2.body.flags["lab.home_collection"].enabled, false);
    assert.equal(me2.body.flags["lab.home_collection"].scope, "org");
    t.flags.setSnapshot(snapshot([off("lab.module", { market: "EG" })]));
    const me3 = await call(t, "GET", "/auth/me", { token: lab.tokens.OWNER });
    assert.equal(me3.body.flags["lab.module"].scope, "market");
    assert.equal(me3.body.flags["lab.analyzer_interfaces"].scope, "dependency");
    t.flags.setSnapshot(null);
  });
});

describe("LB-SS05 never-flag CI: QC blocks, authorized release and critical escalation cannot be switched off", () => {
  let t: TestApp;
  let lab: Lab;
  before(async () => {
    t = await bootApp();
    lab = await makeLab(t);
  });
  after(async () => t.close());

  it("with EVERY lab flag OFF the whole safety chain still works: QC block, validation, signing, release, critical alert, escalation", async () => {
    const f = await makeOrder(t, lab, ["CBC"]);
    const g = await makeOrder(t, lab, ["GLU"]);
    t.flags.setSnapshot(snapshot(FLAG_KEYS.map((k) => off(k))));
    await toProcessing(t, lab, f);
    await qcPass(t, lab, lab.instruments.bench, ["HB", "WBC", "PLT"]);
    // critical result still raises an alert and escalates
    const item = (await call(t, "GET", `/orders/${f.orderId}`, { token: lab.tokens.TECHNOLOGIST })).body.items[0];
    const crit = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: lab.analytes.HB, instrumentId: lab.instruments.bench, value: 6 } });
    assert.equal(crit.status, 201);
    const alert = await t.prisma.criticalAlert.findFirstOrThrow({ where: { orgId: lab.orgId } });
    assert.equal((await t.critical.sweep(new Date(alert.ackDeadlineAt.getTime() + 1000), { orgId: lab.orgId })).escalated, 1);
    // QC violation still blocks
    const m = await t.prisma.qcMaterialLevel.findUniqueOrThrow({ where: { id: lab.materials.WBC.l1 } });
    const bad = await call(t, "POST", "/qc/runs", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId: lab.instruments.bench, materialId: m.id, value: Number(m.targetMean) + 5 * Number(m.targetSd) } });
    assert.ok(bad.body.blockId);
    // full release chain on a second order still requires everything
    await toProcessing(t, lab, g);
    await qcPass(t, lab, lab.instruments.bench, ["GLU"]);
    await enterAndTechValidate(t, lab, g.orderId, NORMAL);
    assert.equal((await call(t, "POST", `/orders/${g.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY })).status, 409);
    await call(t, "POST", `/orders/${g.orderId}/medical-validate`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    const rep = await call(t, "POST", `/orders/${g.orderId}/reports`, { token: lab.tokens.AUTHORIZED_SIGNATORY });
    assert.equal(rep.status, 201);
    assert.equal((await call(t, "POST", `/reports/${rep.body.id}/release`, { token: lab.tokens.RECEPTION, body: { channels: ["PRINTED"] } })).status, 201);
    t.flags.setSnapshot(null);
  });

  it("no safety control id is a flag; the evaluator throws; flag keys never collide with safety controls", () => {
    for (const c of SAFETY_CONTROLS) assert.throws(() => t.flags.evaluate(c.id), SafetyControlNotAFlagError);
    for (const f of FLAG_DEFINITIONS) assert.ok(!f.key.startsWith("safety.") && !/qc|release|critical|accession|custody|consent|audit|tenant|mfa/i.test(f.key), f.key);
    assert.deepEqual([...SAFETY_PATH_DIRS].sort(), BOUNDED_CONTEXTS.filter((c) => c.safetyPath).map((c) => c.dir).sort());
  });

  it("no route of a safety-path controller carries @RequiresFlag metadata", () => {
    for (const C of [SpecimensController, AnalysisQcController, ReleaseController, CriticalController, FieldSafetyController]) {
      assert.equal(Reflect.getMetadata(REQUIRES_FLAG, C), undefined, `${C.name} (class)`);
      for (const name of Object.getOwnPropertyNames(C.prototype).filter((n) => n !== "constructor")) {
        assert.equal(Reflect.getMetadata(REQUIRES_FLAG, (C.prototype as never)[name]), undefined, `${C.name}.${name}`);
      }
    }
  });

  it("the shared contract catalogue agrees: lab.* flags exist and none of the never-flag safety ids is a flag", () => {
    const cat = JSON.parse(readFileSync(require.resolve("@kiorex/contracts/flags/catalogue.json"), "utf8")) as { flags?: { key: string; product: string; dependsOn: string[]; launchLocked: boolean }[] } | { key: string; product: string; dependsOn: string[]; launchLocked: boolean }[];
    const flags = Array.isArray(cat) ? cat : (cat.flags ?? []);
    const lab = flags.filter((f) => f.product === "kiorly-lab");
    assert.deepEqual(lab.map((f) => f.key).sort(), [...FLAG_KEYS].sort());
    for (const def of FLAG_DEFINITIONS) {
      const c = lab.find((f) => f.key === def.key)!;
      assert.deepEqual([...c.dependsOn].sort(), [...def.dependsOn].sort(), def.key);
      assert.equal(c.launchLocked, def.launchLocked);
    }
    const never = JSON.parse(readFileSync(require.resolve("@kiorex/contracts/flags/safety-never-flags.json"), "utf8"));
    const text = JSON.stringify(never);
    for (const k of FLAG_KEYS) assert.ok(!text.includes(`"${k}"`), `${k} must not be listed as a safety control`);
    assert.ok(resolve(__dirname).length > 0);
  });
});
