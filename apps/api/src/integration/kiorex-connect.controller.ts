import { Body, Controller, Get, HttpCode, Inject, Post, Put } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Perm } from "../auth/decorators";
import { ZBody } from "../common/zod";
import { KiorexConnectService } from "./kiorex-connect.service";

const Terms = z.object({ version: z.string() }).strict();
const Payout = z.object({ label: z.string().max(60) }).strict();
const Upload = z.object({ name: z.string().max(200), contentBase64: z.string() }).strict();
const Request = z.object({ rotate: z.boolean().optional(), contactEmail: z.string().email().optional() }).strict();

/** "Connect to Kiorex" for a standalone lab (ADR-040): checklist, terms, licence, payout label placeholder, request registration, rotate credentials. */
@ApiTags("kiorex-connect")
@ApiBearerAuth()
@Controller("kiorex-connect")
export class KiorexConnectController {
  constructor(@Inject(KiorexConnectService) private readonly svc: KiorexConnectService) {}
  @Get() @Perm("settings.manage") get(@CurrentUser() u: AuthUser) { return this.svc.get(u.orgId); }
  @Put("terms") @Perm("settings.manage") @ZBody(Terms) terms(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Terms>) { return this.svc.acceptTerms(u, b.version); }
  @Put("payout") @Perm("settings.manage") @ZBody(Payout) payout(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Payout>) { return this.svc.setPayout(u, b.label); }
  @Post("licence") @HttpCode(200) @Perm("settings.manage") @ZBody(Upload) licence(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Upload>) { return this.svc.uploadLicence(u, b.name, b.contentBase64); }
  @Post("request") @HttpCode(200) @Perm("settings.manage") @ZBody(Request) request(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Request>) { return this.svc.request(u, b); }
  @Post("refresh") @HttpCode(200) @Perm("settings.manage") refresh(@CurrentUser() u: AuthUser) { return this.svc.get(u.orgId); }
}
