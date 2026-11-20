import { Body, Controller, Delete, Get, Header, Inject, Param, Post, Put, Query, StreamableFile } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm, Public } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { ReportsService } from "../release/reports.service";
import { PatientRegistryService } from "./patient-registry.service";
import { ReferrersService } from "./referrers.service";

const num = z.coerce.number();
const Patch = z.object({
  fullName: z.string().min(2).max(160).optional(), dateOfBirth: z.string().nullable().optional(), sex: z.enum(["M", "F", "OTHER", "UNKNOWN"]).optional(), phone: z.string().min(6).max(24).nullable().optional(),
  email: z.string().email().nullable().optional(), address: z.string().max(300).nullable().optional(), city: z.string().max(80).nullable().optional(), nationality: z.string().max(60).nullable().optional(),
  bloodGroup: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]).nullable().optional(), notes: z.string().max(1000).nullable().optional(), conditions: z.array(z.string().max(40)).max(10).optional(),
  preferredLocale: z.enum(["ar", "en"]).optional(), active: z.boolean().optional(),
}).strict();
const Merge = z.object({ targetId: z.string().min(1) }).strict();
const Consent = z.object({ kind: z.enum(["RESULT_SHARING", "DATA_PROCESSING", "MARKETING", "RESEARCH"]), granted: z.boolean(), version: z.string().max(20).optional(), channel: z.string().max(30).optional(), note: z.string().max(300).optional() }).strict();
const Referrer = z.object({
  kind: z.enum(["DOCTOR", "CLINIC", "HOSPITAL", "CORPORATE"]).optional(), name: z.string().min(2).max(160), specialty: z.string().max(80).optional(), phone: z.string().max(24).optional(), email: z.string().email().optional(),
  address: z.string().max(300).optional(), licenceNo: z.string().max(40).optional(), deliveryChannels: z.array(z.enum(["WHATSAPP", "SMS", "EMAIL"])).max(3).optional(), deliverOnRelease: z.boolean().optional(),
  preferredLocale: z.enum(["ar", "en"]).optional(), commissionType: z.enum(["NONE", "PERCENT", "FIXED"]).optional(), commissionValue: num.nonnegative().max(1_000_000).optional(),
  creditLimit: num.nonnegative().nullable().optional(), paymentTermsDays: z.number().int().min(0).max(365).optional(), active: z.boolean().optional(),
}).strict();
const ReferrerPatch = Referrer.partial();
const Amount = z.object({ amount: num.positive(), memo: z.string().max(200).optional(), orderId: z.string().optional() }).strict();
const Adjust = z.object({ account: z.enum(["COMMISSION", "CREDIT"]), amount: num, memo: z.string().min(3).max(200) }).strict();

/** M1 (KLPAT): patient registry (standalone) + referrer directory. Not flag-gated: a standalone lab depends on it. */
@ApiTags("registry")
@Controller()
export class RegistryController {
  constructor(
    @Inject(PatientRegistryService) private readonly patients: PatientRegistryService,
    @Inject(ReferrersService) private readonly referrers: ReferrersService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  // ---- patients
  @ApiBearerAuth() @Get("patient-registry") @Perm("patients.read") list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.patients.list(u, q); }
  @ApiBearerAuth() @Get("patient-registry/duplicates") @Perm("patients.merge") dups(@CurrentUser() u: AuthUser) { return this.patients.duplicates(u); }
  @ApiBearerAuth() @Put("patients/:id") @Perm("patients.write") @ZBody(Patch) update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Patch>) { return this.patients.update(u, id, b); }
  @ApiBearerAuth() @Get("patients/:id/profile") @Perm("patients.read") profile(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.patients.profile(u, id); }
  @ApiBearerAuth() @Get("patients/:id/history") @Perm("results.read") history(@CurrentUser() u: AuthUser, @Param("id") id: string, @Query() q: { analyteId?: string; from?: string; to?: string }) { return this.patients.history(u, id, q); }
  @ApiBearerAuth() @Get("patients/:id/trends") @Perm("results.read") trends(@CurrentUser() u: AuthUser, @Param("id") id: string, @Query("analyteId") analyteId?: string) { return this.patients.trends(u, id, analyteId); }
  @ApiBearerAuth() @Post("patients/:id/merge") @Perm("patients.merge") @ZBody(Merge) merge(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Merge>) { return this.patients.merge(u, id, b.targetId); }
  @ApiBearerAuth() @Get("patients/:id/consents") @Perm("patients.read") consents(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.patients.consents(u, id); }
  @ApiBearerAuth() @Post("patients/:id/consents") @Perm("patients.write") @ZBody(Consent) addConsent(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Consent>) { return this.patients.addConsent(u, id, b); }

  // ---- referrers
  @ApiBearerAuth() @Get("referrers") @Perm("referrers.read") listRef(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.referrers.list(u, q); }
  @ApiBearerAuth() @Post("referrers") @Perm("referrers.write") @ZBody(Referrer) createRef(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Referrer>) { return this.referrers.create(u, b); }
  @ApiBearerAuth() @Get("referrers/statement") @Perm("finance.commissions") statement(@CurrentUser() u: AuthUser, @Query() q: { from?: string; to?: string }) { return this.referrers.statement(u, q); }
  @ApiBearerAuth() @Get("referrers/:id") @Perm("referrers.read") getRef(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.referrers.get(u, id); }
  @ApiBearerAuth() @Put("referrers/:id") @Perm("referrers.write") @ZBody(ReferrerPatch) updateRef(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof ReferrerPatch>) { return this.referrers.update(u, id, b); }
  @ApiBearerAuth() @Get("referrers/:id/ledger") @Perm("finance.commissions") ledger(@CurrentUser() u: AuthUser, @Param("id") id: string, @Query() q: { account?: string; limit?: string }) { return this.referrers.ledger(u, id, q); }
  @ApiBearerAuth() @Post("referrers/:id/payout") @Perm("finance.commissions") @ZBody(Amount) payout(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Amount>) { return this.referrers.payout(u, id, b.amount, b.memo); }
  @ApiBearerAuth() @Post("referrers/:id/credit/charge") @Perm("finance.commissions") @ZBody(Amount) charge(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Amount>) { return this.referrers.creditCharge(u, id, b.amount, b.memo, b.orderId); }
  @ApiBearerAuth() @Post("referrers/:id/credit/payment") @Perm("finance.commissions") @ZBody(Amount) cpay(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Amount>) { return this.referrers.creditPayment(u, id, b.amount, b.memo); }
  @ApiBearerAuth() @Post("referrers/:id/adjust") @Perm("finance.commissions") @ZBody(Adjust) adjust(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Adjust>) { return this.referrers.adjust(u, id, b.account, b.amount, b.memo); }
  @ApiBearerAuth() @Post("referrers/:id/portal-token") @Perm("referrers.write") portalToken(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.referrers.issuePortalToken(u, id); }
  @ApiBearerAuth() @Delete("referrers/:id/portal-token") @Perm("referrers.write") revoke(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.referrers.revokePortalToken(u, id); }

  // ---- doctor portal (public, token-gated; only consented + released reports are downloadable)
  @Public() @Get("public/portal/:token/orders") portalOrders(@Param("token") t: string) { return this.referrers.portalOrders(t); }
  @Public() @Get("public/portal/:token/orders/:orderId/report.pdf") @Header("Content-Type", "application/pdf") @Header("Cache-Control", "no-store")
  async portalPdf(@Param("token") t: string, @Param("orderId") orderId: string) { const r = await this.referrers.portalReport(t, orderId); return new StreamableFile(await this.reports.pdf(r.orgId, r.reportId)); }
}
