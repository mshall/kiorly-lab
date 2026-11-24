import { listingPause } from "./kiorex-listing-pause";
import { BadRequestException, ConflictException, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { OrderSource } from "../generated/prisma/client";
import { Public } from "../auth/decorators";
import type { AuthedRequest } from "../auth/auth.types";
import { z } from "../common/zod";
import { OrdersService, type Actor } from "../modules/orders/orders.service";
import { ReportsService } from "../modules/release/reports.service";
import { PrismaService } from "../prisma/prisma.service";
import { acquisitionColumns, creditLinkOnce, parseAcquisitionBlock } from "../modules/growth/acquisition-fact";
import { IntegrationAuthService } from "./integration-auth.service";
import { IntegrationCatalogueService } from "./integration-catalogue.service";

/** Inbound order shape for Kiorex bookings, Kiorly Clinic lab-order handoff and Kiorly Nurse samples: `InboundLabOrder` of kiorly-lab.v1.openapi.json (kiorex-contracts 1.6.0, strict; the Nurse fields are the ratified optional additions). */
export const InboundOrder = z.object({
  sourceRef: z.string().min(1).max(120),
  labId: z.string().optional(),
  patient: z.object({ fullName: z.string().min(2), dateOfBirth: z.string().optional(), sex: z.enum(["M", "F", "OTHER", "UNKNOWN"]).optional(), phone: z.string().optional(), externalId: z.string().optional(), preferredLocale: z.enum(["ar", "en"]).optional() }).strict(),
  testCodes: z.array(z.string()).optional(),
  packageCodes: z.array(z.string()).optional(),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).optional(),
  referringDoctor: z.object({ name: z.string().optional(), ref: z.string().optional(), phone: z.string().optional() }).strict().optional(),
  collection: z.object({ type: z.enum(["IN_LAB", "HOME"]), address: z.string().optional(), districtId: z.string().optional(), windowStart: z.string().optional(), windowEnd: z.string().optional(), geo: z.object({ lat: z.number(), lng: z.number() }).optional(), contactPhone: z.string().optional() }).strict().optional(),
  consentChannels: z.array(z.enum(["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIORLY_NURSE_IMPORT", "KIOREX_VAULT"])).optional(),
  /** KLORD05 (contracts 1.6.0): kinds of the two identifiers the nurse verified at collection (e.g. DATE_OF_BIRTH + PHONE). Required with `nurseCollection`. */
  identifiersChecked: z.array(z.string()).optional(),
  /** KLORD05 / KNLAB01 (ratified in contracts 1.6.0, schema `NurseCollection`): a sample the nurse already collected. Accepted only from a KIORLY_NURSE client. */
  nurseCollection: z.object({
    visitRef: z.string().min(1).max(120),
    collectorRef: z.string().min(1).max(120),
    collectorName: z.string().max(160).optional(),
    collectedAt: z.string().datetime(),
    handedOverAt: z.string().datetime().optional(),
    temperatureC: z.number().min(-40).max(60).optional(),
    consentToken: z.string().min(8).max(512),
    samples: z.array(z.object({ label: z.string().regex(/^[\x21-\x7e]{3,40}$/), specimenType: z.string().min(2).max(60), container: z.string().max(60).optional() }).strict()).min(1).max(20),
  }).strict().optional(),
  /** GRW-P4-B2 optional Kiorex acquisition block (contracts 1.12.0 `ProductAcquisitionBlock`); validated leniently by `parseAcquisitionBlock`: a malformed or foreign block is ignored, never a 400. */
  acquisition: z.record(z.string(), z.unknown()).optional(),
}).strict();

const Quote = z.object({ labId: z.string().optional(), testCodes: z.array(z.string().min(1)).min(1).max(30), collectionType: z.enum(["HOME", "WALK_IN"]).optional() }).strict();

@ApiTags("integration")
@Controller("integration/v1")
export class IntegrationController {
  constructor(
    @Inject(IntegrationAuthService) private readonly auth: IntegrationAuthService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IntegrationCatalogueService) private readonly catalogue: IntegrationCatalogueService,
  ) {}

  // ---- Kiorex marketplace read side (kiorex-contracts 1.4.0). The client key binds the tenant; KIOREX_BOOKING clients only.
  private async kiorexClient(req: AuthedRequest) {
    const client = await this.auth.authenticate(req);
    if (client.source !== "KIOREX_BOOKING") throw new NotFoundException({ code: "NOT_AVAILABLE_FOR_CLIENT" });
    return client;
  }

  @Public() @Get("labs")
  async labs(@Req() req: AuthedRequest) { return this.catalogue.labs((await this.kiorexClient(req)).orgId); }

  @Public() @Get("tests")
  async tests(@Req() req: AuthedRequest, @Query() q: { q?: string; labId?: string }) { return this.catalogue.tests((await this.kiorexClient(req)).orgId, q); }

  @Public() @Post("tests/quote") @HttpCode(200)
  async quote(@Req() req: AuthedRequest & { body: unknown }) {
    const client = await this.kiorexClient(req);
    const p = Quote.safeParse(req.body);
    if (!p.success) throw new BadRequestException({ code: "VALIDATION_FAILED", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    return this.catalogue.quote(client.orgId, p.data);
  }

  @Public() @Get("labs/:labId/slots")
  async slots(@Req() req: AuthedRequest, @Param("labId") labId: string, @Query() q: { collectionType?: string; from?: string; to?: string }) {
    const client = await this.kiorexClient(req);
    if (!["HOME", "WALK_IN"].includes(q.collectionType ?? "") || !q.from || !q.to) throw new BadRequestException({ code: "VALIDATION_FAILED", message: "collectionType (HOME|WALK_IN), from and to are required" });
    return this.catalogue.slots(client.orgId, labId, { collectionType: q.collectionType as "HOME" | "WALK_IN", from: q.from, to: q.to });
  }

  @Public()
  @Post("orders")
  @HttpCode(200)
  @ApiOperation({ summary: "HMAC: create (idempotent on sourceRef) a lab order from Kiorex or Kiorly Clinic" })
  async create(@Req() req: AuthedRequest & { body: unknown }) {
    const client = await this.auth.authenticate(req);
    const parsed = InboundOrder.safeParse(req.body);
    if (!parsed.success) throw new BadRequestException({ code: "VALIDATION_FAILED", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const b = parsed.data;
    if (client.source === "KIOREX_BOOKING" && (await listingPause(this.prisma, client.orgId)).paused) throw new ConflictException({ code: "LISTING_PAUSED", message: "This lab paused its Kiorex listing and is not taking new bookings" });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: client.orgId } });
    const actor: Actor = { orgId: client.orgId, staffId: `system:${client.source.toLowerCase()}`, labIds: [], marketCode: tenant.marketCode, system: true };
    const home = b.collection?.type === "HOME";
    // a KIORLY_NURSE client submits only nurse-collected orders (and vice versa): the sample provenance is part of the contract
    if (client.source === "KIORLY_NURSE" && !b.nurseCollection) throw new BadRequestException({ code: "NURSE_COLLECTION_REQUIRED" });
    if (client.source === "KIORLY_NURSE" && home) throw new BadRequestException({ code: "NURSE_ORDER_CANNOT_BE_HOME_COLLECTION" });
    // HOME bookings made on a slot the lab offered consume that slot's capacity atomically (SLOT_FULL => 409); other windows are stored as given.
    const slot = home && b.collection?.windowStart ? await this.prisma.collectionSlot.findFirst({ where: { orgId: client.orgId, startsAt: new Date(b.collection.windowStart), ...(b.labId ? { labId: b.labId } : {}) } }) : null;
    const { order, created } = await this.orders.create(actor, {
      labId: b.labId, source: client.source as OrderSource, sourceRef: b.sourceRef, patient: b.patient, testCodes: b.testCodes, packageCodes: b.packageCodes, priority: b.priority,
      referringDoctorName: b.referringDoctor?.name, referringDoctorRef: b.referringDoctor?.ref, referringDoctorPhone: b.referringDoctor?.phone, consentChannels: b.consentChannels,
      collectionType: home ? "HOME" : "IN_LAB", identifiersChecked: b.identifiersChecked, nurseCollection: b.nurseCollection,
      homeCollection: home ? { address: b.collection?.address ?? "", districtId: b.collection?.districtId, contactPhone: b.collection?.contactPhone, geo: b.collection?.geo, ...(slot ? { slotId: slot.id } : { slotStart: b.collection?.windowStart, slotEnd: b.collection?.windowEnd }) } : undefined,
    });
    // GRW-P4-B2: only a Kiorex booking can carry the block; stored and counted once, in one transaction, and only when this call created the order
    const block = created && client.source === "KIOREX_BOOKING" ? parseAcquisitionBlock(b.acquisition, "LAB") : null;
    if (block) {
      await this.prisma.$transaction(async (tx) => {
        await tx.labOrder.updateMany({ where: { id: order.id, orgId: client.orgId, acquisitionOrigin: null }, data: await acquisitionColumns(tx, client.orgId, block) });
        await creditLinkOnce(tx, client.orgId, order.id, "orders");
      });
    }
    return { orderId: order.id, orderNumber: order.orderNumber, status: order.status, created };
  }

  @Public()
  @Get("orders/:sourceRef")
  async status(@Req() req: AuthedRequest, @Param("sourceRef") sourceRef: string) {
    const client = await this.auth.authenticate(req);
    const o = await this.prisma.labOrder.findFirst({ where: { orgId: client.orgId, source: client.source as OrderSource, sourceRef }, select: { id: true, orderNumber: true, status: true, collectionType: true } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    return o;
  }

  @Public()
  @Post("orders/:sourceRef/cancel")
  @HttpCode(200)
  async cancel(@Req() req: AuthedRequest, @Param("sourceRef") sourceRef: string) {
    const client = await this.auth.authenticate(req);
    const o = await this.prisma.labOrder.findFirst({ where: { orgId: client.orgId, source: client.source as OrderSource, sourceRef } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: client.orgId } });
    const r = await this.orders.cancel({ orgId: client.orgId, staffId: `system:${client.source.toLowerCase()}`, labIds: [], marketCode: tenant.marketCode } as never, o.id, "external cancellation");
    return { orderId: r.id, status: r.status };
  }

  /**
   * KNLAB01: chain of custody for an order the caller placed, as the nurse sees it: event type, time, temperature and who (NURSE / LAB),
   * never staff names, never PHI. Available to Kiorly Nurse / Kiorly Clinic clients for their own orders.
   */
  @Public()
  @Get("orders/:sourceRef/custody")
  async custody(@Req() req: AuthedRequest, @Param("sourceRef") sourceRef: string) {
    const client = await this.auth.authenticate(req);
    if (client.source !== "KIORLY_NURSE" && client.source !== "KIORLY_CLINIC") throw new NotFoundException({ code: "NOT_AVAILABLE_FOR_CLIENT" });
    const o = await this.prisma.labOrder.findFirst({ where: { orgId: client.orgId, source: client.source as OrderSource, sourceRef }, include: { specimens: { orderBy: { createdAt: "asc" }, include: { custody: { orderBy: { occurredAt: "asc" } } } }, nurseCollection: true } });
    if (!o) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    return {
      sourceRef, orderNumber: o.orderNumber, status: o.status, collectedAt: o.nurseCollection?.collectedAt ?? null, receivedAt: o.nurseCollection?.receivedAt ?? null,
      specimens: o.specimens.map((s) => ({
        label: s.barcode, accessionNumber: s.accessionNumber, status: s.status,
        custody: s.custody.map((c) => ({ type: c.type, occurredAt: c.occurredAt, by: c.actorId.startsWith("nurse:") ? "NURSE" : "LAB", temperatureC: c.temperatureC == null ? null : Number(c.temperatureC), location: c.location })),
      })),
    };
  }

  /** Vault / clinic import fetch: allowed only for a report released on that client's channel (consent recorded). */
  @Public()
  @Get("reports/:reportId/pdf")
  @Header("Content-Type", "application/pdf")
  async pdf(@Req() req: AuthedRequest, @Param("reportId") reportId: string) {
    const client = await this.auth.authenticate(req);
    const channel = client.source === "KIORLY_CLINIC" ? "KIORLY_CLINIC_IMPORT" : client.source === "KIORLY_NURSE" ? "KIORLY_NURSE_IMPORT" : "KIOREX_VAULT";
    return new StreamableFile(await this.reports.integrationPdf(client.orgId, reportId, channel));
  }
}
