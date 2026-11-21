import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CriticalService } from "./critical.service";

type Row = { id: string; orgId: string; status: string; acknowledgedBy: string | null; acknowledgedAt: Date | null; readBackNote: string | null };

function harness(status = "OPEN") {
  const row: Row = { id: "a1", orgId: "o1", status, acknowledgedBy: null, acknowledgedAt: null, readBackNote: null };
  const audits: { meta: Record<string, unknown> }[] = [];
  const sent: unknown[] = [];
  const db = {
    criticalAlert: {
      findFirst: async ({ where }: { where: { id: string; orgId: string } }) => (where.id === row.id && where.orgId === row.orgId ? { ...row } : null),
      updateMany: async ({ where, data }: { where: { id: string; status: { in: string[] } } ; data: Partial<Row> }) => { if (where.id !== row.id || !where.status.in.includes(row.status)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; },
      findUniqueOrThrow: async () => ({ ...row }),
    },
  };
  const prisma = { ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) };
  const audit = { record: async (e: { meta: Record<string, unknown> }) => { audits.push(e); } };
  const messaging = { send: async (m: unknown) => { sent.push(m); } };
  const svc = new CriticalService(prisma as never, audit as never, messaging as never, {} as never);
  return { svc, row, audits, sent };
}
const dir = { staffId: "s1", orgId: "o1", role: "LAB_DIRECTOR" } as never;
const other = { staffId: "s2", orgId: "o1", role: "OWNER" } as never;

describe("critical alert acknowledgement read-back note", () => {
  it("stores the trimmed note on the alert and audits only hasNote", async () => {
    const h = harness();
    const out = await h.svc.acknowledge(dir, "a1", "  read back by Dr X  ");
    assert.equal(out.readBackNote, "read back by Dr X");
    assert.equal(out.acknowledgedBy, "s1");
    assert.deepEqual(h.audits[0].meta, { late: false, hasNote: true });
    assert.ok(!JSON.stringify(h.audits).includes("Dr X"));
    assert.equal(h.sent.length, 0);
  });
  it("blank note stores null; note capped at 500", async () => {
    const a = harness(); assert.equal((await a.svc.acknowledge(dir, "a1", "   ")).readBackNote, null);
    const b = harness("ESCALATED"); const o = await b.svc.acknowledge(dir, "a1", "x".repeat(900)); assert.equal(o.readBackNote!.length, 500); assert.equal(b.audits[0].meta.late, true);
  });
  it("first acknowledger wins; a replay is a 409 and changes nothing", async () => {
    const h = harness();
    await h.svc.acknowledge(dir, "a1", "first");
    await assert.rejects(() => h.svc.acknowledge(other, "a1", "second"), (e: { status?: number }) => e.status === 409);
    assert.equal(h.row.readBackNote, "first"); assert.equal(h.row.acknowledgedBy, "s1"); assert.equal(h.audits.length, 1);
  });
  it("unknown alert is 404", async () => {
    await assert.rejects(() => harness().svc.acknowledge(dir, "nope", "n"), (e: { status?: number }) => e.status === 404);
  });
});
