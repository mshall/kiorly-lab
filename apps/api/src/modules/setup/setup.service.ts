import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { ROLE_PERMISSIONS } from "../../auth/rbac";
import { buildPlan, rolesWith, SETUP_DEFS, skipKey, type PlanDto, type SetupSnapshot } from "./setup-plan";

const ACTIONS = ["setup.step_skipped", "setup.dismissed", "setup.reopened"];

/** Skips and the dismissal are kept as append-only audit events (no schema change); the current state is the replay of those events. */
@Injectable()
export class SetupService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService) {}

  private async replay(orgId: string): Promise<{ skipped: Record<string, string>; dismissedAt: string | null; reopenNeeded: boolean }> {
    const rows = await this.prisma.auditLog.findMany({ where: { orgId, action: { in: ACTIONS } }, orderBy: { at: "asc" }, select: { action: true, meta: true, at: true } });
    const skipped: Record<string, string> = {};
    let dismissedAt: string | null = null;
    for (const r of rows) {
      if (r.action === "setup.step_skipped") { const m = (r.meta ?? {}) as { key?: string; entityId?: string | null }; if (m.key) skipped[skipKey(m.key, m.entityId)] = "skipped"; }
      else if (r.action === "setup.dismissed") dismissedAt = r.at.toISOString();
      else if (r.action === "setup.reopened") dismissedAt = null;
    }
    return { skipped, dismissedAt, reopenNeeded: dismissedAt !== null };
  }

  async snapshot(orgId: string): Promise<SetupSnapshot> {
    const [tenant, labs, tests, signatories, others, orders, released] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId }, select: { safetyContactPhone: true, safetyContactName: true, kiorexIntakeKeyEnc: true } }),
      this.prisma.lab.findMany({ where: { orgId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, code: true, licenceNo: true, address: true, coverageDistricts: true } }),
      this.prisma.testDefinition.count({ where: { orgId } }),
      this.prisma.staffUser.count({ where: { orgId, active: true, role: { in: ["AUTHORIZED_SIGNATORY", "LAB_DIRECTOR"] }, signatoryLicenceNo: { not: null } } }),
      this.prisma.staffUser.count({ where: { orgId, active: true, role: { not: "OWNER" } } }),
      this.prisma.labOrder.count({ where: { orgId } }),
      this.prisma.releaseRecord.count({ where: { orgId } }),
    ]);
    return {
      labs: labs.map((l) => ({ id: l.id, name: l.name, code: l.code, licenceNo: l.licenceNo, address: l.address, coverageDistricts: l.coverageDistricts.length })),
      testCount: tests, signatoryLicensed: signatories > 0, otherStaff: others, safetyContact: Boolean(tenant.safetyContactName && tenant.safetyContactPhone),
      orderCount: orders, releasedReports: released, connected: Boolean(tenant.kiorexIntakeKeyEnc),
    };
  }

  async get(u: AuthUser): Promise<PlanDto> {
    const [snap, st] = await Promise.all([this.snapshot(u.orgId), this.replay(u.orgId)]);
    const plan = buildPlan(snap, st.skipped, { role: u.role }, st.dismissedAt);
    // new pending work reopens a dismissed checklist (so finishing again shows the celebration again)
    if (st.reopenNeeded && !plan.allDone) await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "setup.reopened", entityType: "Tenant", entityId: u.orgId });
    return plan;
  }

  async skip(u: AuthUser, key: string, entityId?: string): Promise<PlanDto> {
    const def = SETUP_DEFS.find((d) => d.key === key);
    if (!def) throw new NotFoundException({ code: "SETUP_STEP_NOT_FOUND" });
    if (def.required) throw new BadRequestException({ code: "STEP_REQUIRED", message: "Required steps cannot be skipped" });
    if (!ROLE_PERMISSIONS[u.role].includes(def.perm)) throw new ForbiddenException({ code: "FORBIDDEN", message: `Your role cannot change this step; ask the owner (${rolesWith(def.perm).join(", ")})` });
    if (def.scope === "lab") {
      if (!entityId) throw new BadRequestException({ code: "ENTITY_REQUIRED", message: "entityId (lab) is required" });
      if (!(await this.prisma.lab.findFirst({ where: { id: entityId, orgId: u.orgId }, select: { id: true } }))) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    }
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "setup.step_skipped", entityType: "Tenant", entityId: u.orgId, meta: { key, entityId: def.scope === "lab" ? entityId : null } });
    return this.get(u);
  }

  async dismiss(u: AuthUser): Promise<PlanDto> {
    const cur = await this.get(u);
    if (!cur.allDone) throw new BadRequestException({ code: "NOT_DONE", message: "The checklist can be dismissed once every step is done or skipped" });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "setup.dismissed", entityType: "Tenant", entityId: u.orgId });
    return this.get(u);
  }
}
