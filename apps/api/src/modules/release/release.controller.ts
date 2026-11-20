import { Body, Controller, Delete, Get, Header, Inject, Param, Post, Put, Query, Res, StreamableFile } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm, Public } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { DeliveryService } from "./delivery.service";
import { ReportsService } from "./reports.service";
import { TemplatesService } from "./templates.service";

const Release = z.object({ channels: z.array(z.enum(["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIORLY_NURSE_IMPORT", "KIOREX_VAULT", "REFERRER_PORTAL"])).min(1) }).strict();
const Deliver = z.object({ recipient: z.enum(["PATIENT", "REFERRER"]), channels: z.array(z.enum(["EMAIL", "WHATSAPP", "SMS"])).min(1).max(3) }).strict();
const Template = z.object({ name: z.string().min(2).max(80), labId: z.string().nullable().optional(), language: z.enum(["AR", "EN", "BILINGUAL"]).optional(), headerTitle: z.string().max(120).nullable().optional(), headerSubtitle: z.string().max(240).nullable().optional(), footerText: z.string().max(400).nullable().optional(), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), showQr: z.boolean().optional(), showRanges: z.boolean().optional() }).strict();
const TemplatePatch = Template.omit({ name: true }).partial().extend({ name: z.string().min(2).max(80).optional() }).strict();
const Logo = z.object({ imageBase64: z.string().min(20) }).strict();
const Verify = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict();

/** Release & reports. SAFETY PATH (ADR-025): nothing here is flag-gated. */
@ApiTags("release")
@Controller()
export class ReleaseController {
  constructor(
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(TemplatesService) private readonly templates: TemplatesService,
    @Inject(DeliveryService) private readonly delivery: DeliveryService,
  ) {}

  // ---- report templates (branding, bilingual layout)
  @ApiBearerAuth() @Get("report-templates") @Perm("reports.read") listTemplates(@CurrentUser() u: AuthUser) { return this.templates.list(u.orgId); }
  @ApiBearerAuth() @Post("report-templates") @Perm("templates.manage") @ZBody(Template) createTemplate(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Template>) { return this.templates.create(u, b); }
  @ApiBearerAuth() @Put("report-templates/:id") @Perm("templates.manage") @ZBody(TemplatePatch) updateTemplate(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof TemplatePatch>) { return this.templates.update(u, id, b); }
  @ApiBearerAuth() @Post("report-templates/:id/default") @Perm("templates.manage") setDefault(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.templates.setDefault(u, id); }
  @ApiBearerAuth() @Delete("report-templates/:id") @Perm("templates.manage") removeTemplate(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.templates.deactivate(u, id); }
  @ApiBearerAuth() @Put("report-templates/:id/logo") @Perm("templates.manage") @ZBody(Logo) setLogo(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Logo>) { return this.templates.setLogo(u, id, b.imageBase64); }
  @ApiBearerAuth() @Get("report-templates/:id/logo") @Perm("reports.read") async logo(@CurrentUser() u: AuthUser, @Param("id") id: string, @Res({ passthrough: true }) res: Response) { const l = await this.templates.logo(u.orgId, id); res.setHeader("Content-Type", l.type); return new StreamableFile(l.data); }
  @ApiBearerAuth() @Get("report-templates/:id/preview.pdf") @Perm("reports.read") @Header("Content-Type", "application/pdf") async previewTemplate(@CurrentUser() u: AuthUser, @Param("id") id: string) { return new StreamableFile(await this.templates.preview(u.orgId, id)); }

  // ---- delivery by (mock) email / WhatsApp / SMS
  @ApiBearerAuth() @Post("reports/:id/deliver") @Perm("reports.deliver") @ZBody(Deliver) deliver(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Deliver>) { return this.delivery.deliver(u, id, b); }
  @ApiBearerAuth() @Get("reports/:id/deliveries") @Perm("reports.read") deliveries(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.delivery.list(u, id); }
  @ApiBearerAuth() @Post("deliveries/:id/retry") @Perm("reports.deliver") retry(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.delivery.retry(u, id); }
  @Public() @Get("public/verify/:reportId") verify(@Param("reportId") id: string) { return this.reports.verifyPublic(id); }

  @ApiBearerAuth() @Get("release-queue") @Perm("reports.read") queue(@CurrentUser() u: AuthUser) { return this.reports.releaseQueue(u.orgId); }
  @ApiBearerAuth() @Get("orders/:orderId/report-readiness") @Perm("reports.read") async readiness(@CurrentUser() u: AuthUser, @Param("orderId") id: string) { const r = await this.reports.readiness(u.orgId, id); return { ready: r.ready, blockers: r.blockers }; }
  @ApiBearerAuth() @Get("orders/:orderId/reports") @Perm("reports.read") list(@CurrentUser() u: AuthUser, @Param("orderId") id: string) { return this.reports.listForOrder(u.orgId, id); }
  @ApiBearerAuth() @Post("orders/:orderId/reports") @Perm("reports.sign") sign(@CurrentUser() u: AuthUser, @Param("orderId") id: string) { return this.reports.sign(u, id); }
  @ApiBearerAuth() @Post("reports/:id/release") @Perm("reports.release") @ZBody(Release) release(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Release>) { return this.reports.release(u, id, b.channels); }
  @ApiBearerAuth() @Get("reports/:id/pdf") @Perm("reports.read") @Header("Content-Type", "application/pdf") async pdf(@CurrentUser() u: AuthUser, @Param("id") id: string) { return new StreamableFile(await this.reports.pdf(u.orgId, id)); }

  // ---- public secure link (OTP-gated; no staff auth)
  @Public() @Get("public/reports/:token") pubInfo(@Param("token") t: string) { return this.reports.publicInfo(t); }
  @Public() @Post("public/reports/:token/otp") pubOtp(@Param("token") t: string) { return this.reports.requestOtp(t); }
  @Public() @Post("public/reports/:token/verify") @ZBody(Verify) pubVerify(@Param("token") t: string, @Body() b: z.infer<typeof Verify>) { return this.reports.verifyOtp(t, b.otp); }
  @Public() @Get("public/reports/:token/download") @Header("Content-Type", "application/pdf") @Header("Content-Disposition", 'attachment; filename="lab-report.pdf"') @Header("Cache-Control", "no-store") async pubPdf(@Param("token") t: string, @Query("t") dl: string) { return new StreamableFile(await this.reports.publicPdf(t, dl ?? "")); }
}
