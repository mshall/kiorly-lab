import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { StorageAdapter } from "../../adapters/storage.adapter";
import { IdempotencyService } from "../../common/idempotency";
import { IDENTIFIER_KINDS, presentIdentifiers, twoIdentifiersOk } from "../../common/identity";
import { OrderStatusService } from "../../common/order-status.service";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { SpecimensService } from "../specimens/specimens.service";
import { type GeoPoint, defaultSlotsFor, nearestNeighbourRoute } from "./home-routing";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

@Injectable()
export class HomeCollectionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SpecimensService) private readonly specimens: SpecimensService,
    @Inject(OrderStatusService) private readonly orderStatus: OrderStatusService,
    @Inject(StorageAdapter) private readonly storage: StorageAdapter,
    @Inject(IdempotencyService) private readonly idem: IdempotencyService,
  ) {}

  /** Slots for a day; the default grid is generated on first read (NH-LB-011: operating hours/capacity policy). */
  async slots(u: AuthUser, date: string, labId?: string) {
    const lid = await resolveLabId(this.prisma, u, labId);
    if (Number.isNaN(Date.parse(date))) throw new BadRequestException({ code: "DATE_INVALID" });
    const d = day(date);
    const existing = await this.prisma.collectionSlot.count({ where: { labId: lid, startsAt: { gte: d, lt: new Date(d.getTime() + 86_400_000) } } });
    if (!existing) {
      await this.prisma.collectionSlot.createMany({ data: defaultSlotsFor(d).map((s) => ({ orgId: u.orgId, labId: lid, ...s })), skipDuplicates: true });
    }
    const rows = await this.prisma.collectionSlot.findMany({ where: { labId: lid, orgId: u.orgId, startsAt: { gte: d, lt: new Date(d.getTime() + 86_400_000) } }, orderBy: { startsAt: "asc" } });
    return rows.map((r) => ({ ...r, available: Math.max(r.capacity - r.booked, 0) }));
  }

  list(u: AuthUser, q: { date?: string; status?: string; phlebotomistId?: string }) {
    return this.prisma.homeCollection.findMany({
      where: { orgId: u.orgId, ...(q.status ? { status: q.status as never } : {}), ...(q.phlebotomistId ? { phlebotomistId: q.phlebotomistId } : {}), ...(q.date ? { routeDate: day(q.date) } : {}) },
      include: { order: { include: { patient: { select: { fullName: true, phone: true } }, specimens: { select: { id: true, accessionNumber: true, barcode: true, status: true } }, items: { include: { test: { select: { code: true, fastingRequired: true } } } } } } },
      orderBy: [{ routeSequence: "asc" }, { slotStart: "asc" }],
    });
  }

  /** The phlebotomist's own route for a day, in visiting order (mobile PWA). */
  myRoute(u: AuthUser, date: string) {
    return this.list(u, { date, phlebotomistId: u.staffId });
  }

  async assign(u: AuthUser, id: string, phlebotomistId: string, routeSequence?: number) {
    const hc = await this.prisma.homeCollection.findFirst({ where: { id, orgId: u.orgId } });
    if (!hc) throw new NotFoundException({ code: "HOME_COLLECTION_NOT_FOUND" });
    const ph = await this.prisma.staffUser.findFirst({ where: { id: phlebotomistId, orgId: u.orgId, role: "PHLEBOTOMIST", active: true } });
    if (!ph) throw new BadRequestException({ code: "PHLEBOTOMIST_NOT_FOUND" });
    if (["COLLECTED", "CANCELLED"].includes(hc.status)) throw new ConflictException({ code: "HOME_COLLECTION_CLOSED" });
    await this.prisma.$transaction(async (tx) => {
      await tx.homeCollection.update({ where: { id }, data: { phlebotomistId, routeSequence: routeSequence ?? null, status: hc.status === "REQUESTED" ? "SCHEDULED" : hc.status } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.assign", entityType: "HomeCollection", entityId: id, meta: { phlebotomistId } }, tx);
    });
    return this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
  }

  /** Orders a phlebotomist's stops for a day by nearest neighbour from the lab (stored as routeSequence). */
  async optimiseRoute(u: AuthUser, date: string, phlebotomistId: string, start?: GeoPoint) {
    const stops = await this.prisma.homeCollection.findMany({ where: { orgId: u.orgId, phlebotomistId, routeDate: day(date), status: { in: ["SCHEDULED", "EN_ROUTE"] } } });
    const origin = start ?? (stops.map((s) => s.geo as GeoPoint | null).find(Boolean) ?? { lat: 30.0444, lng: 31.2357 });
    const ordered = nearestNeighbourRoute(origin, stops.map((s) => ({ id: s.id, geo: s.geo as GeoPoint | null })));
    await this.prisma.$transaction(async (tx) => {
      let i = 1;
      for (const s of ordered) await tx.homeCollection.update({ where: { id: s.id }, data: { routeSequence: i++ } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.route", entityType: "HomeCollection", entityId: phlebotomistId, meta: { stops: ordered.length, date } }, tx);
    });
    return ordered.map((s, idx) => ({ id: s.id, routeSequence: idx + 1 }));
  }

  private async owned(u: AuthUser, id: string) {
    const hc = await this.prisma.homeCollection.findFirst({ where: { id, orgId: u.orgId }, include: { order: { include: { patient: true, specimens: true } } } });
    if (!hc) throw new NotFoundException({ code: "HOME_COLLECTION_NOT_FOUND" });
    if (u.role === "PHLEBOTOMIST" && hc.phlebotomistId !== u.staffId) throw new ConflictException({ code: "NOT_YOUR_COLLECTION" });
    return hc;
  }

  async start(u: AuthUser, id: string) {
    const hc = await this.owned(u, id);
    if (hc.status !== "SCHEDULED") throw new ConflictException({ code: "ILLEGAL_HOME_COLLECTION_TRANSITION", from: hc.status });
    await this.prisma.homeCollection.update({ where: { id }, data: { status: "EN_ROUTE" } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.en_route", entityType: "HomeCollection", entityId: id });
    return this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
  }

  async fail(u: AuthUser, id: string, reason: string) {
    const hc = await this.owned(u, id);
    if (!["SCHEDULED", "EN_ROUTE"].includes(hc.status)) throw new ConflictException({ code: "ILLEGAL_HOME_COLLECTION_TRANSITION", from: hc.status });
    await this.prisma.homeCollection.update({ where: { id }, data: { status: "FAILED", failureReason: reason } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.failed", entityType: "HomeCollection", entityId: id });
    return this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
  }

  /** Label photo of the filled tubes (NH-LB-011: privacy handling pending — stored privately, referenced by key only). */
  async uploadLabelPhoto(u: AuthUser, id: string, imageBase64: string, contentType: string) {
    const hc = await this.owned(u, id);
    const buf = Buffer.from(imageBase64, "base64");
    if (buf.length === 0 || buf.length > 3_000_000) throw new BadRequestException({ code: "PHOTO_SIZE" });
    if (!["image/jpeg", "image/png"].includes(contentType)) throw new BadRequestException({ code: "PHOTO_TYPE" });
    const key = `label-photos/${u.orgId}/${id}.${contentType === "image/png" ? "png" : "jpg"}`;
    await this.storage.put(key, buf);
    await this.prisma.homeCollection.update({ where: { id: hc.id }, data: { labelPhotoKey: key } });
    return { labelPhotoKey: key };
  }

  /**
   * Collection confirmation: every pending specimen must be scanned (label match), two identifiers verified, label photo recorded.
   * Idempotent on the Idempotency-Key header so an offline queue can safely replay it.
   */
  async confirm(u: AuthUser, id: string, b: { scannedBarcodes: string[]; identifiersChecked?: string[]; labelPhotoKey?: string; temperatureC?: number }, idemKey: string | undefined) {
    return this.idem.run(u.orgId, "home.confirm", idemKey, async () => {
      const hc = await this.owned(u, id);
      if (hc.status === "COLLECTED") return { id, status: "COLLECTED" };
      if (!["SCHEDULED", "EN_ROUTE"].includes(hc.status)) throw new ConflictException({ code: "ILLEGAL_HOME_COLLECTION_TRANSITION", from: hc.status });
      if (!hc.order.identityVerified) {
        const checked = b.identifiersChecked ?? [];
        if (!twoIdentifiersOk(checked, presentIdentifiers(hc.order.patient))) throw new ConflictException({ code: "TWO_IDENTIFIERS_REQUIRED", allowed: IDENTIFIER_KINDS });
        await this.prisma.labOrder.update({ where: { id: hc.orderId }, data: { identityVerified: true, identifiersChecked: [...new Set(checked)] } });
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "order.identity_verified", entityType: "LabOrder", entityId: hc.orderId, meta: { kinds: [...new Set(checked)] } });
      }
      const pending = hc.order.specimens.filter((s) => s.status === "PENDING_COLLECTION");
      for (const sp of pending) {
        const scanned = b.scannedBarcodes.find((x) => x === sp.barcode) ?? b.scannedBarcodes[0];
        await this.specimens.transition(u, sp.id, "collect", { scannedBarcode: b.scannedBarcodes.includes(sp.barcode) ? sp.barcode : scanned, temperatureC: b.temperatureC, location: "home collection" });
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.homeCollection.update({ where: { id }, data: { status: "COLLECTED", confirmedAt: new Date(), labelPhotoKey: b.labelPhotoKey ?? hc.labelPhotoKey } as Prisma.HomeCollectionUncheckedUpdateInput });
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.collected", entityType: "HomeCollection", entityId: id, meta: { photo: Boolean(b.labelPhotoKey ?? hc.labelPhotoKey) } }, tx);
        await this.orderStatus.refreshOrder(tx, hc.orderId);
      });
      return { id, status: "COLLECTED" };
    });
  }
}
