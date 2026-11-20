import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, QueueStatus } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { nextSequence, pad } from "../../common/db";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { laneRank, ticketPrefix } from "./slots";

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/** M2: reception queue / token display (A = routine lane, S = STAT/urgent lane, called first). */
@Injectable()
export class QueueService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async issue(u: AuthUser, b: { labId?: string; priority?: "ROUTINE" | "URGENT" | "STAT"; patientName?: string; orderId?: string; appointmentId?: string }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    const priority = b.priority ?? "ROUTINE";
    const date = today();
    const prefix = ticketPrefix(priority);
    const seq = await nextSequence(this.prisma, u.orgId, `q:${labId}:${date.toISOString().slice(0, 10)}:${prefix}`);
    const t = await this.prisma.queueTicket.create({ data: { orgId: u.orgId, labId, businessDate: date, seq, code: `${prefix}${pad(seq, 3)}`, priority, patientName: b.patientName, orderId: b.orderId, appointmentId: b.appointmentId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "queue.issue", entityType: "QueueTicket", entityId: t.id, meta: { code: t.code } });
    return t;
  }

  private async mustGet(u: AuthUser, id: string) {
    const t = await this.prisma.queueTicket.findFirst({ where: { id, orgId: u.orgId } });
    if (!t) throw new NotFoundException({ code: "TICKET_NOT_FOUND" });
    return t;
  }

  /** Calls the next waiting ticket: STAT lane first, then urgent, then oldest. */
  async callNext(u: AuthUser, b: { labId?: string; counter: string }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lab" WHERE id = ${labId} FOR UPDATE`;
      const waiting = await tx.queueTicket.findMany({ where: { orgId: u.orgId, labId, businessDate: today(), status: "WAITING" }, orderBy: { createdAt: "asc" } });
      const next = [...waiting].sort((a, c) => laneRank(a.priority) - laneRank(c.priority) || a.createdAt.getTime() - c.createdAt.getTime())[0];
      if (!next) throw new NotFoundException({ code: "QUEUE_EMPTY" });
      const t = await tx.queueTicket.update({ where: { id: next.id }, data: { status: "CALLED", counter: b.counter, calledAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "queue.call", entityType: "QueueTicket", entityId: t.id, meta: { counter: b.counter } }, tx);
      return t;
    });
  }

  async setStatus(u: AuthUser, id: string, to: Extract<QueueStatus, "SERVING" | "DONE" | "SKIPPED" | "CANCELLED" | "WAITING">, orderId?: string) {
    const t = await this.mustGet(u, id);
    const ok: Record<string, QueueStatus[]> = { SERVING: ["CALLED"], DONE: ["CALLED", "SERVING"], SKIPPED: ["CALLED"], CANCELLED: ["WAITING", "CALLED"], WAITING: ["SKIPPED", "CALLED"] };
    if (!ok[to]!.includes(t.status)) throw new ConflictException({ code: "TICKET_ILLEGAL_TRANSITION", from: t.status, to });
    const data: Prisma.QueueTicketUpdateInput = { status: to };
    if (to === "SERVING") data.servedAt = new Date();
    if (to === "DONE") data.doneAt = new Date();
    if (to === "WAITING") { data.counter = null; data.calledAt = null; }
    if (orderId) data.orderId = orderId;
    const row = await this.prisma.queueTicket.update({ where: { id }, data });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `queue.${to.toLowerCase()}`, entityType: "QueueTicket", entityId: id });
    return row;
  }

  /** Waiting-room screen: tickets now being called/served, the waiting list (lane order), and wait statistics. */
  async board(u: AuthUser, labId?: string) {
    const id = await resolveLabId(this.prisma, u, labId);
    const rows = await this.prisma.queueTicket.findMany({ where: { orgId: u.orgId, labId: id, businessDate: today() }, orderBy: { createdAt: "asc" } });
    const waiting = rows.filter((r) => r.status === "WAITING").sort((a, c) => laneRank(a.priority) - laneRank(c.priority) || a.createdAt.getTime() - c.createdAt.getTime());
    const now = rows.filter((r) => r.status === "CALLED" || r.status === "SERVING").sort((a, c) => (c.calledAt?.getTime() ?? 0) - (a.calledAt?.getTime() ?? 0));
    const waits = rows.filter((r) => r.calledAt).map((r) => (r.calledAt!.getTime() - r.createdAt.getTime()) / 60_000);
    const mask = (t: (typeof rows)[number]) => ({ id: t.id, code: t.code, priority: t.priority, counter: t.counter, status: t.status, waitingMinutes: Math.round((Date.now() - t.createdAt.getTime()) / 60_000), patientName: undefined as string | undefined });
    return {
      now: now.map(mask), waiting: waiting.map(mask),
      stats: { waiting: waiting.length, served: rows.filter((r) => r.status === "DONE").length, avgWaitMinutes: waits.length ? Math.round((waits.reduce((a, b) => a + b, 0) / waits.length) * 10) / 10 : 0 },
    };
  }

  /** Staff view with patient names. */
  async list(u: AuthUser, labId?: string) {
    const id = await resolveLabId(this.prisma, u, labId);
    return this.prisma.queueTicket.findMany({ where: { orgId: u.orgId, labId: id, businessDate: today() }, orderBy: { createdAt: "asc" } });
  }
}
