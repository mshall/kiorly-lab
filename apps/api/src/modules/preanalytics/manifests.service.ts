import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { ManifestKind, ManifestStatus, Prisma } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, nextSequence, pad } from "../../common/db";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { CustodyService } from "../specimens/custody.service";
import { EVENT_STATUS, MANIFEST_NEXT } from "./storage-grid";

const SHIPPABLE = ["COLLECTED", "RECEIVED", "PROCESSING", "STORED"];

export interface ManifestInput {
  kind: ManifestKind; fromLabId?: string; toLabId?: string; destinationName?: string; specimenIds: string[]; courierId?: string; courierName?: string; courierPhone?: string; temperatureC?: number; note?: string;
}

/** M3: transport manifests for inter-branch transfers and send-outs, courier directory and tracking timeline. */
@Injectable()
export class ManifestsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CustodyService) private readonly custody: CustodyService,
  ) {}

  // ---------------------------------------------------------------- couriers
  couriers(u: AuthUser) { return this.prisma.courier.findMany({ where: { orgId: u.orgId, active: true }, orderBy: { name: "asc" } }); }
  async createCourier(u: AuthUser, b: { name: string; phone?: string; company?: string }) {
    const row = await this.prisma.courier.upsert({ where: { orgId_name: { orgId: u.orgId, name: b.name } }, create: { orgId: u.orgId, ...b }, update: { phone: b.phone, company: b.company, active: true } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "courier.upsert", entityType: "Courier", entityId: row.id });
    return row;
  }

  // --------------------------------------------------------------- manifests
  async create(u: AuthUser, b: ManifestInput) {
    const fromLabId = await resolveLabId(this.prisma, u, b.fromLabId);
    if (b.kind === "INTER_BRANCH" && !b.toLabId) throw new BadRequestException({ code: "DESTINATION_LAB_REQUIRED" });
    if (b.kind === "SEND_OUT" && !b.destinationName) throw new BadRequestException({ code: "DESTINATION_NAME_REQUIRED" });
    if (b.toLabId && b.toLabId === fromLabId) throw new BadRequestException({ code: "SAME_LAB" });
    return this.prisma.$transaction(async (tx) => {
      if (b.toLabId && !(await tx.lab.findFirst({ where: { id: b.toLabId, orgId: u.orgId } }))) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
      const specimens = await tx.specimen.findMany({ where: { id: { in: b.specimenIds }, orgId: u.orgId } });
      if (specimens.length !== new Set(b.specimenIds).size) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
      const bad = specimens.filter((s) => !SHIPPABLE.includes(s.status));
      if (bad.length) throw new UnprocessableEntityException({ code: "SPECIMEN_NOT_SHIPPABLE", specimens: bad.map((s) => ({ id: s.id, status: s.status })) });
      const open = await tx.manifestItem.findMany({ where: { specimenId: { in: specimens.map((s) => s.id) }, status: "PACKED", manifest: { status: { in: ["DRAFT", "DISPATCHED", "IN_TRANSIT", "DELIVERED"] } } }, select: { specimenId: true } });
      if (open.length) throw new ConflictException({ code: "SPECIMEN_ALREADY_ON_MANIFEST", specimenIds: open.map((o) => o.specimenId) });
      let courierName = b.courierName;
      let courierPhone = b.courierPhone;
      if (b.courierId) {
        const c = await tx.courier.findFirst({ where: { id: b.courierId, orgId: u.orgId } });
        if (!c) throw new NotFoundException({ code: "COURIER_NOT_FOUND" });
        courierName ??= c.name;
        courierPhone ??= c.phone ?? undefined;
      }
      const year = new Date().getUTCFullYear();
      const number = `MAN-${year}-${pad(await nextSequence(tx, u.orgId, `man:${year}`), 6)}`;
      const m = await tx.transportManifest.create({
        data: {
          orgId: u.orgId, number, kind: b.kind, fromLabId, toLabId: b.toLabId, destinationName: b.destinationName, courierId: b.courierId, courierName, courierPhone, temperatureC: b.temperatureC, note: b.note,
          trackingRef: `TRK-${randomBytes(6).toString("hex").toUpperCase()}`, createdBy: u.staffId, items: { create: specimens.map((s) => ({ orgId: u.orgId, specimenId: s.id })) },
        },
      });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "manifest.create", entityType: "TransportManifest", entityId: m.id, meta: { kind: b.kind, specimens: specimens.length } }, tx);
      return this.view(tx, u.orgId, m.id);
    });
  }

  private async view(db: Prisma.TransactionClient | PrismaServiceLike, orgId: string, id: string) {
    const m = await db.transportManifest.findFirst({ where: { id, orgId }, include: { items: true, events: { orderBy: { at: "asc" } } } });
    if (!m) throw new NotFoundException({ code: "MANIFEST_NOT_FOUND" });
    const sp = await db.specimen.findMany({ where: { id: { in: m.items.map((i) => i.specimenId) } }, select: { id: true, accessionNumber: true, barcode: true, specimenType: true } });
    return { ...m, temperatureC: m.temperatureC == null ? null : D(m.temperatureC), events: m.events.map((e) => ({ ...e, temperatureC: e.temperatureC == null ? null : D(e.temperatureC) })), items: m.items.map((i) => ({ ...i, specimen: sp.find((s) => s.id === i.specimenId) ?? null })) };
  }

  get(u: AuthUser, id: string) { return this.view(this.prisma, u.orgId, id); }

  async list(u: AuthUser, q: { status?: string; kind?: string }) {
    const rows = await this.prisma.transportManifest.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as ManifestStatus } : {}), ...(q.kind ? { kind: q.kind as ManifestKind } : {}) }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    return rows.map((r) => ({ ...r, temperatureC: r.temperatureC == null ? null : D(r.temperatureC), itemCount: r._count.items }));
  }

  private async mustGet(tx: Prisma.TransactionClient, u: AuthUser, id: string) {
    const m = await tx.transportManifest.findFirst({ where: { id, orgId: u.orgId }, include: { items: true } });
    if (!m) throw new NotFoundException({ code: "MANIFEST_NOT_FOUND" });
    return m;
  }
  private assertNext(m: { status: ManifestStatus }, to: ManifestStatus) {
    if (!MANIFEST_NEXT[m.status]!.includes(to)) throw new ConflictException({ code: "MANIFEST_ILLEGAL_TRANSITION", from: m.status, to });
  }

  /** Hand-over to the courier: custody TRANSPORT_STARTED on every specimen. */
  async dispatch(u: AuthUser, id: string, b: { courierName?: string; courierPhone?: string; temperatureC?: number }) {
    return this.prisma.$transaction(async (tx) => {
      const m = await this.mustGet(tx, u, id);
      this.assertNext(m, "DISPATCHED");
      if (!(b.courierName ?? m.courierName)) throw new BadRequestException({ code: "COURIER_REQUIRED" });
      await tx.transportManifest.update({ where: { id }, data: { status: "DISPATCHED", dispatchedAt: new Date(), courierName: b.courierName ?? m.courierName, courierPhone: b.courierPhone ?? m.courierPhone, temperatureC: b.temperatureC ?? m.temperatureC } });
      const dest = m.destinationName ?? (m.toLabId ? (await tx.lab.findUnique({ where: { id: m.toLabId } }))?.name : undefined);
      for (const i of m.items) await this.custody.append(tx, { orgId: u.orgId, specimenId: i.specimenId, type: "TRANSPORT_STARTED", actorId: u.staffId, location: `manifest ${m.number}`, temperatureC: b.temperatureC, note: `to ${dest ?? "destination"}` });
      await tx.courierEvent.create({ data: { orgId: u.orgId, manifestId: id, status: "PICKED_UP", note: "dispatched", by: u.staffId, temperatureC: b.temperatureC } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "manifest.dispatch", entityType: "TransportManifest", entityId: id }, tx);
      return this.view(tx, u.orgId, id);
    });
  }

  /** Courier tracking event (also reachable by the courier app): updates the manifest status when it implies one. */
  async addEvent(u: AuthUser, id: string, b: { status: string; location?: string; note?: string; temperatureC?: number }) {
    return this.prisma.$transaction(async (tx) => {
      const m = await this.mustGet(tx, u, id);
      if (["DRAFT", "RECEIVED", "CANCELLED"].includes(m.status)) throw new ConflictException({ code: "MANIFEST_NOT_TRACKABLE", status: m.status });
      await tx.courierEvent.create({ data: { orgId: u.orgId, manifestId: id, status: b.status, location: b.location, note: b.note, temperatureC: b.temperatureC, by: u.staffId } });
      const to = EVENT_STATUS[b.status];
      if (to && to !== m.status && MANIFEST_NEXT[m.status]!.includes(to)) await tx.transportManifest.update({ where: { id }, data: { status: to as ManifestStatus, ...(to === "DELIVERED" ? { deliveredAt: new Date() } : {}) } });
      return this.view(tx, u.orgId, id);
    });
  }

  /**
   * Receiving end: scan the barcodes that arrived; anything not scanned is flagged MISSING (custody note). Inter-branch specimens get a RECEIVED custody event
   * at the destination. The manifest is RECEIVED once every item is accounted for.
   */
  async receive(u: AuthUser, id: string, b: { barcodes: string[]; temperatureC?: number; note?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const m = await this.mustGet(tx, u, id);
      if (m.status === "DISPATCHED" || m.status === "IN_TRANSIT") await tx.transportManifest.update({ where: { id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      else if (m.status !== "DELIVERED") throw new ConflictException({ code: "MANIFEST_ILLEGAL_TRANSITION", from: m.status, to: "RECEIVED" });
      const sp = await tx.specimen.findMany({ where: { id: { in: m.items.map((i) => i.specimenId) } }, select: { id: true, barcode: true } });
      const scanned = new Set(b.barcodes);
      const unknown = b.barcodes.filter((c) => !sp.some((s) => s.barcode === c));
      if (unknown.length) throw new UnprocessableEntityException({ code: "BARCODE_NOT_ON_MANIFEST", barcodes: unknown });
      const dest = m.toLabId ? (await tx.lab.findUnique({ where: { id: m.toLabId } }))?.name : m.destinationName;
      for (const i of m.items) {
        const barcode = sp.find((s) => s.id === i.specimenId)?.barcode;
        if (scanned.has(barcode ?? "")) {
          await tx.manifestItem.update({ where: { id: i.id }, data: { status: "RECEIVED", receivedAt: new Date() } });
          await this.custody.append(tx, { orgId: u.orgId, specimenId: i.specimenId, type: "RECEIVED", actorId: u.staffId, location: dest ?? undefined, temperatureC: b.temperatureC, note: `manifest ${m.number}` });
        } else if (i.status === "PACKED") {
          await tx.manifestItem.update({ where: { id: i.id }, data: { status: "MISSING", note: b.note } });
        }
      }
      const items = await tx.manifestItem.findMany({ where: { manifestId: id } });
      const missing = items.filter((i) => i.status === "MISSING").length;
      await tx.transportManifest.update({ where: { id }, data: { status: "RECEIVED", receivedAt: new Date(), receivedBy: u.staffId, note: b.note ?? m.note } });
      await tx.courierEvent.create({ data: { orgId: u.orgId, manifestId: id, status: "DELIVERED", note: missing ? `${missing} missing` : "all received", by: u.staffId, temperatureC: b.temperatureC } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "manifest.receive", entityType: "TransportManifest", entityId: id, meta: { received: items.length - missing, missing } }, tx);
      return this.view(tx, u.orgId, id);
    });
  }

  async cancel(u: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const m = await this.mustGet(tx, u, id);
      this.assertNext(m, "CANCELLED");
      await tx.transportManifest.update({ where: { id }, data: { status: "CANCELLED" } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "manifest.cancel", entityType: "TransportManifest", entityId: id }, tx);
      return this.view(tx, u.orgId, id);
    });
  }

  /** Public courier tracking (no PHI: status + timeline + counts). */
  async track(ref: string) {
    const m = await this.prisma.transportManifest.findUnique({ where: { trackingRef: ref }, include: { events: { orderBy: { at: "asc" } }, _count: { select: { items: true } } } });
    if (!m) throw new NotFoundException({ code: "TRACKING_NOT_FOUND" });
    return { trackingRef: m.trackingRef, number: m.number, status: m.status, kind: m.kind, specimens: m._count.items, dispatchedAt: m.dispatchedAt, deliveredAt: m.deliveredAt, events: m.events.map((e) => ({ status: e.status, location: e.location, at: e.at })) };
  }
}
type PrismaServiceLike = import("../../prisma/prisma.service").PrismaService;
