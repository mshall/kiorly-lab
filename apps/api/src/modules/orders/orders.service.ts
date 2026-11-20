import { BadRequestException, ConflictException, HttpException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, type OrderSource, type ReleaseChannel, type TestDefinition } from "../../generated/prisma/client";
import { buildTravelMatrix, isInCoverage } from "@kiorly/field-visit";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, type Db, nextSequence, pad, round2 } from "../../common/db";
import { IDENTIFIER_KINDS, NURSE_INTAKE_IDENTIFIER_KINDS, presentIdentifiers, twoIdentifiersOk } from "../../common/identity";
import { OrderStatusService } from "../../common/order-status.service";
import { eventSource, isExternalSource } from "../../common/order-source";
import { page } from "../../common/pagination";
import { assertFlagOn } from "../../feature-flags/flag-gate";
import { FeatureFlagsService } from "../../feature-flags/feature-flags.service";
import { KERNEL_ENTITLEMENTS, KERNEL_PRICE_BOOK, type EntitlementsPort, type PriceBookPort } from "../../kernel-adapter/ports";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { OutboxService } from "../../outbox/outbox.service";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveLabId } from "../../common/lab-scope";
import { presentHomeCollection } from "../field-safety/field-visit-map";
import { SpecimensService } from "../specimens/specimens.service";
import { type PatientInput, PatientsService } from "./patients.service";

export interface HomeCollectionInput {
  slotId?: string;
  address: string;
  contactPhone?: string;
  geo?: { lat: number; lng: number };
  /** For external bookings that carry their own window instead of a lab slot. */
  slotStart?: string;
  slotEnd?: string;
  /** Market-pack district id of the address; required when the lab has coverage districts configured (HVBK01). */
  districtId?: string;
}

/** KLORD05 / KNLAB01: a sample the nurse already collected (custody starts at `collectedAt`, the nurse's clock). */
export interface NurseCollectionInput {
  visitRef: string;
  collectorRef: string;
  collectorName?: string;
  collectedAt: string;
  handedOverAt?: string;
  temperatureC?: number;
  /** LAB_RESULTS record-share consent token (patient consent); required. Only its hash is stored. */
  consentToken: string;
  /** One entry per specimen group (type + container): `label` is the tube label the nurse applied and becomes the barcode to scan at receipt. */
  samples: { label: string; specimenType: string; container?: string }[];
}

export interface CreateOrderInput {
  labId?: string;
  patientId?: string;
  patient?: PatientInput;
  testCodes?: string[];
  packageCodes?: string[];
  source?: OrderSource;
  sourceRef?: string;
  referringDoctorName?: string;
  referringDoctorRef?: string;
  referringDoctorPhone?: string;
  referrerId?: string;
  clinicalInfo?: string;
  icdCodes?: string[];
  fastingConfirmed?: boolean;
  priority?: "ROUTINE" | "URGENT" | "STAT";
  collectionType?: "IN_LAB" | "HOME";
  b2bAccountId?: string;
  identifiersChecked?: string[];
  consentChannels?: ReleaseChannel[];
  homeCollection?: HomeCollectionInput;
  nurseCollection?: NurseCollectionInput;
  /** DEFER: create the order without specimens; accession later (e.g. pre-printed accession labels, KLSPC01). */
  accession?: "AUTO" | "DEFER";
}

/** The actor on whose behalf an order is created: a staff user, or a system integration client. */
export type Actor = Pick<AuthUser, "orgId" | "staffId" | "labIds" | "marketCode"> & { system?: boolean };

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PatientsService) private readonly patients: PatientsService,
    @Inject(SpecimensService) private readonly specimens: SpecimensService,
    @Inject(OrderStatusService) private readonly orderStatus: OrderStatusService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(KERNEL_ENTITLEMENTS) private readonly ent: EntitlementsPort,
    @Inject(KERNEL_PRICE_BOOK) private readonly prices: PriceBookPort,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
  ) {}

  /** KLORD02: creates an order from any source. External sources are idempotent on (orgId, source, sourceRef). */
  async create(actor: Actor, input: CreateOrderInput): Promise<{ order: Awaited<ReturnType<OrdersService["get"]>>; created: boolean }> {
    const source: OrderSource = input.source ?? "WALK_IN";
    if (input.sourceRef) {
      const existing = await this.prisma.labOrder.findUnique({ where: { orgId_source_sourceRef: { orgId: actor.orgId, source, sourceRef: input.sourceRef } } });
      if (existing) return { order: await this.get(actor.orgId, existing.id), created: false };
    } else if (isExternalSource(source)) {
      throw new BadRequestException({ code: "SOURCE_REF_REQUIRED" });
    }
    if (source === "KIORLY_NURSE") {
      this.assertNurseInput(input);
      input = { ...input, collectionType: "IN_LAB", accession: "DEFER" };
    } else if (input.nurseCollection) {
      throw new UnprocessableEntityException({ code: "NURSE_COLLECTION_NOT_ALLOWED", message: "nurseCollection is only accepted from a Kiorly Nurse client" });
    }
    if (input.collectionType === "HOME") {
      assertFlagOn(this.flags, "lab.home_collection", { orgId: actor.orgId, market: actor.marketCode });
      if (!(await this.ent.has(actor.orgId, "home_collection"))) throw new HttpException({ code: "PLAN_REQUIRED", capability: "home_collection" }, 402);
    }
    if (source === "KIOREX_BOOKING") assertFlagOn(this.flags, "lab.kiorex_bookings", { orgId: actor.orgId, market: actor.marketCode });

    try {
      const id = await this.prisma.$transaction(async (tx) => this.createInTx(tx, actor, input, source));
      return { order: await this.get(actor.orgId, id), created: true };
    } catch (e) {
      // concurrent replay of the same external order
      if (input.sourceRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const existing = await this.prisma.labOrder.findUnique({ where: { orgId_source_sourceRef: { orgId: actor.orgId, source, sourceRef: input.sourceRef } } });
        if (existing) return { order: await this.get(actor.orgId, existing.id), created: false };
      }
      throw e;
    }
  }

  /** KLORD05: consent + two verified identifiers + sane custody clock are preconditions of accepting a pre-collected sample. */
  private assertNurseInput(input: CreateOrderInput) {
    const n = input.nurseCollection;
    if (!n) throw new BadRequestException({ code: "NURSE_COLLECTION_REQUIRED" });
    if (!n.consentToken?.trim()) throw new UnprocessableEntityException({ code: "CONSENT_REQUIRED", message: "a patient consent token is required for nurse-collected samples" });
    if (!input.identifiersChecked?.length) throw new UnprocessableEntityException({ code: "TWO_IDENTIFIERS_REQUIRED", allowed: NURSE_INTAKE_IDENTIFIER_KINDS });
    const skew = Date.now() + 5 * 60_000;
    const collected = Date.parse(n.collectedAt);
    if (Number.isNaN(collected)) throw new BadRequestException({ code: "COLLECTED_AT_INVALID" });
    if (collected > skew) throw new UnprocessableEntityException({ code: "COLLECTED_IN_FUTURE" });
    if (n.handedOverAt) {
      const h = Date.parse(n.handedOverAt);
      if (Number.isNaN(h) || h < collected || h > skew) throw new UnprocessableEntityException({ code: "HANDOVER_TIME_INVALID", message: "hand-over must be between collection and now" });
    }
    if (!n.samples?.length) throw new UnprocessableEntityException({ code: "SAMPLES_REQUIRED" });
  }

  private async createInTx(tx: Prisma.TransactionClient, actor: Actor, input: CreateOrderInput, source: OrderSource): Promise<string> {
    const labId = await resolveLabId(tx, actor as AuthUser, input.labId);
    const orgId = actor.orgId;
    let patient = input.patientId ? await tx.patientRef.findFirst({ where: { id: input.patientId, orgId } }) : null;
    if (input.patientId && !patient) throw new NotFoundException({ code: "PATIENT_NOT_FOUND" });
    if (!patient) {
      if (!input.patient) throw new BadRequestException({ code: "PATIENT_REQUIRED" });
      patient = await this.patients.upsert(tx, orgId, input.patient);
    }

    // tests + packages
    const codes = [...new Set((input.testCodes ?? []).map((c) => c.toUpperCase()))];
    const pkgCodes = [...new Set((input.packageCodes ?? []).map((c) => c.toUpperCase()))];
    if (!codes.length && !pkgCodes.length) throw new BadRequestException({ code: "NO_TESTS" });
    const tests = await tx.testDefinition.findMany({ where: { orgId, code: { in: codes }, active: true } });
    const unknown = codes.filter((c) => !tests.some((t) => t.code === c));
    const pkgs = await tx.testPackage.findMany({ where: { orgId, code: { in: pkgCodes } }, include: { items: { include: { test: true } } } });
    unknown.push(...pkgCodes.filter((c) => !pkgs.some((p) => p.code === c)));
    if (unknown.length) throw new UnprocessableEntityException({ code: "UNKNOWN_TESTS", codes: unknown });

    let priceListId: string | null = null;
    if (input.b2bAccountId) {
      const acc = await tx.b2bAccount.findFirst({ where: { id: input.b2bAccountId, orgId, active: true } });
      if (!acc) throw new NotFoundException({ code: "B2B_ACCOUNT_NOT_FOUND" });
      priceListId = acc.priceListId;
    }
    type ItemSeed = { test: TestDefinition; price: number; packageCode?: string };
    const items: ItemSeed[] = [];
    for (const t of tests) items.push({ test: t, price: await this.prices.resolve({ orgId, testId: t.id, priceListId }, tx) });
    for (const p of pkgs) {
      const total = await this.prices.resolve({ orgId, packageId: p.id, priceListId }, tx);
      const indiv = await Promise.all(p.items.map((i) => this.prices.resolve({ orgId, testId: i.testId, priceListId }, tx)));
      const sum = indiv.reduce((a, b) => a + b, 0);
      let allocated = 0;
      p.items.forEach((i, idx) => {
        const share = idx === p.items.length - 1 ? round2(total - allocated) : round2(sum > 0 ? (total * indiv[idx]) / sum : total / p.items.length);
        allocated = round2(allocated + share);
        items.push({ test: i.test, price: share, packageCode: p.code });
      });
    }

    // KLORD03: identity + consent
    const checked = input.identifiersChecked ?? [];
    let identityVerified = false;
    if (checked.length) {
      const nurse = source === "KIORLY_NURSE";
      const kinds = nurse ? NURSE_INTAKE_IDENTIFIER_KINDS : IDENTIFIER_KINDS;
      if (!twoIdentifiersOk(checked, nurse ? [...presentIdentifiers(patient), "fullName"] : presentIdentifiers(patient), kinds)) throw new UnprocessableEntityException({ code: "TWO_IDENTIFIERS_REQUIRED", allowed: kinds });
      identityVerified = true;
    }
    let consent = input.consentChannels ?? [];
    // a nurse-collected sample is shared under the patient's consent token: results go back to the nurse by default (KLCRIT02)
    if (source === "KIORLY_NURSE") consent = [...new Set<ReleaseChannel>([...consent, "KIORLY_NURSE_IMPORT"])];

    const referrer = input.referrerId ? await tx.referrer.findFirst({ where: { id: input.referrerId, orgId, active: true } }) : null;
    if (input.referrerId && !referrer) throw new NotFoundException({ code: "REFERRER_NOT_FOUND" });
    const orderNumber = `ORD-${new Date().getUTCFullYear()}-${pad(await nextSequence(tx, orgId, `ord:${new Date().getUTCFullYear()}`), 6)}`;
    const order = await tx.labOrder.create({
      data: {
        orgId, labId, patientId: patient.id, source, sourceRef: input.sourceRef, status: "AWAITING_COLLECTION", orderNumber,
        identityVerified, identifiersChecked: identityVerified ? [...new Set(checked)] : [],
        referringDoctorName: referrer?.name ?? input.referringDoctorName, referringDoctorRef: input.referringDoctorRef, referringDoctorPhone: referrer?.phone ?? input.referringDoctorPhone, referrerId: referrer?.id, clinicalInfo: input.clinicalInfo, icdCodes: [...new Set(input.icdCodes ?? [])], fastingConfirmed: input.fastingConfirmed,
        consentShareChannels: consent, consentCapturedAt: consent.length ? new Date() : null,
        priority: input.priority ?? "ROUTINE", collectionType: source === "KIORLY_NURSE" ? "NURSE_VISIT" : (input.collectionType ?? "IN_LAB"), b2bAccountId: input.b2bAccountId, createdBy: actor.staffId,
        items: { create: items.map((i) => ({ testId: i.test.id, price: i.price, packageCode: i.packageCode })) },
      },
    });
    if (input.accession !== "DEFER") await this.specimens.createForOrder(tx, { id: order.id, orgId, labId });

    if (source === "KIORLY_NURSE") {
      const n = input.nurseCollection!;
      await tx.nurseCollection.create({
        data: {
          orgId, orderId: order.id, nurseVisitRef: n.visitRef, collectorRef: n.collectorRef, collectorName: n.collectorName, collectedAt: new Date(n.collectedAt),
          handedOverAt: n.handedOverAt ? new Date(n.handedOverAt) : null, temperatureC: n.temperatureC, consentTokenHash: createHash("sha256").update(n.consentToken).digest("hex"),
        },
      });
      await this.specimens.createCollectedForOrder(tx, { id: order.id, orgId, labId }, n);
      await this.orderStatus.refreshOrder(tx, order.id);
      await this.audit.record({ orgId, actorId: actor.staffId, action: "order.nurse_collected", entityType: "LabOrder", entityId: order.id, meta: { samples: n.samples.length, handedOver: Boolean(n.handedOverAt) } }, tx);
    }

    if (input.collectionType === "HOME") {
      if (!input.homeCollection) throw new BadRequestException({ code: "HOME_COLLECTION_REQUIRED" });
      await this.bookHome(tx, actor, order.id, labId, input.homeCollection, patient.phone ?? patient.externalId ?? undefined, patient.preferredLocale);
    }

    await this.audit.record({ orgId, actorId: actor.staffId, action: "order.create", entityType: "LabOrder", entityId: order.id, meta: { source, tests: items.length, consent, home: input.collectionType === "HOME" } }, tx);
    if (consent.length) await this.audit.record({ orgId, actorId: actor.staffId, action: "order.consent", entityType: "LabOrder", entityId: order.id, meta: { channels: consent } }, tx);
    if (isExternalSource(source)) {
      await this.outbox.enqueue({ orgId, type: "LabOrderCreated", aggregateType: "LabOrder", aggregateId: order.id, data: { orderId: order.id, orderNumber, ...eventSource(source), sourceRef: input.sourceRef, labId }, eventId: `evt_ordcr_${order.id}` }, tx);
    }
    return order.id;
  }

  // ------------------------------------------------------------- reads
  async list(u: AuthUser, q: { status?: string; source?: string; search?: string; labId?: string; from?: string; to?: string; limit?: string; offset?: string }) {
    const where: Prisma.LabOrderWhereInput = {
      orgId: u.orgId,
      ...(u.labIds.length ? { labId: { in: u.labIds } } : {}),
      ...(q.labId ? { labId: q.labId } : {}),
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.source ? { source: q.source as never } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      ...(q.search ? { OR: [{ orderNumber: { contains: q.search, mode: "insensitive" } }, { patient: { fullName: { contains: q.search, mode: "insensitive" } } }, { patient: { phone: { contains: q.search } } }, { specimens: { some: { accessionNumber: { contains: q.search, mode: "insensitive" } } } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.labOrder.findMany({ where, include: { patient: { select: { fullName: true, sex: true, dateOfBirth: true, phone: true } }, items: { include: { test: { select: { code: true, nameEn: true, nameAr: true } } } }, specimens: { select: { id: true, accessionNumber: true, status: true } } }, orderBy: { createdAt: "desc" }, ...page(q) }),
      this.prisma.labOrder.count({ where }),
    ]);
    return { total, rows: rows.map((r) => ({ ...r, items: r.items.map((i) => ({ ...i, price: D(i.price) })) })) };
  }

  /** `viewer` decides address visibility on the home collection (HVPRV01); without one (system callers) the address is always masked. */
  async get(orgId: string, id: string, viewer?: Pick<AuthUser, "staffId" | "role">) {
    const o = await this.prisma.labOrder.findFirst({
      where: { id, orgId },
      include: {
        patient: { select: { id: true, fullName: true, sex: true, dateOfBirth: true, phone: true, externalId: true, nationalIdLast4: true, preferredLocale: true } },
        items: { include: { test: true }, orderBy: { createdAt: "asc" } },
        specimens: { orderBy: { createdAt: "asc" } },
        homeCollection: true,
        nurseCollection: { select: { id: true, nurseVisitRef: true, collectorRef: true, collectorName: true, collectedAt: true, handedOverAt: true, temperatureC: true, receivedAt: true } },
        reports: { orderBy: { version: "desc" }, select: { id: true, version: true, signedAt: true, correctionReason: true } },
        invoices: { select: { id: true, number: true, status: true, total: true, paidTotal: true } },
      },
    });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const homeCollection = o.homeCollection ? presentHomeCollection(viewer ?? { staffId: "", role: "RECEPTION" }, o.homeCollection) : o.homeCollection;
    return { ...o, homeCollection, nurseCollection: o.nurseCollection ? { ...o.nurseCollection, temperatureC: o.nurseCollection.temperatureC == null ? null : D(o.nurseCollection.temperatureC) } : null, items: o.items.map((i) => ({ ...i, price: D(i.price), test: { ...i.test, price: D(i.test.price), volumeMl: i.test.volumeMl == null ? null : D(i.test.volumeMl) } })), invoices: o.invoices.map((i) => ({ ...i, total: D(i.total), paidTotal: D(i.paidTotal) })) };
  }

  // ----------------------------------------------- identity & consent
  /** KLORD03: records that two distinct identifiers were verified at the desk or doorstep. */
  async verifyIdentity(u: AuthUser, orderId: string, checked: string[]) {
    const o = await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, include: { patient: true } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    if (!twoIdentifiersOk(checked, presentIdentifiers(o.patient))) throw new UnprocessableEntityException({ code: "TWO_IDENTIFIERS_REQUIRED", allowed: IDENTIFIER_KINDS });
    await this.prisma.$transaction(async (tx) => {
      await tx.labOrder.update({ where: { id: orderId }, data: { identityVerified: true, identifiersChecked: [...new Set(checked)] } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "order.identity_verified", entityType: "LabOrder", entityId: orderId, meta: { kinds: [...new Set(checked)] } }, tx);
    });
    return this.get(u.orgId, orderId, u);
  }

  /** KLORD03 / safety.lab.consent_enforcement: result-sharing consent per release channel (wording is NEEDS_HUMAN NH-LB-007). */
  async setConsent(u: AuthUser, orderId: string, channels: ReleaseChannel[]) {
    const o = await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    await this.prisma.$transaction(async (tx) => {
      await tx.labOrder.update({ where: { id: orderId }, data: { consentShareChannels: [...new Set(channels)], consentCapturedAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "order.consent", entityType: "LabOrder", entityId: orderId, meta: { channels } }, tx);
    });
    return this.get(u.orgId, orderId, u);
  }

  async cancel(u: AuthUser, orderId: string, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.labOrder.findFirst({ where: { id: orderId, orgId: u.orgId }, include: { specimens: true, homeCollection: true, items: true } });
      if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
      if (o.status === "CANCELLED") return;
      if (o.homeCollection && ["EN_ROUTE", "ARRIVED"].includes(o.homeCollection.status)) {
        throw new ConflictException({ code: "ORDER_NOT_CANCELLABLE", message: "the collector is in the field; finish or abort the visit first" });
      }
      if (o.specimens.some((s) => ["RECEIVED", "PROCESSING", "STORED"].includes(s.status)) || o.items.some((i) => ["RESULTED", "VALIDATED", "RELEASED"].includes(i.status))) {
        throw new ConflictException({ code: "ORDER_NOT_CANCELLABLE", message: "work has started on this order" });
      }
      await tx.orderItem.updateMany({ where: { orderId }, data: { status: "CANCELLED" } });
      const rev = await tx.labOrder.update({ where: { id: orderId }, data: { cancelReason: reason ?? null, cancelledAt: new Date(), cancelledBy: u.staffId, revision: { increment: 1 } } });
      await tx.orderRevision.create({ data: { orgId: u.orgId, orderId, revision: rev.revision, changedBy: u.staffId, changes: { status: { from: o.status, to: "CANCELLED" } }, reason: reason ?? null } });
      if (o.homeCollection && ["REQUESTED", "SCHEDULED"].includes(o.homeCollection.status)) {
        await tx.homeCollection.update({ where: { id: o.homeCollection.id }, data: { status: "CANCELLED" } });
        if (o.homeCollection.slotId) await tx.$executeRaw`UPDATE "CollectionSlot" SET booked = GREATEST(booked - 1, 0) WHERE id = ${o.homeCollection.slotId}`;
      }
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "order.cancel", entityType: "LabOrder", entityId: orderId, meta: { reason: reason ? "provided" : "none" } }, tx);
      await this.orderStatus.refreshOrder(tx, orderId);
    });
    return this.get(u.orgId, orderId, u);
  }

  // -------------------------------------------------- home collection
  /** Books a slot (atomic capacity check) and creates the HomeCollection row. */
  async bookHome(tx: Prisma.TransactionClient, actor: Actor, orderId: string, labId: string, h: HomeCollectionInput, contact: string | undefined, locale: string) {
    // HVBK01: a home collection is booked only for an address inside the lab's coverage zone (when one is configured).
    const lab = await tx.lab.findUnique({ where: { id: labId } });
    if (lab && lab.coverageDistricts.length) {
      const matrix = lab.travelMatrix ? buildTravelMatrix(lab.travelMatrix as Record<string, Record<string, number>>) : undefined;
      const cov = isInCoverage({ districtIds: lab.coverageDistricts, maxTravelMinutes: lab.maxTravelMinutes, startDistrictId: lab.startDistrictId }, h.districtId ? { districtId: h.districtId } : null, matrix);
      if (!cov.inZone) throw new UnprocessableEntityException({ code: "OUT_OF_COVERAGE", reason: cov.reason, ...(h.districtId ? { districtId: h.districtId } : {}) });
    }
    let slotStart: Date;
    let slotEnd: Date;
    let slotId: string | null = null;
    if (h.slotId) {
      const slot = await tx.collectionSlot.findFirst({ where: { id: h.slotId, orgId: actor.orgId, labId } });
      if (!slot) throw new NotFoundException({ code: "SLOT_NOT_FOUND" });
      const n = await tx.$executeRaw`UPDATE "CollectionSlot" SET booked = booked + 1 WHERE id = ${slot.id} AND booked < capacity`;
      if (n === 0) throw new ConflictException({ code: "SLOT_FULL" });
      slotId = slot.id;
      slotStart = slot.startsAt;
      slotEnd = slot.endsAt;
    } else if (h.slotStart && h.slotEnd) {
      slotStart = new Date(h.slotStart);
      slotEnd = new Date(h.slotEnd);
      if (!(slotStart < slotEnd)) throw new BadRequestException({ code: "SLOT_INVALID" });
    } else throw new BadRequestException({ code: "SLOT_REQUIRED" });
    const hc = await tx.homeCollection.create({
      data: {
        orgId: actor.orgId, orderId, status: "SCHEDULED", slotStart, slotEnd, address: h.address, districtId: h.districtId ? h.districtId.trim().toLowerCase() : null, history: [{ state: "REQUESTED", atMs: Date.now() }, { state: "CONFIRMED", atMs: Date.now() }] as Prisma.InputJsonValue, geo: (h.geo ?? undefined) as Prisma.InputJsonValue | undefined,
        contactPhone: h.contactPhone ?? contact, slotId, routeDate: new Date(Date.UTC(slotStart.getUTCFullYear(), slotStart.getUTCMonth(), slotStart.getUTCDate())),
      },
    });
    if (contact) {
      // TODO_NEEDS_HUMAN (NH-LB-018): approved reminder template (EN + AR).
      await this.messaging.send({ orgId: actor.orgId, channel: "WHATSAPP", purpose: "COLLECTION_REMINDER", recipientRef: h.contactPhone ?? contact, templateId: "TODO_NEEDS_HUMAN_COLLECTION_REMINDER", params: { locale, slotStart: slotStart.toISOString() }, relatedType: "HomeCollection", relatedId: hc.id }, tx);
    }
    return hc;
  }
}
