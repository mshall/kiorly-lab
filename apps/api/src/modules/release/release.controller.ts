import { Body, Controller, Get, Header, Inject, Param, Post, Query, Res, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm, Public } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { ReportsService } from "./reports.service";

const Release = z.object({ channels: z.array(z.enum(["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"])).min(1) }).strict();
const Verify = z.object({ otp: z.string().regex(/^\d{6}$/) }).strict();

/** Release & reports. SAFETY PATH (ADR-025): nothing here is flag-gated. */
@ApiTags("release")
@Controller()
export class ReleaseController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

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
  @Public() @Get("public/reports/:token/download") @Header("Content-Type", "application/pdf") async pubPdf(@Param("token") t: string, @Query("t") dl: string) { return new StreamableFile(await this.reports.publicPdf(t, dl ?? "")); }
}
