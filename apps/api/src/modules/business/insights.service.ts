import { ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { appConfig } from "../../config/app-config";
import { D, round2 } from "../../common/db";
import { KERNEL_ENTITLEMENTS, type EntitlementsPort } from "../../kernel-adapter/ports";
import { PrismaService } from "../../prisma/prisma.service";
import { classifyTat } from "./tat";

const range = (from?: string, to?: string) => ({ gte: from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000), lte: to ? new Date(to) : new Date() });

@Injectable()
export class InsightsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(InsightsService.name);
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
    @Inject(KERNEL_ENTITLEMENTS) private readonly ent: EntitlementsPort,
  ) {}
  onModuleInit() {
    if (appConfig.timersEnabled()) {
      this.timer = setInterval(() => void this.slaSweep().catch((e) => this.log.warn(`sla sweep failed: ${(e as Error).message}`)), 60_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ----------------------------------------------------------------- TAT
  /** KLBIZ02 dashboard rows for items not yet released plus recently released ones. */
  async tat(orgId: string, q: { from?: string; to?: string } = {}, now = new Date()) {
    const items = await this.prisma.orderItem.findMany({
      where: { order: { orgId, createdAt: range(q.from, q.to) }, status: { not: "CANCELLED" } },
      include: { test: { select: { code: true, nameEn: true, tatMinutes: true } }, order: { select: { id: true, orderNumber: true, createdAt: true, priority: true } }, results: { select: { releasedAt: true, status: true } }, slaAlert: true },
      take: 1000, orderBy: { createdAt: "desc" },
    });
    const sp = await this.prisma.specimen.findMany({ where: { id: { in: items.map((i) => i.specimenId).filter(Boolean) as string[] } }, select: { id: true, collectedAt: true } });
    const rows = items.map((i) => {
      const released = i.results.filter((r) => r.releasedAt).map((r) => r.releasedAt!.getTime());
      const releasedAt = i.status === "RELEASED" && released.length ? new Date(Math.max(...released)) : null;
      const started = sp.find((s) => s.id === i.specimenId)?.collectedAt ?? i.order.createdAt;
      return { orderItemId: i.id, orderId: i.order.id, orderNumber: i.order.orderNumber, priority: i.order.priority, test: i.test.code, targetMinutes: i.test.tatMinutes, startedAt: started, releasedAt, alerted: Boolean(i.slaAlert), ...classifyTat({ startedAt: started, targetMinutes: i.test.tatMinutes, releasedAt, now }) };
    });
    const count = (s: string) => rows.filter((r) => r.status === s).length;
    return { summary: { total: rows.length, ok: count("OK"), atRisk: count("AT_RISK"), breached: count("BREACHED"), doneOnTime: count("DONE_ON_TIME"), doneLate: count("DONE_LATE") }, rows };
  }

  /** Raises one deduplicated SLA alert per breached open item and notifies branch managers (mock push). */
  async slaSweep(now = new Date()): Promise<{ raised: number }> {
    const items = await this.prisma.orderItem.findMany({ where: { status: { in: ["PENDING", "IN_PROGRESS", "RESULTED", "VALIDATED"] }, slaAlert: null, test: { tatMinutes: { not: null } } }, include: { test: true, order: true }, take: 500 });
    let raised = 0;
    for (const i of items) {
      const sp = i.specimenId ? await this.prisma.specimen.findUnique({ where: { id: i.specimenId } }) : null;
      const t = classifyTat({ startedAt: sp?.collectedAt ?? i.order.createdAt, targetMinutes: i.test.tatMinutes, releasedAt: null, now });
      if (t.status !== "BREACHED") continue;
      try {
        await this.prisma.slaAlert.create({ data: { orgId: i.order.orgId, orderItemId: i.id, level: "BREACHED" } });
      } catch {
        continue; // already alerted (unique)
      }
      const mgrs = await this.prisma.staffUser.findMany({ where: { orgId: i.order.orgId, role: "BRANCH_MANAGER", active: true } });
      for (const m of mgrs) await this.messaging.send({ orgId: i.order.orgId, channel: "PUSH", purpose: "SLA_ALERT", recipientRef: m.id, templateId: "TODO_NEEDS_HUMAN_SLA_ALERT", params: { orderNumber: i.order.orderNumber ?? i.order.id, test: i.test.code }, relatedType: "OrderItem", relatedId: i.id });
      raised++;
    }
    return { raised };
  }

  // ----------------------------------------------------------- dashboard
  async dashboard(u: AuthUser) {
    const orgId = u.orgId;
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
    const [byStatus, openBlocks, critical, pendingTech, pendingMed, unreleased, todayRevenue, rejects, tat] = await Promise.all([
      this.prisma.labOrder.groupBy({ by: ["status"], where: { orgId }, _count: true }),
      this.prisma.qcBlock.count({ where: { orgId, status: "OPEN" } }),
      this.prisma.criticalAlert.count({ where: { orgId, status: { in: ["OPEN", "ESCALATED"] } } }),
      this.prisma.result.count({ where: { orgId, status: "ENTERED" } }),
      this.prisma.result.count({ where: { orgId, status: "TECH_VALIDATED" } }),
      this.prisma.reportVersion.count({ where: { orgId, releases: { none: {} } } }),
      this.prisma.payment.aggregate({ where: { orgId, status: "SUCCEEDED", createdAt: { gte: today } }, _sum: { amount: true } }),
      this.prisma.specimen.count({ where: { orgId, status: "REJECTED", createdAt: { gte: today } } }),
      this.tat(orgId),
    ]);
    return {
      ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])), openQcBlocks: openBlocks, openCriticalAlerts: critical,
      resultsAwaitingTechValidation: pendingTech, resultsAwaitingMedicalValidation: pendingMed, signedNotReleased: unreleased,
      paymentsToday: D(todayRevenue._sum.amount ?? 0), rejectedToday: rejects, tat: tat.summary,
    };
  }

  // ----------------------------------- referring-doctor statements (gated)
  /**
   * KLBIZ03. Only where lawful (NH-LB-003): disabled until the tenant setting is turned on by a human. Plain aggregates; no commission or
   * fee-splitting logic is implemented (that would be a legal question).
   */
  async referringDoctorStatements(u: AuthUser, q: { from?: string; to?: string }) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
    if (!t.referringDoctorStatements) throw new ForbiddenException({ code: "STATEMENTS_NOT_ENABLED", message: "enable only after counsel confirms lawfulness (NH-LB-003)" });
    const orders = await this.prisma.labOrder.findMany({ where: { orgId: u.orgId, createdAt: range(q.from, q.to), OR: [{ referringDoctorRef: { not: null } }, { referringDoctorName: { not: null } }], status: { not: "CANCELLED" } }, include: { items: { where: { status: { not: "CANCELLED" } } } } });
    const by = new Map<string, { doctor: string; ref: string | null; orders: number; tests: number; gross: number }>();
    for (const o of orders) {
      const k = o.referringDoctorRef ?? o.referringDoctorName ?? "?";
      const e = by.get(k) ?? { doctor: o.referringDoctorName ?? k, ref: o.referringDoctorRef, orders: 0, tests: 0, gross: 0 };
      e.orders++;
      e.tests += o.items.length;
      e.gross = round2(e.gross + o.items.reduce((a, i) => a + D(i.price), 0));
      by.set(k, e);
    }
    return [...by.values()].sort((a, b) => b.gross - a.gross);
  }

  // ------------------------------------------------------------- send-out
  async recordSendOutCost(u: AuthUser, orderItemId: string, b: { referralLabName: string; cost: number }) {
    if (!(await this.ent.has(u.orgId, "referral_labs"))) throw new ConflictException({ code: "PLAN_REQUIRED", capability: "referral_labs" });
    const item = await this.prisma.orderItem.findFirst({ where: { id: orderItemId, order: { orgId: u.orgId } }, include: { test: true } });
    if (!item) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
    if (!item.test.sendOut) throw new ConflictException({ code: "NOT_A_SEND_OUT_TEST" });
    const row = await this.prisma.sendOutCost.upsert({
      where: { orderItemId }, create: { orgId: u.orgId, orderItemId, referralLabName: b.referralLabName, cost: b.cost, recordedBy: u.staffId }, update: { referralLabName: b.referralLabName, cost: b.cost, recordedBy: u.staffId },
    });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "send_out.cost", entityType: "SendOutCost", entityId: row.id });
    return { ...row, cost: D(row.cost) };
  }

  async sendOutSummary(orgId: string, q: { from?: string; to?: string }) {
    const rows = await this.prisma.sendOutCost.findMany({ where: { orgId, recordedAt: range(q.from, q.to) }, include: { orderItem: { include: { test: { select: { code: true } }, order: { select: { orderNumber: true } } } } } });
    const lines = rows.map((r) => ({ orderNumber: r.orderItem.order.orderNumber, test: r.orderItem.test.code, referralLab: r.referralLabName, cost: D(r.cost), price: D(r.orderItem.price), margin: round2(D(r.orderItem.price) - D(r.cost)) }));
    return { totals: { cost: round2(lines.reduce((a, l) => a + l.cost, 0)), revenue: round2(lines.reduce((a, l) => a + l.price, 0)) }, lines };
  }
}
