import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GENERAL_FEATURE, MobileUpgradeService, UPGRADE_DEDUPE_MS, cleanNote, findDuplicate, isKnownFeature } from "./mobile-upgrade.service";

type Row = { id: string; orgId: string; staffId: string; role: string; featureKey: string; plan: string; note: string | null; notifiedCount: number; createdAt: Date };

function harness(opts: { enabled?: boolean } = {}) {
  const rows: Row[] = []; const pushes: unknown[][] = []; const audits: unknown[] = [];
  const prisma = {
    tenant: { findUniqueOrThrow: async () => ({ edition: "LITE", marketCode: "EG" }) },
    mobileUpgradeRequest: {
      findMany: async ({ where }: { where: { staffId: string; featureKey: string; createdAt: { gt: Date } } }) => rows.filter((r) => r.staffId === where.staffId && r.featureKey === where.featureKey && r.createdAt > where.createdAt.gt),
      create: async ({ data }: { data: Omit<Row, "id" | "createdAt" | "notifiedCount"> }) => { const r = { ...data, id: `r${rows.length + 1}`, notifiedCount: 0, createdAt: new Date() }; rows.push(r); return r; },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
  };
  const ent = { evaluate: () => ({ enabled: opts.enabled ?? false }) };
  const push = { notifyRoles: async (...a: unknown[]) => { pushes.push(a); return 1; } };
  const audit = { record: async (e: unknown) => { audits.push(e); } };
  return { svc: new MobileUpgradeService(prisma as never, audit as never, ent as never, push as never), rows, pushes, audits };
}
const tech = { staffId: "s1", orgId: "o1", role: "TECHNOLOGIST" } as never;

describe("mobile upgrade request", () => {
  it("validates feature keys against the module registry", () => {
    assert.ok(isKnownFeature("lab.qc") && isKnownFeature(GENERAL_FEATURE));
    assert.ok(!isKnownFeature("clinic.vitals") && !isKnownFeature("x"));
  });
  it("findDuplicate only matches inside the 24h window", () => {
    const now = Date.now();
    assert.equal(findDuplicate([{ createdAt: new Date(now - UPGRADE_DEDUPE_MS - 1) }], now), null);
    assert.ok(findDuplicate([{ createdAt: new Date(now - 1000) }], now));
  });
  it("cleanNote trims, caps and rejects non-text", () => {
    assert.equal(cleanNote("  "), null);
    assert.equal(cleanNote("x".repeat(900))!.length, 500);
    assert.throws(() => cleanNote(5));
  });
  it("records requester, role, org, feature, note and notifies the owner once", async () => {
    const h = harness();
    const r = await h.svc.request(tech, { featureKey: "lab.qc", note: "QC on my phone" });
    assert.equal(r.status, "REQUESTED"); assert.equal(r.deduped, false); assert.equal(r.notified, 1);
    assert.deepEqual([h.rows[0].orgId, h.rows[0].staffId, h.rows[0].role, h.rows[0].featureKey, h.rows[0].note, h.rows[0].plan], ["o1", "s1", "TECHNOLOGIST", "lab.qc", "QC on my phone", "LITE"]);
    assert.deepEqual(h.pushes[0][1], ["OWNER"]); assert.equal(h.pushes[0][2], "UPGRADE_REQUEST");
    assert.equal(h.audits.length, 1);
  });
  it("is idempotent: a repeat inside 24h returns the original and does not notify again", async () => {
    const h = harness();
    const a = await h.svc.request(tech, { featureKey: "lab.qc" });
    const b = await h.svc.request(tech, { featureKey: "lab.qc" });
    assert.equal(b.deduped, true); assert.equal(b.id, a.id); assert.equal(b.requestedAt, a.requestedAt);
    assert.equal(h.rows.length, 1); assert.equal(h.pushes.length, 1);
  });
  it("a different feature is a new request; old requests (>24h) do not block", async () => {
    const h = harness();
    await h.svc.request(tech, { featureKey: "lab.qc" });
    assert.equal((await h.svc.request(tech, { featureKey: "lab.tat" })).deduped, false);
    h.rows[0].createdAt = new Date(Date.now() - UPGRADE_DEDUPE_MS - 5);
    assert.equal((await h.svc.request(tech, { featureKey: "lab.qc" })).deduped, false);
    assert.equal(h.rows.length, 3);
  });
  it("rejects unknown features and records nothing when the org already has the app", async () => {
    await assert.rejects(harness().svc.request(tech, { featureKey: "nope" }));
    const h = harness({ enabled: true });
    assert.equal((await h.svc.request(tech, {})).status, "ALREADY_ENTITLED");
    assert.equal(h.rows.length, 0);
  });
});
