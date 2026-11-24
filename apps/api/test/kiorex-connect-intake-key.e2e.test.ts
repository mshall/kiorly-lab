import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Lab, type TestApp, bootApp, makeLab } from "./helpers/app";
import { KiorexConnectService } from "../src/integration/kiorex-connect.service";
import { open as unseal, seal } from "../src/common/secret-box";

/** The Kiorex intake key has its own Tenant column (sealed); it never rides in the append-only connect snapshot, and the migration backfills it from old snapshots. */
describe("Kiorex Connect intake key: settings column, not the audit snapshot", () => {
  let t: TestApp, lab: Lab, svc: KiorexConnectService, orgId: string;
  before(async () => {
    t = await bootApp(); lab = await makeLab(t); svc = t.app.get(KiorexConnectService);
    orgId = (await t.prisma.tenant.findFirstOrThrow({ where: { staff: { some: { id: lab.staff.OWNER.id } } } })).id;
  });
  after(async () => { await t.close(); });

  it("storing the key sets the column (sealed), the status stops asking for an enrolment code, and no later snapshot carries the key", async () => {
    assert.equal((await svc.get(orgId, { pull: false })).enrolmentCodeRequired, true);
    await (svc as unknown as { storeIntakeKey(o: string, k: string): Promise<unknown> }).storeIntakeKey(orgId, "kxi_test_key_value");
    const col = (await t.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } })).kiorexIntakeKeyEnc!;
    assert.notEqual(col, "kxi_test_key_value"); assert.equal(unseal(col), "kxi_test_key_value");
    assert.equal(await svc.intakeKey(orgId), "kxi_test_key_value");
    assert.equal((await svc.get(orgId, { pull: false })).enrolmentCodeRequired, false);
    const u = { orgId, staffId: lab.staff.OWNER.id } as never;
    await svc.acceptTerms(u, "2026-11"); // writes a new snapshot
    const snaps = await t.prisma.auditLog.findMany({ where: { orgId, entityType: "KiorexConnect" }, orderBy: { at: "desc" }, take: 3 });
    assert.ok(snaps.length > 0);
    for (const s of snaps) assert.equal(JSON.stringify(s.meta).includes("intakeKeyEnc"), false);
  });

  it("migration backfill: the latest snapshot that carried a sealed key fills the column; a snapshot without one does not", async () => {
    const sealed = seal("kxi_from_snapshot");
    await t.prisma.tenant.update({ where: { id: orgId }, data: { kiorexIntakeKeyEnc: null } });
    await t.prisma.auditLog.create({ data: { orgId, action: "kiorex_connect.state", entityType: "KiorexConnect", entityId: orgId, meta: { status: "REQUESTED", intakeKeyEnc: sealed } } });
    await t.prisma.auditLog.create({ data: { orgId, action: "kiorex_connect.state", entityType: "KiorexConnect", entityId: orgId, meta: { status: "APPROVED" } } }); // later snapshot, no key
    const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20261126100000_kiorex_intake_key", "migration.sql"), "utf8").split("\n").filter((l) => !l.startsWith("--")).join("\n");
    await t.prisma.$executeRawUnsafe(sql.slice(sql.indexOf("UPDATE")));
    assert.equal(unseal((await t.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } })).kiorexIntakeKeyEnc!), "kxi_from_snapshot");
    assert.equal(await svc.intakeKey(orgId), "kxi_from_snapshot");
  });
});
