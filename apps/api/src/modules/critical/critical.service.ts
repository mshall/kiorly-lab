import { ConflictException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { LabOrder, Result } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { appConfig } from "../../config/app-config";
import type { Db } from "../../common/db";
import { OutboxService } from "../../outbox/outbox.service";
import { PrismaService } from "../../prisma/prisma.service";

/** Escalation chain: clinician + lab director first, then lab director again as ESCALATED, then the owner. */
const MAX_LEVEL = 2;

/**
 * KLCRIT01 — SAFETY PATH, never a flag and no config switch: every critical result raises an alert; an alert that is not
 * acknowledged within the rule's window escalates (timer job + sweepable in tests). Notifications never carry raw values.
 */
@Injectable()
export class CriticalService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CriticalService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  onModuleInit() {
    if (appConfig.timersEnabled()) {
      this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(`critical sweep failed: ${(e as Error).message}`)), 30_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Called inside the result-entry transaction when a result is CRITICAL_LOW/HIGH. */
  async raise(db: Db, result: Pick<Result, "id" | "orgId" | "analyteId">, order: Pick<LabOrder, "id" | "orderNumber" | "referringDoctorPhone" | "referringDoctorRef">) {
    const rule = await db.criticalRule.findFirst({ where: { orgId: result.orgId, analyteId: result.analyteId, active: true } });
    const minutes = rule?.ackWithinMinutes ?? 30;
    const now = new Date();
    const alert = await db.criticalAlert.create({
      data: { orgId: result.orgId, resultId: result.id, orderId: order.id, notifiedUserRef: order.referringDoctorPhone ?? order.referringDoctorRef ?? "lab-director", notifiedAt: now, ackDeadlineAt: new Date(now.getTime() + minutes * 60_000) },
    });
    await this.notify(db, result.orgId, alert.id, order, "CRITICAL_ALERT", 0);
    await this.audit.record({ orgId: result.orgId, actorId: null, action: "critical.raised", entityType: "CriticalAlert", entityId: alert.id, meta: { resultId: result.id, ackWithinMinutes: minutes } }, db);
    return alert;
  }

  /** Alert the ordering clinician (when reachable) and the lab director(s). TODO_NEEDS_HUMAN templates (NH-LB-018); no values in params. */
  private async notify(db: Db, orgId: string, alertId: string, order: Pick<LabOrder, "id" | "orderNumber" | "referringDoctorPhone" | "referringDoctorRef">, purpose: "CRITICAL_ALERT" | "CRITICAL_ESCALATION", level: number) {
    const params = { orderNumber: order.orderNumber ?? order.id, alertId, level };
    const recipients: { ref: string; channel: "WHATSAPP" | "PUSH" | "VOICE" }[] = [];
    if (purpose === "CRITICAL_ALERT" && (order.referringDoctorPhone || order.referringDoctorRef)) recipients.push({ ref: (order.referringDoctorPhone ?? order.referringDoctorRef)!, channel: "WHATSAPP" });
    const roles = level >= 2 ? ["OWNER"] : ["LAB_DIRECTOR"];
    const staff = await db.staffUser.findMany({ where: { orgId, role: { in: roles as never }, active: true } });
    for (const s of staff) recipients.push({ ref: s.id, channel: "PUSH" });
    for (const r of recipients) {
      await this.messaging.send({ orgId, channel: r.channel, purpose, recipientRef: r.ref, templateId: purpose === "CRITICAL_ALERT" ? "TODO_NEEDS_HUMAN_CRITICAL_ALERT" : "TODO_NEEDS_HUMAN_CRITICAL_ESCALATION", params, relatedType: "CriticalAlert", relatedId: alertId }, db);
    }
  }

  list(orgId: string, status?: string) {
    return this.prisma.criticalAlert.findMany({
      where: { orgId, ...(status ? { status: status as never } : { status: { in: ["OPEN", "ESCALATED"] } }) },
      include: { result: { select: { id: true, flag: true, analyte: { select: { code: true, nameEn: true } } } } }, orderBy: { ackDeadlineAt: "asc" }, take: 200,
    });
  }

  async acknowledge(u: AuthUser, id: string, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.criticalAlert.findFirst({ where: { id, orgId: u.orgId } });
      if (!a) throw new NotFoundException({ code: "ALERT_NOT_FOUND" });
      if (a.status === "ACKNOWLEDGED" || a.status === "CLOSED") throw new ConflictException({ code: "ALERT_ALREADY_ACKNOWLEDGED" });
      const out = await tx.criticalAlert.update({ where: { id }, data: { status: "ACKNOWLEDGED", acknowledgedBy: u.staffId, acknowledgedAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "critical.acknowledged", entityType: "CriticalAlert", entityId: id, meta: { late: a.status === "ESCALATED", hasNote: Boolean(note) } }, tx);
      return out;
    });
  }

  /**
   * Timer job body (also invoked directly by the stop-ship timer test): every OPEN/ESCALATED alert past its deadline escalates one level
   * and gets a fresh acknowledgement window of the same length.
   */
  async sweep(now = new Date(), only: { orgId?: string } = {}): Promise<{ escalated: number }> {
    const due = await this.prisma.criticalAlert.findMany({ where: { ...(only.orgId ? { orgId: only.orgId } : {}), status: { in: ["OPEN", "ESCALATED"] }, ackDeadlineAt: { lte: now }, escalationLevel: { lt: MAX_LEVEL } }, include: { result: true } });
    let escalated = 0;
    for (const a of due) {
      await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.criticalAlert.findUnique({ where: { id: a.id } });
        if (!fresh || !["OPEN", "ESCALATED"].includes(fresh.status) || fresh.ackDeadlineAt > now) return;
        const rule = await tx.criticalRule.findFirst({ where: { orgId: a.orgId, analyteId: a.result.analyteId, active: true } });
        const minutes = rule?.ackWithinMinutes ?? 30;
        const level = fresh.escalationLevel + 1;
        const order = a.orderId ? await tx.labOrder.findUnique({ where: { id: a.orderId } }) : null;
        const target = await tx.staffUser.findFirst({ where: { orgId: a.orgId, role: level >= 2 ? "OWNER" : "LAB_DIRECTOR", active: true } });
        await tx.criticalAlert.update({ where: { id: a.id }, data: { status: "ESCALATED", escalatedAt: now, escalationLevel: level, escalatedToUserId: target?.id ?? null, ackDeadlineAt: new Date(now.getTime() + minutes * 60_000) } });
        if (order) await this.notify(tx, a.orgId, a.id, order, "CRITICAL_ESCALATION", level);
        await this.audit.record({ orgId: a.orgId, actorId: null, action: "critical.escalated", entityType: "CriticalAlert", entityId: a.id, meta: { level } }, tx);
        await this.outbox.enqueue({ orgId: a.orgId, type: "LabCriticalEscalated", aggregateType: "CriticalAlert", aggregateId: a.id, data: { alertId: a.id, orderId: a.orderId, level }, eventId: `evt_crit_${a.id}_${level}` }, tx);
        escalated++;
      });
    }
    return { escalated };
  }
}
