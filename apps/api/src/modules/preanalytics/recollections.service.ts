import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { RecollectionStatus } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { PrismaService } from "../../prisma/prisma.service";

/** M3: recollection requests raised by sample rejection (the replacement specimen is created by SpecimensService.reject). */
@Injectable()
export class RecollectionsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
  ) {}

  async list(u: AuthUser, q: { status?: string }) {
    const rows = await this.prisma.recollectionRequest.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as RecollectionStatus } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    const orders = await this.prisma.labOrder.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, orderNumber: true, patient: { select: { fullName: true, phone: true } } } });
    const sp = await this.prisma.specimen.findMany({ where: { id: { in: rows.flatMap((r) => [r.rejectedSpecimenId, r.newSpecimenId ?? ""]) } }, select: { id: true, accessionNumber: true, specimenType: true } });
    return rows.map((r) => ({ ...r, order: orders.find((o) => o.id === r.orderId) ?? null, rejected: sp.find((s) => s.id === r.rejectedSpecimenId) ?? null, replacement: sp.find((s) => s.id === r.newSpecimenId) ?? null }));
  }

  /** Re-sends the patient notice (e.g. no answer the first time). */
  async notify(u: AuthUser, id: string) {
    const r = await this.prisma.recollectionRequest.findFirst({ where: { id, orgId: u.orgId } });
    if (!r) throw new NotFoundException({ code: "RECOLLECTION_NOT_FOUND" });
    if (["COLLECTED", "CANCELLED"].includes(r.status)) throw new ConflictException({ code: "RECOLLECTION_CLOSED", status: r.status });
    const order = await this.prisma.labOrder.findUniqueOrThrow({ where: { id: r.orderId }, include: { patient: true } });
    const contact = order.patient.phone ?? order.patient.externalId;
    if (!contact) throw new ConflictException({ code: "NO_PATIENT_CONTACT" });
    // TODO_NEEDS_HUMAN (NH-LB-008): approved recollection wording. Params carry no clinical data.
    await this.messaging.send({ orgId: u.orgId, channel: "WHATSAPP", purpose: "RECOLLECTION", recipientRef: contact, templateId: "TODO_NEEDS_HUMAN_RECOLLECTION_NOTICE", params: { orderNumber: order.orderNumber ?? order.id, locale: order.patient.preferredLocale }, relatedType: "RecollectionRequest", relatedId: id });
    const row = await this.prisma.recollectionRequest.update({ where: { id }, data: { status: "NOTIFIED", notifiedAt: new Date() } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "recollection.notify", entityType: "RecollectionRequest", entityId: id });
    return row;
  }

  async cancel(u: AuthUser, id: string) {
    const r = await this.prisma.recollectionRequest.findFirst({ where: { id, orgId: u.orgId } });
    if (!r) throw new NotFoundException({ code: "RECOLLECTION_NOT_FOUND" });
    if (["COLLECTED", "CANCELLED"].includes(r.status)) throw new ConflictException({ code: "RECOLLECTION_CLOSED", status: r.status });
    const row = await this.prisma.recollectionRequest.update({ where: { id }, data: { status: "CANCELLED", resolvedAt: new Date() } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "recollection.cancel", entityType: "RecollectionRequest", entityId: id });
    return row;
  }
}
