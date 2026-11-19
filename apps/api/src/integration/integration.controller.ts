import { BadRequestException, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, StreamableFile } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { OrderSource } from "@prisma/client";
import { Public } from "../auth/decorators";
import type { AuthedRequest } from "../auth/auth.types";
import { z } from "../common/zod";
import { OrdersService, type Actor } from "../modules/orders/orders.service";
import { ReportsService } from "../modules/release/reports.service";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationAuthService } from "./integration-auth.service";
import { IntegrationCatalogueService } from "./integration-catalogue.service";

/** Inbound order shape for Kiorex bookings and Kiorly Clinic lab-order handoff. PROPOSED contract addition (NH-LB-025): not yet in @kiorex/contracts. */
export const InboundOrder = z.object({
  sourceRef: z.string().min(1).max(120),
  labId: z.string().optional(),
  patient: z.object({ fullName: z.string().min(2), dateOfBirth: z.string().optional(), sex: z.enum(["M", "F", "OTHER", "UNKNOWN"]).optional(), phone: z.string().optional(), externalId: z.string().optional(), preferredLocale: z.enum(["ar", "en"]).optional() }).strict(),
  testCodes: z.array(z.string()).optional(),
  packageCodes: z.array(z.string()).optional(),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).optional(),
  referringDoctor: z.object({ name: z.string().optional(), ref: z.string().optional(), phone: z.string().optional() }).strict().optional(),
  collection: z.object({ type: z.enum(["IN_LAB", "HOME"]), address: z.string().optional(), windowStart: z.string().optional(), windowEnd: z.string().optional(), geo: z.object({ lat: z.number(), lng: z.number() }).optional(), contactPhone: z.string().optional() }).strict().optional(),
  consentChannels: z.array(z.enum(["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"])).optional(),
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
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: client.orgId } });
    const actor: Actor = { orgId: client.orgId, staffId: `system:${client.source.toLowerCase()}`, labIds: [], marketCode: tenant.marketCode, system: true };
    const home = b.collection?.type === "HOME";
    // HOME bookings made on a slot the lab offered consume that slot's capacity atomically (SLOT_FULL => 409); other windows are stored as given.
    const slot = home && b.collection?.windowStart ? await this.prisma.collectionSlot.findFirst({ where: { orgId: client.orgId, startsAt: new Date(b.collection.windowStart), ...(b.labId ? { labId: b.labId } : {}) } }) : null;
    const { order, created } = await this.orders.create(actor, {
      labId: b.labId, source: client.source as OrderSource, sourceRef: b.sourceRef, patient: b.patient, testCodes: b.testCodes, packageCodes: b.packageCodes, priority: b.priority,
      referringDoctorName: b.referringDoctor?.name, referringDoctorRef: b.referringDoctor?.ref, referringDoctorPhone: b.referringDoctor?.phone, consentChannels: b.consentChannels,
      collectionType: home ? "HOME" : "IN_LAB",
      homeCollection: home ? { address: b.collection?.address ?? "", contactPhone: b.collection?.contactPhone, geo: b.collection?.geo, ...(slot ? { slotId: slot.id } : { slotStart: b.collection?.windowStart, slotEnd: b.collection?.windowEnd }) } : undefined,
    });
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

  /** Vault / clinic import fetch: allowed only for a report released on that client's channel (consent recorded). */
  @Public()
  @Get("reports/:reportId/pdf")
  @Header("Content-Type", "application/pdf")
  async pdf(@Req() req: AuthedRequest, @Param("reportId") reportId: string) {
    const client = await this.auth.authenticate(req);
    const channel = client.source === "KIORLY_CLINIC" ? "KIORLY_CLINIC_IMPORT" : "KIOREX_VAULT";
    return new StreamableFile(await this.reports.integrationPdf(client.orgId, reportId, channel));
  }
}
