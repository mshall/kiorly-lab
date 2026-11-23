import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm, Public } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { AdminService } from "./admin.service";

const Login = z.object({ orgSlug: z.string().min(1), email: z.string().email() }).strict();
const Onboard = z.object({
  name: z.string().min(2), slug: z.string().regex(/^[a-z0-9-]{3,40}$/), labName: z.string().min(2), labCode: z.string().regex(/^[A-Za-z0-9]{2,6}$/), ownerName: z.string().min(2), ownerEmail: z.string().email(),
  edition: z.enum(["LITE", "PRO", "CHAIN"]).optional(), marketCode: z.string().length(2).optional(), loadStarterCatalogue: z.boolean().optional(), signatoryLicenceNo: z.string().optional(),
}).strict();
const Role = z.enum(["OWNER", "LAB_DIRECTOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST", "RECEPTION", "BRANCH_MANAGER", "SUPERVISOR", "FINANCE"]);
const Staff = z.object({ email: z.string().email(), displayName: z.string().min(2), role: Role, labIds: z.array(z.string()).optional(), signatoryLicenceNo: z.string().optional(), subject: z.string().optional(), phone: z.string().max(32).optional() }).strict();
const StaffPatch = z.object({ displayName: z.string().min(2).optional(), role: Role.optional(), labIds: z.array(z.string()).optional(), signatoryLicenceNo: z.string().nullable().optional(), active: z.boolean().optional(), phone: z.string().max(32).nullable().optional() }).strict();
const Lab = z.object({ name: z.string().min(2), code: z.string().regex(/^[A-Za-z0-9]{2,6}$/), address: z.string().optional(), licenceNo: z.string().optional() }).strict();
const Settings = z.object({ integrationMode: z.enum(["STANDALONE", "INTEGRATED"]).optional(), defaultLocale: z.enum(["ar", "en"]).optional(), name: z.string().min(2).optional(), vatRatePercent: z.coerce.number().min(0).max(100).optional(), referringDoctorStatements: z.boolean().optional(), qcValidityHours: z.number().int().min(1).max(168).optional(), safetyContactName: z.string().min(2).max(120).nullable().optional(), safetyContactPhone: z.string().min(6).max(24).nullable().optional(), homeBufferBeforeMin: z.number().int().min(0).max(180).optional(), homeBufferAfterMin: z.number().int().min(0).max(180).optional(), homeDailyCap: z.number().int().min(1).max(50).nullable().optional() }).strict();
const LabPatch = z.object({ name: z.string().min(2).optional(), address: z.string().nullable().optional(), licenceNo: z.string().nullable().optional(), appointmentCapacity: z.number().int().min(1).max(100).optional(), appointmentSlotMinutes: z.number().int().min(10).max(240).optional(), openingHour: z.number().int().min(0).max(23).optional(), closingHour: z.number().int().min(1).max(24).optional() }).strict();
const Coverage = z.object({ districtIds: z.array(z.string().min(2).max(80)).min(1).max(200), maxTravelMinutes: z.number().int().min(1).max(600).nullable().optional(), startDistrictId: z.string().min(2).max(80).nullable().optional(), travelMatrix: z.record(z.string(), z.record(z.string(), z.number().int().min(0).max(600))).nullable().optional() }).strict();
const Client = z.object({ source: z.enum(["KIOREX_BOOKING", "KIORLY_CLINIC", "KIORLY_NURSE"]), kiorexBaseUrl: z.string().url().optional() }).strict();

@ApiTags("admin")
@Controller()
export class AdminController {
  constructor(@Inject(AdminService) private readonly svc: AdminService) {}

  @Public() @Get("auth/dev/orgs") devOrgs() { return this.svc.devOrgs(); }
  @Public() @Post("auth/dev-login") @ZBody(Login) devLogin(@Body() b: z.infer<typeof Login>) { return this.svc.devLogin(b); }
  @Public() @Post("onboarding/tenants") @ZBody(Onboard) onboard(@Body() b: z.infer<typeof Onboard>) { return this.svc.onboard(b); }

  @ApiBearerAuth() @Get("auth/me") me(@CurrentUser() u: AuthUser) { return this.svc.me(u); }
  @ApiBearerAuth() @Post("onboarding/starter-catalogue") @Perm("settings.manage") starter(@CurrentUser() u: AuthUser) { return this.svc.loadStarterCatalogue(u); }

  @ApiBearerAuth() @Get("staff") @Perm("staff.manage") staff(@CurrentUser() u: AuthUser) { return this.svc.listStaff(u.orgId); }
  @ApiBearerAuth() @Get("staff/lookup") @Perm("collection.manage") lookup(@CurrentUser() u: AuthUser) { return this.svc.lookupStaff(u.orgId); }
  @ApiBearerAuth() @Post("staff") @Perm("staff.manage") @ZBody(Staff) createStaff(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Staff>) { return this.svc.createStaff(u, b); }
  @ApiBearerAuth() @Put("staff/:id") @Perm("staff.manage") @ZBody(StaffPatch) updateStaff(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof StaffPatch>) { return this.svc.updateStaff(u, id, b); }
  @ApiBearerAuth() @Get("rbac") @Perm("staff.manage") rbac() { return this.svc.rbacMatrix(); }

  @ApiBearerAuth() @Get("labs") labs(@CurrentUser() u: AuthUser) { return this.svc.listLabs(u.orgId); }
  @ApiBearerAuth() @Post("labs") @Perm("settings.manage") @ZBody(Lab) createLab(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Lab>) { return this.svc.createLab(u, b); }
  @ApiBearerAuth() @Put("labs/:id") @Perm("settings.manage") @ZBody(LabPatch) updateLab(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof LabPatch>) { return this.svc.updateLab(u, id, b); }
  @ApiBearerAuth() @Put("labs/:id/coverage") @Perm("settings.manage") @ZBody(Coverage) coverage(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Coverage>) { return this.svc.setCoverage(u, id, b); }
  @ApiBearerAuth() @Get("settings") @Perm("dashboard.read") settings(@CurrentUser() u: AuthUser) { return this.svc.getSettings(u.orgId); }
  @ApiBearerAuth() @Put("settings") @Perm("settings.manage") @ZBody(Settings) updateSettings(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Settings>) { return this.svc.updateSettings(u, b); }
  @ApiBearerAuth() @Get("audit-logs") @Perm("audit.read") audit(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.svc.auditLogs(u.orgId, q); }
  @ApiBearerAuth() @Get("dev/inbox") @Perm("settings.manage") inbox(@CurrentUser() u: AuthUser, @Query() q: { purpose?: string; limit?: string }) { return this.svc.inbox(u.orgId, q); }
  @ApiBearerAuth() @Get("integration-clients") @Perm("settings.manage") clients(@CurrentUser() u: AuthUser) { return this.svc.listClients(u.orgId); }
  @ApiBearerAuth() @Post("integration-clients") @Perm("settings.manage") @ZBody(Client) createClient(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Client>) { return this.svc.createClient(u, b.source, b.kiorexBaseUrl); }
}
