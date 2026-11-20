import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma, type StorageKind } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D } from "../../common/db";
import { resolveLabId } from "../../common/lab-scope";
import { PrismaService } from "../../prisma/prisma.service";
import { CustodyService } from "../specimens/custody.service";
import { SpecimensService } from "../specimens/specimens.service";
import { firstFreeSlot, parseSlot, retentionEnd } from "./storage-grid";

export const DEFAULT_RETENTION_DAYS = 7;

/** M3: storage racks/freezers location tracking, retention rules and disposal worklist. */
@Injectable()
export class StorageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SpecimensService) private readonly specimens: SpecimensService,
    @Inject(CustodyService) private readonly custody: CustodyService,
  ) {}

  // ----------------------------------------------------------------- units
  async createUnit(u: AuthUser, b: { labId?: string; name: string; kind?: StorageKind; rows?: number; cols?: number; tempMinC?: number; tempMaxC?: number }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    try {
      const row = await this.prisma.storageUnit.create({ data: { orgId: u.orgId, labId, name: b.name, kind: b.kind ?? "FRIDGE", rows: b.rows ?? 8, cols: b.cols ?? 12, tempMinC: b.tempMinC, tempMaxC: b.tempMaxC } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "storage.unit_create", entityType: "StorageUnit", entityId: row.id });
      return row;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException({ code: "STORAGE_UNIT_EXISTS" });
      throw e;
    }
  }

  async units(u: AuthUser) {
    const units = await this.prisma.storageUnit.findMany({ where: { orgId: u.orgId, active: true, ...(u.labIds.length ? { labId: { in: u.labIds } } : {}) }, orderBy: { name: "asc" } });
    const counts = await this.prisma.storageAssignment.groupBy({ by: ["unitId"], where: { orgId: u.orgId, releasedAt: null }, _count: true });
    return units.map((x) => ({ ...x, tempMinC: x.tempMinC == null ? null : D(x.tempMinC), tempMaxC: x.tempMaxC == null ? null : D(x.tempMaxC), capacity: x.rows * x.cols, occupied: counts.find((c) => c.unitId === x.id)?._count ?? 0 }));
  }

  /** Grid occupancy: which specimen sits where. */
  async unitContents(u: AuthUser, id: string) {
    const unit = await this.prisma.storageUnit.findFirst({ where: { id, orgId: u.orgId } });
    if (!unit) throw new NotFoundException({ code: "STORAGE_UNIT_NOT_FOUND" });
    const rows = await this.prisma.storageAssignment.findMany({ where: { orgId: u.orgId, unitId: id, releasedAt: null } });
    const sp = await this.prisma.specimen.findMany({ where: { id: { in: rows.map((r) => r.specimenId) } }, select: { id: true, accessionNumber: true, specimenType: true, retentionUntil: true } });
    return { unit: { id: unit.id, name: unit.name, kind: unit.kind, rows: unit.rows, cols: unit.cols }, slots: rows.map((r) => ({ slot: r.slot, assignedAt: r.assignedAt, specimen: sp.find((s) => s.id === r.specimenId) ?? null })) };
  }

  // ----------------------------------------------------------- assignment
  /** Stores (or moves) a specimen. Without `slot` the first free slot is used. Updates custody (STORED, with the location) and retention. */
  async assign(u: AuthUser, specimenId: string, b: { unitId: string; slot?: string; scannedBarcode?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const sp = await tx.specimen.findFirst({ where: { id: specimenId, orgId: u.orgId } });
      if (!sp) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
      const unit = await tx.storageUnit.findFirst({ where: { id: b.unitId, orgId: u.orgId, active: true } });
      if (!unit) throw new NotFoundException({ code: "STORAGE_UNIT_NOT_FOUND" });
      if (!["RECEIVED", "PROCESSING", "STORED"].includes(sp.status)) throw new ConflictException({ code: "SPECIMEN_NOT_STORABLE", status: sp.status });
      if (b.scannedBarcode !== undefined && b.scannedBarcode !== sp.barcode) throw new ConflictException({ code: "LABEL_MISMATCH", message: "scanned label does not match this specimen" });
      const taken = new Set((await tx.storageAssignment.findMany({ where: { unitId: unit.id, releasedAt: null }, select: { slot: true } })).map((a) => a.slot));
      let slot = b.slot?.trim().toUpperCase();
      if (slot) {
        if (!parseSlot(slot, unit.rows, unit.cols)) throw new BadRequestException({ code: "SLOT_INVALID", rows: unit.rows, cols: unit.cols });
        if (taken.has(slot)) throw new ConflictException({ code: "SLOT_OCCUPIED", slot });
      } else {
        const free = firstFreeSlot(unit.rows, unit.cols, taken);
        if (!free) throw new ConflictException({ code: "STORAGE_UNIT_FULL" });
        slot = free;
      }
      const prev = await tx.storageAssignment.findFirst({ where: { specimenId, releasedAt: null } });
      if (prev) await tx.storageAssignment.update({ where: { id: prev.id }, data: { releasedAt: new Date(), releasedBy: u.staffId } });
      let created;
      try {
        created = await tx.storageAssignment.create({ data: { orgId: u.orgId, specimenId, unitId: unit.id, slot, assignedBy: u.staffId } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new ConflictException({ code: "SLOT_OCCUPIED", slot });
        throw e;
      }
      const location = `${unit.name}/${slot}`;
      const rule = await tx.retentionRule.findUnique({ where: { orgId_specimenType: { orgId: u.orgId, specimenType: sp.specimenType } } });
      await tx.specimen.update({ where: { id: specimenId }, data: { retentionUntil: retentionEnd(new Date(), rule?.retentionDays ?? DEFAULT_RETENTION_DAYS) } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: prev ? "storage.move" : "storage.assign", entityType: "Specimen", entityId: specimenId, meta: { unitId: unit.id, slot } }, tx);
      if (sp.status === "STORED") await this.custody.append(tx, { orgId: u.orgId, specimenId, type: "STORED", actorId: u.staffId, location, note: prev ? "moved" : undefined });
      return { assignment: created, location, needsStoreTransition: sp.status !== "STORED" };
    }).then(async (r) => {
      // the state change goes through the single transition funnel (label scan not required for "store")
      if (r.needsStoreTransition) {
        try { await this.specimens.transition(u, specimenId, "store", { location: r.location }); }
        catch (e) { await this.prisma.storageAssignment.delete({ where: { id: r.assignment.id } }); throw e; }
      }
      return { assignment: r.assignment, location: r.location };
    });
  }

  async locate(u: AuthUser, q: { specimenId?: string; barcode?: string }) {
    const sp = await this.prisma.specimen.findFirst({ where: { orgId: u.orgId, ...(q.specimenId ? { id: q.specimenId } : { barcode: q.barcode ?? "__none__" }) } });
    if (!sp) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    const a = await this.prisma.storageAssignment.findFirst({ where: { specimenId: sp.id, releasedAt: null }, include: { unit: true } });
    return { specimenId: sp.id, accessionNumber: sp.accessionNumber, status: sp.status, retentionUntil: sp.retentionUntil, location: a ? { unitId: a.unitId, unit: a.unit.name, kind: a.unit.kind, slot: a.slot, assignedAt: a.assignedAt } : null };
  }

  /** Retrieves a stored specimen for re-testing: the slot is freed and the sample goes back to PROCESSING. */
  async retrieve(u: AuthUser, specimenId: string) {
    const out = await this.specimens.transition(u, specimenId, "retrieve", {});
    await this.prisma.storageAssignment.updateMany({ where: { specimenId, releasedAt: null }, data: { releasedAt: new Date(), releasedBy: u.staffId } });
    return out;
  }

  // -------------------------------------------------------------- retention
  async rules(u: AuthUser) { return this.prisma.retentionRule.findMany({ where: { orgId: u.orgId }, orderBy: { specimenType: "asc" } }); }

  async setRule(u: AuthUser, specimenType: string, days: number) {
    const row = await this.prisma.retentionRule.upsert({ where: { orgId_specimenType: { orgId: u.orgId, specimenType } }, create: { orgId: u.orgId, specimenType, retentionDays: days }, update: { retentionDays: days } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "retention.rule_set", entityType: "RetentionRule", entityId: row.id, meta: { days } });
    return row;
  }

  /** Stored samples whose retention window has ended (oldest first). */
  async disposalDue(u: AuthUser, asOf?: string) {
    const at = asOf ? new Date(asOf) : new Date();
    const rows = await this.prisma.specimen.findMany({ where: { orgId: u.orgId, status: "STORED", retentionUntil: { lte: at }, ...(u.labIds.length ? { labId: { in: u.labIds } } : {}) }, orderBy: { retentionUntil: "asc" }, take: 500 });
    const loc = await this.prisma.storageAssignment.findMany({ where: { specimenId: { in: rows.map((r) => r.id) }, releasedAt: null }, include: { unit: true } });
    return rows.map((r) => { const a = loc.find((l) => l.specimenId === r.id); return { id: r.id, accessionNumber: r.accessionNumber, specimenType: r.specimenType, retentionUntil: r.retentionUntil, location: a ? `${a.unit.name}/${a.slot}` : null }; });
  }

  /** Disposes the given specimens (each must be past retention unless `force`); slots are freed; one audit + custody event each. */
  async disposeBulk(u: AuthUser, ids: string[], force = false) {
    const due = new Set((await this.disposalDue(u)).map((d) => d.id));
    const out: { id: string; ok: boolean; code?: string }[] = [];
    for (const id of ids) {
      if (!force && !due.has(id)) { out.push({ id, ok: false, code: "RETENTION_NOT_ELAPSED" }); continue; }
      try {
        await this.specimens.transition(u, id, "dispose", { note: "retention elapsed" });
        await this.prisma.storageAssignment.updateMany({ where: { specimenId: id, releasedAt: null }, data: { releasedAt: new Date(), releasedBy: u.staffId } });
        out.push({ id, ok: true });
      } catch (e) {
        out.push({ id, ok: false, code: (e as { response?: { code?: string } }).response?.code ?? "FAILED" });
      }
    }
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "storage.dispose_bulk", entityType: "Specimen", entityId: ids[0] ?? "none", meta: { count: out.filter((o) => o.ok).length, force } });
    return out;
  }
}
void UnprocessableEntityException;
