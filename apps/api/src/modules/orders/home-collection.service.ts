import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { StorageAdapter } from "../../adapters/storage.adapter";
import { IdempotencyService } from "../../common/idempotency";
import { IDENTIFIER_KINDS, presentIdentifiers, twoIdentifiersOk } from "../../common/identity";
import { OrderStatusService } from "../../common/order-status.service";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { SpecimensService } from "../specimens/specimens.service";
import { type PlannedVisit, DEFAULT_TRAVEL_BUFFERS, buildTravelMatrix, canBook } from "@kiorly/field-visit";
import { type Geo, FieldLifecycleService } from "../field-safety/field-lifecycle.service";
import { FieldSafetyService } from "../field-safety/field-safety.service";
import { presentHomeCollection } from "../field-safety/field-visit-map";
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
    @Inject(FieldLifecycleService) private readonly lifecycle: FieldLifecycleService,
    @Inject(FieldSafetyService) private readonly safety: FieldSafetyService,
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

  /** HVPRV01/BR52: address, phone and coordinates only for the assigned phlebotomist and admins, after confirmation, never 24 h after the visit. */
  private present<T extends Parameters<typeof presentHomeCollection>[1]>(u: AuthUser, rows: T[]) {
    const now = Date.now();
    return rows.map((r) => presentHomeCollection(u, r, now));
  }

  async list(u: AuthUser, q: { date?: string; status?: string; phlebotomistId?: string }) {
    return this.present(u, await this.rawList(u, q));
  }

  private rawList(u: AuthUser, q: { date?: string; status?: string; phlebotomistId?: string }) {
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
    const hc = await this.prisma.homeCollection.findFirst({ where: { id, orgId: u.orgId }, include: { order: { select: { labId: true } } } });
    if (!hc) throw new NotFoundException({ code: "HOME_COLLECTION_NOT_FOUND" });
    const ph = await this.prisma.staffUser.findFirst({ where: { id: phlebotomistId, orgId: u.orgId, role: "PHLEBOTOMIST", active: true } });
    if (!ph) throw new BadRequestException({ code: "PHLEBOTOMIST_NOT_FOUND" });
    if (["COLLECTED", "CANCELLED", "FAILED", "ABORTED_UNSAFE"].includes(hc.status)) throw new ConflictException({ code: "HOME_COLLECTION_CLOSED" });
    if (hc.phlebotomistId !== phlebotomistId) await this.assertBookable(u.orgId, hc, phlebotomistId);
    await this.prisma.$transaction(async (tx) => {
      await tx.homeCollection.update({ where: { id }, data: { phlebotomistId, routeSequence: routeSequence ?? null, status: hc.status === "REQUESTED" ? "SCHEDULED" : hc.status } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.assign", entityType: "HomeCollection", entityId: id, meta: { phlebotomistId } }, tx);
    });
    return this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
  }

  /**
   * HVBK01/HVCFG01/HVCFG03 via @kiorly/field-visit `canBook`: the phlebotomist's other stops that day (with 30/30 travel buffers, an optional
   * daily cap and, when the lab configured a travel matrix, real district-to-district travel time) must leave room for this one.
   */
  private async assertBookable(orgId: string, hc: { id: string; slotStart: Date; slotEnd: Date; districtId: string | null; order: { labId: string } }, phlebotomistId: string) {
    const [tenant, lab] = await Promise.all([this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } }), this.prisma.lab.findUnique({ where: { id: hc.order.labId } })]);
    const dayStart = new Date(Date.UTC(hc.slotStart.getUTCFullYear(), hc.slotStart.getUTCMonth(), hc.slotStart.getUTCDate()));
    const others = await this.prisma.homeCollection.findMany({
      where: { orgId, phlebotomistId, id: { not: hc.id }, status: { in: ["SCHEDULED", "EN_ROUTE", "ARRIVED"] }, slotStart: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } },
    });
    const planned = (r: { id: string; slotStart: Date; slotEnd: Date; districtId: string | null }): PlannedVisit => ({ id: r.id, clinicianId: phlebotomistId, startMs: r.slotStart.getTime(), endMs: r.slotEnd.getTime(), districtId: r.districtId ?? undefined });
    const matrix = lab?.travelMatrix ? buildTravelMatrix(lab.travelMatrix as Record<string, Record<string, number>>) : undefined;
    const r = canBook(planned(hc), others.map(planned), {
      defaultBuffers: { beforeMinutes: tenant.homeBufferBeforeMin ?? DEFAULT_TRAVEL_BUFFERS.beforeMinutes, afterMinutes: tenant.homeBufferAfterMin ?? DEFAULT_TRAVEL_BUFFERS.afterMinutes },
      dailyCap: tenant.homeDailyCap, matrix,
    });
    if (!r.ok) throw new ConflictException({ code: "PHLEBOTOMIST_UNAVAILABLE", reason: r.reason });
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

  /** KLORD04 "on my way": needs the organisation safety contact (fails closed); optional coarse geostamp. */
  async start(u: AuthUser, id: string, geostamp?: Geo) {
    await this.safety.requireContact(u.orgId);
    await this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, u.orgId, id);
      this.lifecycle.assertAssignedCollector(u, hc);
      const { data } = this.lifecycle.step(hc, { type: "DEPART", geostamp }, new Date());
      await tx.homeCollection.update({ where: { id }, data });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.en_route", entityType: "HomeCollection", entityId: id }, tx);
    });
    return this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
  }

  /** "Arrived" is the check-in: it needs a (coarse) location stamp. */
  async arrive(u: AuthUser, id: string, geostamp: Geo) {
    await this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, u.orgId, id);
      this.lifecycle.assertAssignedCollector(u, hc);
      const { data } = this.lifecycle.step(hc, { type: "ARRIVE", geostamp }, new Date());
      await tx.homeCollection.update({ where: { id }, data });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.arrived", entityType: "HomeCollection", entityId: id }, tx);
    });
    return this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
  }

  /** Visit did not result in a collection: a no-show before arrival, or "could not collect" once on site (never after an unsafe abort, BR61). */
  async fail(u: AuthUser, id: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, u.orgId, id);
      if (u.role === "PHLEBOTOMIST" && hc.phlebotomistId !== u.staffId) throw new ConflictException({ code: "NOT_YOUR_COLLECTION" });
      const onSite = hc.status === "ARRIVED";
      const { data } = this.lifecycle.step(hc, onSite ? { type: "FINISH" } : { type: "MARK_NO_SHOW" }, new Date());
      await tx.homeCollection.update({ where: { id }, data: { ...data, status: "FAILED", failureReason: reason } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.failed", entityType: "HomeCollection", entityId: id, meta: { onSite } }, tx);
    });
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
      // KLORD04: finishing needs the check-in (Arrived, geostamped) first.
      if (hc.status !== "ARRIVED") throw new ConflictException({ code: "ILLEGAL_HOME_COLLECTION_TRANSITION", from: hc.status });
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
        const fresh = await this.lifecycle.lock(tx, u.orgId, id);
        const { data } = this.lifecycle.step(fresh, { type: "FINISH" }, new Date());
        await tx.homeCollection.update({ where: { id }, data: { ...data, confirmedAt: new Date(), labelPhotoKey: b.labelPhotoKey ?? hc.labelPhotoKey } as Prisma.HomeCollectionUncheckedUpdateInput });
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.collected", entityType: "HomeCollection", entityId: id, meta: { photo: Boolean(b.labelPhotoKey ?? hc.labelPhotoKey) } }, tx);
        await this.orderStatus.refreshOrder(tx, hc.orderId);
      });
      return { id, status: "COLLECTED" };
    });
  }
}
