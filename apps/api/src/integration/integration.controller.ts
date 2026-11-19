import { BadRequestException, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Req, StreamableFile } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { OrderSource } from "@prisma/client";
import { Public } from "../auth/decorators";
import type { AuthedRequest } from "../auth/auth.types";
import { z } from "../common/zod";
import { OrdersService, type Actor } from "../modules/orders/orders.service";
import { ReportsService } from "../modules/release/reports.service";
import { PrismaService } from "../prisma/prisma.service";
import { IntegrationAuthService } from "./integration-auth.service";

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

@ApiTags("integration")
@Controller("integration/v1")
export class IntegrationController {
  constructor(
    @Inject(IntegrationAuthService) private readonly auth: IntegrationAuthService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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
    const { order, created } = await this.orders.create(actor, {
      labId: b.labId, source: client.source as OrderSource, sourceRef: b.sourceRef, patient: b.patient, testCodes: b.testCodes, packageCodes: b.packageCodes, priority: b.priority,
      referringDoctorName: b.referringDoctor?.name, referringDoctorRef: b.referringDoctor?.ref, referringDoctorPhone: b.referringDoctor?.phone, consentChannels: b.consentChannels,
      collectionType: home ? "HOME" : "IN_LAB",
      homeCollection: home ? { address: b.collection?.address ?? "", contactPhone: b.collection?.contactPhone, geo: b.collection?.geo, slotStart: b.collection?.windowStart, slotEnd: b.collection?.windowEnd } : undefined,
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
