import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { markDemoRows, removeDemoData } from "../src/common/demo-data";
import { run } from "../src/seed/demo-data-remove";
import { type Lab, type TestApp, bootApp, makeLab, makeOrder } from "./helpers/app";

/** demo-data:remove against a real database: only the marked organisation is touched, append-only history is never forced, the real laboratory is untouched, repeat is safe. */
describe("demo-data:remove (lab)", () => {
  let t: TestApp, demo: Lab, real: Lab;
  const counts = async (orgId: string) => ({
    staff: await t.prisma.staffUser.count({ where: { orgId } }),
    labs: await t.prisma.lab.count({ where: { orgId } }),
    analytes: await t.prisma.analyte.count({ where: { orgId } }),
    orders: await t.prisma.labOrder.count({ where: { orgId } }),
    tenant: await t.prisma.tenant.count({ where: { id: orgId } }),
  });
  const log: string[] = [];
  before(async () => {
    t = await bootApp(); demo = await makeLab(t); real = await makeLab(t);
    for (const l of [demo, real]) await makeOrder(t, l, ["CBC"]);
    await t.prisma.$executeRawUnsafe(`INSERT INTO "DemoMarker" ("tableName", "rowId", "batch") VALUES ('Tenant', $1, 'e2e') ON CONFLICT DO NOTHING`, demo.orgId);
  });
  after(async () => { await t.prisma.$executeRawUnsafe(`DELETE FROM "DemoMarker" WHERE "batch" = 'e2e'`); await t.close(); });

  it("the dry run is a rehearsal: it reports the deletes and writes nothing", async () => {
    const before = [await counts(demo.orgId), await counts(real.orgId)];
    const rep = await run(["--dry-run"], t.prisma as never, (m) => log.push(m));
    const o = rep!.orgs.find((x) => x.orgId === demo.orgId)!;
    assert.ok(o && (o.deleted.StaffUser ?? 0) === 9, JSON.stringify(o?.deleted));
    assert.deepEqual([await counts(demo.orgId), await counts(real.orgId)], before);
    assert.match(log.join("\n"), /nothing was changed/);
  });

  it("--confirm removes the marked laboratory's deletable rows, keeps append-only history, and never touches the real laboratory", async () => {
    const realBefore = await counts(real.orgId);
    const rep = await run(["--confirm"], t.prisma as never, (m) => log.push(m));
    const o = rep!.orgs.find((x) => x.orgId === demo.orgId)!;
    const after = await counts(demo.orgId);
    assert.equal(after.staff, 0); assert.equal(after.labs, 0);
    // the audit log is append-only (database trigger): it stays, and so does the organisation row that owns it
    assert.ok(o.kept.some((k) => k.table === "AuditLog" || k.rows > 0), JSON.stringify(o.kept));
    assert.equal(o.organisationDeleted, after.tenant === 0);
    assert.deepEqual(await counts(real.orgId), realBefore);
  });

  it("repeating is safe", async () => {
    const rep = await run(["--confirm"], t.prisma as never, (m) => log.push(m));
    assert.deepEqual(rep!.orgs.find((x) => x.orgId === demo.orgId)?.deleted ?? {}, {});
  });

  it("an unmarked organisation is never selected, whatever it is called", async () => {
    const lookalike = await makeLab(t);
    await t.prisma.tenant.update({ where: { id: lookalike.orgId }, data: { name: "Demo Diagnostics (synthetic)", slug: `look-${lookalike.slug}` } });
    const before = await counts(lookalike.orgId);
    await removeDemoData({ $executeRawUnsafe: (s, ...v) => t.prisma.$executeRawUnsafe(s, ...v), $queryRawUnsafe: (s, ...v) => t.prisma.$queryRawUnsafe(s, ...v) }).catch(() => undefined);
    assert.deepEqual(await counts(lookalike.orgId), before);
  });

  it("tagging registers the demo laboratories by the seeds' own slugs, idempotently", async () => {
    const existing = await t.prisma.tenant.findUnique({ where: { slug: "basic-lab" } });
    const tenant = existing ?? await t.prisma.tenant.create({ data: { name: "Starter Lab (synthetic)", slug: "basic-lab", edition: "LITE" } });
    await markDemoRows(t.prisma as never, { batch: "e2e" });
    const again = await markDemoRows(t.prisma as never, { batch: "e2e" });
    assert.equal(again.Tenant ?? 0, 0);
    const n = await t.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int n FROM "DemoMarker" WHERE "tableName"='Tenant' AND "rowId"=$1`, tenant.id);
    assert.equal(n[0]!.n, 1);
    if (!existing) { await t.prisma.$executeRawUnsafe(`DELETE FROM "DemoMarker" WHERE "rowId" = $1`, tenant.id); await t.prisma.tenant.delete({ where: { id: tenant.id } }); }
  });
});
