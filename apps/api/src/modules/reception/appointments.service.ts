import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AppointmentStatus, Prisma } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { OrdersService } from "../orders/orders.service";
import { QueueService } from "./queue.service";
import { dayStartUtc, slotFor, slotGrid, type SlotConfig } from "./slots";

export interface AppointmentInput {
  labId?: string; patientId?: string; patientName: string; phone?: string; startsAt: string; kind?: string; testCodes?: string[]; packageCode?: string; fasting?: boolean; note?: string;
}

/** M2: reception appointments with per-slot capacity (walk-in booking, packages, follow-ups). Home-collection slots stay in the home-collection module. */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}

  private cfg(lab: { appointmentCapacity: number; appointmentSlotMinutes: number; openingHour: number; closingHour: number }): SlotConfig {
    return { capacity: lab.appointmentCapacity, slotMinutes: lab.appointmentSlotMinutes, openingHour: lab.openingHour, closingHour: lab.closingHour };
  }

  /** Free capacity per slot for a day. */
  async availability(u: AuthUser, date: string, labId?: string) {
    const id = await resolveLabId(this.prisma, u, labId);
    const lab = await this.prisma.lab.findUniqueOrThrow({ where: { id } });
    let day: Date;
    try { day = dayStartUtc(date); } catch { throw new BadRequestException({ code: "DATE_INVALID" }); }
    const booked = await this.prisma.appointment.findMany({ where: { orgId: u.orgId, labId: id, status: { in: ["BOOKED", "CHECKED_IN"] }, startsAt: { gte: day, lt: new Date(day.getTime() + 86_400_000) } }, select: { startsAt: true } });
    const cfg = this.cfg(lab);
    return slotGrid(date, cfg).map((s) => { const n = booked.filter((b) => b.startsAt >= s.startsAt && b.startsAt < s.endsAt).length; return { startsAt: s.startsAt, endsAt: s.endsAt, capacity: cfg.capacity, booked: n, free: Math.max(cfg.capacity - n, 0) }; });
  }

  async book(u: AuthUser, b: AppointmentInput) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    const at = new Date(b.startsAt);
    if (Number.isNaN(at.getTime())) throw new BadRequestException({ code: "DATE_INVALID" });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Lab" WHERE id = ${labId} FOR UPDATE`;
      const lab = await tx.lab.findUniqueOrThrow({ where: { id: labId } });
      const slot = slotFor(at, this.cfg(lab));
      if (!slot) throw new ConflictException({ code: "OUTSIDE_OPENING_HOURS", openingHour: lab.openingHour, closingHour: lab.closingHour });
      const n = await tx.appointment.count({ where: { orgId: u.orgId, labId, status: { in: ["BOOKED", "CHECKED_IN"] }, startsAt: { gte: slot.startsAt, lt: slot.endsAt } } });
      if (n >= lab.appointmentCapacity) throw new ConflictException({ code: "SLOT_FULL", startsAt: slot.startsAt });
      if (b.patientId && !(await tx.patientRef.findFirst({ where: { id: b.patientId, orgId: u.orgId } }))) throw new NotFoundException({ code: "PATIENT_NOT_FOUND" });
      const row = await tx.appointment.create({ data: { orgId: u.orgId, labId, patientId: b.patientId, patientName: b.patientName, phone: b.phone, startsAt: at, endsAt: slot.endsAt, kind: b.kind ?? "WALK_IN", testCodes: b.testCodes ?? [], packageCode: b.packageCode, fasting: b.fasting ?? false, note: b.note, createdBy: u.staffId } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "appointment.book", entityType: "Appointment", entityId: row.id }, tx);
      return row;
    });
  }

  async list(u: AuthUser, q: { date?: string; status?: string; labId?: string; search?: string }) {
    const where: Prisma.AppointmentWhereInput = { orgId: u.orgId, ...(u.labIds.length ? { labId: { in: u.labIds } } : {}), ...(q.labId ? { labId: q.labId } : {}), ...(q.status ? { status: q.status as AppointmentStatus } : {}), ...(q.search ? { OR: [{ patientName: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }] } : {}) };
    if (q.date) { const d = dayStartUtc(q.date); where.startsAt = { gte: d, lt: new Date(d.getTime() + 86_400_000) }; }
    return this.prisma.appointment.findMany({ where, orderBy: { startsAt: "asc" }, take: 300 });
  }

  private async mustGet(u: AuthUser, id: string) {
    const a = await this.prisma.appointment.findFirst({ where: { id, orgId: u.orgId } });
    if (!a) throw new NotFoundException({ code: "APPOINTMENT_NOT_FOUND" });
    return a;
  }

  async setStatus(u: AuthUser, id: string, status: "CANCELLED" | "NO_SHOW") {
    const a = await this.mustGet(u, id);
    if (a.status !== "BOOKED") throw new ConflictException({ code: "APPOINTMENT_NOT_OPEN", status: a.status });
    const row = await this.prisma.appointment.update({ where: { id }, data: { status } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `appointment.${status.toLowerCase()}`, entityType: "Appointment", entityId: id });
    return row;
  }

  /** Patient arrives: marks CHECKED_IN and issues a queue ticket (lane from `priority`). */
  async checkIn(u: AuthUser, id: string, priority: "ROUTINE" | "URGENT" | "STAT" = "ROUTINE") {
    const a = await this.mustGet(u, id);
    if (a.status !== "BOOKED") throw new ConflictException({ code: "APPOINTMENT_NOT_OPEN", status: a.status });
    await this.prisma.appointment.update({ where: { id }, data: { status: "CHECKED_IN", checkedInAt: new Date() } });
    const ticket = await this.queue.issue(u, { labId: a.labId, priority, patientName: a.patientName, appointmentId: id });
    return { appointmentId: id, ticket };
  }

  /** Creates the lab order from the appointment (patient must be registered); completes the appointment. */
  async toOrder(u: AuthUser, id: string, extra: { testCodes?: string[]; packageCodes?: string[]; identifiersChecked?: string[]; priority?: "ROUTINE" | "URGENT" | "STAT" }) {
    const a = await this.mustGet(u, id);
    if (!a.patientId) throw new ConflictException({ code: "PATIENT_REQUIRED", message: "register the patient first" });
    if (a.orderId) throw new ConflictException({ code: "APPOINTMENT_HAS_ORDER", orderId: a.orderId });
    if (["CANCELLED", "NO_SHOW", "COMPLETED"].includes(a.status)) throw new ConflictException({ code: "APPOINTMENT_NOT_OPEN", status: a.status });
    const testCodes = extra.testCodes ?? a.testCodes;
    const packageCodes = extra.packageCodes ?? (a.packageCode ? [a.packageCode] : []);
    const { order } = await this.orders.create(u, { labId: a.labId, patientId: a.patientId, testCodes, packageCodes, identifiersChecked: extra.identifiersChecked, priority: extra.priority, source: "WALK_IN", fastingConfirmed: a.fasting ? true : undefined });
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.update({ where: { id }, data: { orderId: order.id, status: "COMPLETED" } });
      await tx.labOrder.update({ where: { id: order.id }, data: { appointmentId: id } });
      await tx.queueTicket.updateMany({ where: { appointmentId: id, orderId: null }, data: { orderId: order.id } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "appointment.to_order", entityType: "Appointment", entityId: id, meta: { orderId: order.id } }, tx);
    });
    return order;
  }
}
