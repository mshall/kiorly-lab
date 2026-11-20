import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma, type RejectionReason, type Specimen } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { type Db, nextSequence, pad, ymd } from "../../common/db";
import { OrderStatusService } from "../../common/order-status.service";
import { page } from "../../common/pagination";
import { PrismaService } from "../../prisma/prisma.service";
import { code128bSvg } from "./code128";
import { CustodyService } from "./custody.service";
import { ACTION_EVENT, SCAN_REQUIRED, type SpecimenAction, nextSpecimenStatus } from "./specimen-state";

export interface TransitionInput {
  scannedBarcode?: string;
  temperatureC?: number;
  location?: string;
  note?: string;
}

@Injectable()
export class SpecimensService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CustodyService) private readonly custody: CustodyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OrderStatusService) private readonly orderStatus: OrderStatusService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
  ) {}

  // ----------------------------------------------------------- accession
  /** KLSPC01: per-lab, per-day sequence. Uniqueness is guaranteed by the (labId, accessionNumber) unique index regardless. */
  async nextAccession(db: Db, orgId: string, labId: string, at = new Date()): Promise<string> {
    const lab = await db.lab.findUniqueOrThrow({ where: { id: labId } });
    const seq = await nextSequence(db, orgId, `acc:${labId}:${ymd(at)}`);
    return `${lab.code}${ymd(at).slice(2)}${pad(seq, 4)}`;
  }

  /**
   * Creates one specimen per distinct (specimenType, container) among the order's items and links the items.
   * `accessionNumber` may be supplied (pre-printed labels); duplicates are rejected with 409 ACCESSION_DUPLICATE (stop-ship: replay test).
   */
  async createForOrder(db: Db, order: { id: string; orgId: string; labId: string }, opts: { accessionNumber?: string } = {}) {
    const items = await db.orderItem.findMany({ where: { orderId: order.id, specimenId: null, status: { not: "CANCELLED" } }, include: { test: true } });
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const k = `${it.test.specimenType}|${it.test.container ?? ""}`;
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    if (opts.accessionNumber && groups.size > 1) throw new BadRequestException({ code: "ACCESSION_MANUAL_SINGLE_SPECIMEN", message: "supply an accession only when the order needs a single specimen" });
    const out: Specimen[] = [];
    for (const [k, group] of groups) {
      const [specimenType, container] = k.split("|");
      const accession = opts.accessionNumber ?? (await this.nextAccession(db, order.orgId, order.labId));
      const sp = await this.insertSpecimen(db, { orgId: order.orgId, labId: order.labId, orderId: order.id, accessionNumber: accession, barcode: accession, specimenType, container: container || null });
      await db.orderItem.updateMany({ where: { id: { in: group.map((g) => g.id) } }, data: { specimenId: sp.id } });
      out.push(sp);
    }
    return out;
  }

  /**
   * KLORD05: specimens a nurse already collected. One specimen per (type, container) group, each carrying the nurse's tube label as its
   * barcode (so the physical label is what gets scanned at receipt) and a lab-generated accession. The chain of custody STARTS at the
   * nurse's collection time (COLLECTED, then TRANSPORT_STARTED at hand-over), not at ingest.
   */
  async createCollectedForOrder(db: Db, order: { id: string; orgId: string; labId: string }, n: { visitRef: string; collectorRef: string; collectedAt: string; handedOverAt?: string; temperatureC?: number; samples: { label: string; specimenType: string; container?: string }[] }) {
    const norm = (t: string, c?: string | null) => `${t.trim().toLowerCase()}|${(c ?? "").trim().toLowerCase()}`;
    const items = await db.orderItem.findMany({ where: { orderId: order.id, specimenId: null, status: { not: "CANCELLED" } }, include: { test: true } });
    const groups = new Map<string, typeof items>();
    for (const it of items) groups.set(norm(it.test.specimenType, it.test.container), [...(groups.get(norm(it.test.specimenType, it.test.container)) ?? []), it]);
    const samples = new Map<string, (typeof n.samples)[number]>();
    for (const s of n.samples) {
      const k = norm(s.specimenType, s.container);
      if (samples.has(k)) throw new UnprocessableEntityException({ code: "SAMPLE_DUPLICATE_GROUP", specimenType: s.specimenType });
      samples.set(k, s);
    }
    const unmatched = [...samples.keys()].filter((k) => !groups.has(k));
    if (unmatched.length) throw new UnprocessableEntityException({ code: "SAMPLE_UNMATCHED", samples: unmatched.map((k) => samples.get(k)!.label) });
    const missing = [...groups.entries()].filter(([k]) => !samples.has(k));
    if (missing.length) throw new UnprocessableEntityException({ code: "SAMPLE_MISSING_FOR_TEST", testCodes: missing.flatMap(([, g]) => g.map((i) => i.test.code)) });
    const collectedAt = new Date(n.collectedAt);
    const handedOverAt = n.handedOverAt ? new Date(n.handedOverAt) : null;
    const actorId = `nurse:${n.collectorRef}`;
    const out: Specimen[] = [];
    for (const [k, group] of groups) {
      const sample = samples.get(k)!;
      const accession = await this.nextAccession(db, order.orgId, order.labId);
      const sp = await this.insertSpecimen(db, {
        orgId: order.orgId, labId: order.labId, orderId: order.id, accessionNumber: accession, barcode: sample.label, specimenType: group[0].test.specimenType, container: group[0].test.container,
        status: handedOverAt ? "IN_TRANSIT" : "COLLECTED", collectedAt, collectedByRef: n.collectorRef,
      });
      await db.orderItem.updateMany({ where: { id: { in: group.map((g) => g.id) } }, data: { specimenId: sp.id } });
      await this.custody.append(db, { orgId: order.orgId, specimenId: sp.id, type: "COLLECTED", actorId, location: "nurse home visit", temperatureC: n.temperatureC, note: `collected by nurse visit ${n.visitRef}`, at: collectedAt });
      if (handedOverAt) await this.custody.append(db, { orgId: order.orgId, specimenId: sp.id, type: "TRANSPORT_STARTED", actorId, location: "nurse hand-over to lab", temperatureC: n.temperatureC, note: "handed over for transport to the lab", at: handedOverAt });
      out.push(sp);
    }
    return out;
  }

  private async insertSpecimen(db: Db, data: Prisma.SpecimenUncheckedCreateInput): Promise<Specimen> {
    try {
      return await db.specimen.create({ data });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException({ code: "ACCESSION_DUPLICATE", message: "accession number or barcode already exists in this lab" });
      }
      throw e;
    }
  }

  /** Manual accessioning (e.g. pre-printed accession labels). */
  async accessionOrder(u: AuthUser, orderId: string, accessionNumber?: string) {
    const order = await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId } });
    if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    if (accessionNumber !== undefined && !/^[\x21-\x7e]{3,40}$/.test(accessionNumber)) throw new BadRequestException({ code: "ACCESSION_FORMAT" });
    return this.prisma.$transaction(async (tx) => {
      const made = await this.createForOrder(tx, order, { accessionNumber });
      for (const s of made) await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "specimen.accession", entityType: "Specimen", entityId: s.id }, tx);
      return made;
    });
  }

  // --------------------------------------------------------------- reads
  async list(u: AuthUser, q: { status?: string; orderId?: string; labId?: string; search?: string; limit?: string; offset?: string }) {
    const where: Prisma.SpecimenWhereInput = {
      orgId: u.orgId,
      ...(u.labIds.length ? { labId: { in: u.labIds } } : {}),
      ...(q.labId ? { labId: q.labId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.orderId ? { orderId: q.orderId } : {}),
      ...(q.search ? { OR: [{ accessionNumber: { contains: q.search, mode: "insensitive" } }, { barcode: { contains: q.search, mode: "insensitive" } }] } : {}),
    };
    return this.prisma.specimen.findMany({ where, include: { order: { include: { patient: { select: { fullName: true, sex: true, dateOfBirth: true } } } } }, orderBy: { createdAt: "desc" }, ...page(q) });
  }

  async get(orgId: string, id: string) {
    const s = await this.prisma.specimen.findFirst({ where: { id, orgId }, include: { custody: { orderBy: { occurredAt: "asc" } }, aliquots: true, order: { include: { patient: true, items: { include: { test: true } } } } } });
    if (!s) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    return s;
  }

  async byBarcode(orgId: string, barcode: string) {
    const s = await this.prisma.specimen.findFirst({ where: { orgId, barcode }, include: { order: { include: { patient: { select: { fullName: true, sex: true, dateOfBirth: true } } } } } });
    if (!s) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    return s;
  }

  async custodyChain(orgId: string, id: string) {
    if (!(await this.prisma.specimen.findFirst({ where: { id, orgId }, select: { id: true } }))) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    return this.custody.list(orgId, id);
  }

  // ------------------------------------------------------------- labels
  async label(orgId: string, id: string) {
    const s = await this.get(orgId, id);
    const tests = s.order.items.filter((i) => i.specimenId === s.id).map((i) => i.test.code);
    return {
      specimenId: s.id, accessionNumber: s.accessionNumber, barcode: s.barcode, symbology: "CODE128", specimenType: s.specimenType, container: s.container,
      patientName: s.order.patient.fullName, dateOfBirth: s.order.patient.dateOfBirth, orderNumber: s.order.orderNumber, tests,
      svg: code128bSvg(s.barcode),
      /** Printer-agnostic ZPL for thermal label printers (NH-LB-012 pending the chosen printer). */
      zpl: `^XA^FO30,20^BY2^BCN,70,Y,N,N^FD${s.barcode}^FS^FO30,120^A0N,24,24^FD${tests.join(",")}^FS^XZ`,
    };
  }

  async markPrinted(u: AuthUser, id: string) {
    const label = await this.label(u.orgId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.specimen.update({ where: { id }, data: { labelsPrinted: { increment: 1 } } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "specimen.label_print", entityType: "Specimen", entityId: id }, tx);
    });
    return label;
  }

  // -------------------------------------------------------- transitions
  /** Single funnel for every status move: state machine + label scan check + custody event + audit + order status. */
  async transition(u: AuthUser, id: string, action: SpecimenAction, input: TransitionInput = {}) {
    return this.prisma.$transaction(async (tx) => {
      const sp = await tx.specimen.findFirst({ where: { id, orgId: u.orgId }, include: { order: true } });
      if (!sp) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
      if (u.labIds.length && !u.labIds.includes(sp.labId)) throw new BadRequestException({ code: "LAB_NOT_ALLOWED" });
      if (action === "collect" && !sp.order.identityVerified) {
        throw new ConflictException({ code: "IDENTITY_NOT_VERIFIED", message: "verify two patient identifiers before collection (KLORD03)" });
      }
      const next = nextSpecimenStatus(sp.status, action);
      if (!next) throw new ConflictException({ code: "ILLEGAL_SPECIMEN_TRANSITION", from: sp.status, action });
      if (SCAN_REQUIRED.includes(action)) await this.assertLabelMatch(tx, u, sp, input.scannedBarcode);
      await tx.specimen.update({ where: { id }, data: { status: next, ...(action === "collect" ? { collectedAt: new Date() } : {}) } });
      let note = input.note;
      if (action === "receive") {
        // KLORD05: transit time from the nurse's collection to receipt is part of the chain (viability judgement stays with the lab, NH-LB-034).
        const nc = await tx.nurseCollection.findUnique({ where: { orderId: sp.orderId } });
        if (nc) {
          const minutes = Math.max(0, Math.round((Date.now() - (sp.collectedAt ?? nc.collectedAt).getTime()) / 60_000));
          note = [note, `received from nurse collection, ${minutes} min after collection`].filter(Boolean).join("; ");
          await tx.nurseCollection.updateMany({ where: { orderId: sp.orderId, receivedAt: null }, data: { receivedAt: new Date() } });
        }
      }
      await this.custody.append(tx, { orgId: u.orgId, specimenId: id, type: ACTION_EVENT[action], actorId: u.staffId, location: input.location, temperatureC: input.temperatureC, note });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `specimen.${action}`, entityType: "Specimen", entityId: id, meta: { from: sp.status, to: next } }, tx);
      if (action === "process") {
        await tx.orderItem.updateMany({ where: { specimenId: id, status: "PENDING" }, data: { status: "IN_PROGRESS" } });
      }
      await this.orderStatus.refreshOrder(tx, sp.orderId);
      return tx.specimen.findUniqueOrThrow({ where: { id } });
    });
  }

  /**
   * safety.lab.label_match (stop-ship: mislabelled sample processed): the scanned barcode must equal the specimen's barcode.
   * A mismatch is recorded in the chain of custody (outside the failing transaction so it survives) and the move is refused.
   */
  private async assertLabelMatch(_tx: Db, u: AuthUser, sp: Specimen, scanned: string | undefined) {
    if (scanned === sp.barcode) return;
    await this.prisma.custodyEvent.create({
      data: { orgId: u.orgId, specimenId: sp.id, type: "LABEL_MISMATCH_BLOCKED", actorId: u.staffId, note: scanned ? "scanned barcode does not match specimen" : "no barcode scanned" },
    });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "specimen.label_mismatch_blocked", entityType: "Specimen", entityId: sp.id });
    throw new ConflictException({ code: "LABEL_MISMATCH", message: "scanned label does not match this specimen; processing is blocked" });
  }

  // ---------------------------------------------------------- aliquots
  /** KLSPC02: aliquots link to the parent; each gets its own barcode `<parent>-A<n>` and an ALIQUOTED custody event on the parent. */
  async aliquot(u: AuthUser, parentId: string, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new BadRequestException({ code: "ALIQUOT_COUNT_INVALID" });
    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.specimen.findFirst({ where: { id: parentId, orgId: u.orgId } });
      if (!parent) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
      if (!["RECEIVED", "PROCESSING", "STORED"].includes(parent.status)) throw new ConflictException({ code: "ILLEGAL_SPECIMEN_TRANSITION", from: parent.status, action: "aliquot" });
      const existing = await tx.specimen.count({ where: { parentSpecimenId: parentId } });
      const made: Specimen[] = [];
      for (let i = 1; i <= count; i++) {
        const code = `${parent.accessionNumber}-A${existing + i}`;
        made.push(
          await this.insertSpecimen(tx, {
            orgId: u.orgId, labId: parent.labId, orderId: parent.orderId, accessionNumber: code, barcode: code, specimenType: parent.specimenType,
            container: parent.container, parentSpecimenId: parentId, status: "RECEIVED",
          }),
        );
        await this.custody.append(tx, { orgId: u.orgId, specimenId: made[made.length - 1].id, type: "RECEIVED", actorId: u.staffId, note: `aliquot of ${parent.accessionNumber}` });
      }
      await this.custody.append(tx, { orgId: u.orgId, specimenId: parentId, type: "ALIQUOTED", actorId: u.staffId, note: `${count} aliquot(s)` });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "specimen.aliquot", entityType: "Specimen", entityId: parentId, meta: { count } }, tx);
      return made;
    });
  }

  // --------------------------------------------------------- rejection
  /** KLSPC04: rejection triggers a re-collection (new pending specimen linked to the rejected one) and a patient notice (mock WhatsApp). */
  async reject(u: AuthUser, id: string, reason: RejectionReason, note?: string) {
    return this.prisma.$transaction(async (tx) => {
      const sp = await tx.specimen.findFirst({ where: { id, orgId: u.orgId }, include: { order: { include: { patient: true, homeCollection: true } } } });
      if (!sp) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
      const next = nextSpecimenStatus(sp.status, "reject");
      if (!next) throw new ConflictException({ code: "ILLEGAL_SPECIMEN_TRANSITION", from: sp.status, action: "reject" });
      await tx.specimen.update({ where: { id }, data: { status: next, rejectionReason: reason, rejectionNote: note } });
      await this.custody.append(tx, { orgId: u.orgId, specimenId: id, type: "REJECTED", actorId: u.staffId, note: reason });
      const accession = await this.nextAccession(tx, u.orgId, sp.labId);
      const recollect = await this.insertSpecimen(tx, {
        orgId: u.orgId, labId: sp.labId, orderId: sp.orderId, accessionNumber: accession, barcode: accession, specimenType: sp.specimenType, container: sp.container, recollectOfId: sp.id,
      });
      await tx.orderItem.updateMany({ where: { specimenId: sp.id }, data: { specimenId: recollect.id, status: "PENDING" } });
      if (sp.order.homeCollection && sp.order.homeCollection.status === "COLLECTED") {
        await tx.homeCollection.update({ where: { id: sp.order.homeCollection.id }, data: { status: "REQUESTED", confirmedAt: null } });
      }
      const contact = sp.order.patient.phone ?? sp.order.patient.externalId;
      if (contact) {
        // TODO_NEEDS_HUMAN (NH-LB-008): approved AR/EN wording + WhatsApp template. Params carry no clinical data.
        await this.messaging.send({ orgId: u.orgId, channel: "WHATSAPP", purpose: "RECOLLECTION", recipientRef: contact, templateId: "TODO_NEEDS_HUMAN_RECOLLECTION_NOTICE", params: { orderNumber: sp.order.orderNumber ?? sp.orderId, locale: sp.order.patient.preferredLocale }, relatedType: "Specimen", relatedId: sp.id }, tx);
      }
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "specimen.reject", entityType: "Specimen", entityId: id, meta: { reason, recollectionSpecimenId: recollect.id } }, tx);
      await this.orderStatus.refreshOrder(tx, sp.orderId);
      return { rejected: id, recollection: recollect };
    });
  }
}
