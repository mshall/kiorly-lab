import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import type { AuthUser } from "../auth/auth.types";
import { CurrentUser, Perm } from "../auth/decorators";
import { ZBody } from "../common/zod";
import { KiorexFrontDoorService } from "./kiorex-front-door.service";

const Talk = z.object({ contactName: z.string().max(120), contactRole: z.string().max(80).optional(), phone: z.string().max(24).optional(), email: z.string().max(160).optional(), preferredTime: z.string().max(12).optional(), note: z.string().max(500).optional(), consent: z.boolean() }).strict();

/** State-aware front door of the Connect to Kiorex nav item (ADR-040). Owner / director only (settings.manage, like the wizard). */
@ApiTags("kiorex-connect")
@ApiBearerAuth()
@Controller("kiorex-connect/front-door")
export class KiorexFrontDoorController {
  constructor(@Inject(KiorexFrontDoorService) private readonly svc: KiorexFrontDoorService) {}
  @Get() @Perm("settings.manage") get(@CurrentUser() u: AuthUser) { return this.svc.get(u.orgId); }
  @Post("interest") @HttpCode(200) @Perm("settings.manage") interest(@CurrentUser() u: AuthUser) { return this.svc.interest(u.orgId); }
  @Post("start") @HttpCode(200) @Perm("settings.manage") start(@CurrentUser() u: AuthUser) { return this.svc.start(u); }
  @Post("talk") @HttpCode(200) @Perm("settings.manage") @ZBody(Talk) talk(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Talk>) { return this.svc.talk(u, b); }
}
