import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { MobileAlertsService } from "./mobile-alerts.service";

const Ack = z.object({ note: z.string().max(500).optional() }).strict();

/** Safety path (ADR-025): not flag-gated, not entitlement-gated (see isMobileExempt). Per-kind RBAC lives in the service. */
@ApiTags("mobile")
@ApiBearerAuth()
@Controller("mobile/alerts")
export class MobileAlertsController {
  constructor(@Inject(MobileAlertsService) private readonly svc: MobileAlertsService) {}

  @Get() list(@CurrentUser() u: AuthUser, @Query("status") status?: string) { return this.svc.list(u, status === "all" ? "all" : "open"); }
  @Post(":id/ack") @ZBody(Ack) ack(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Ack>) { return this.svc.ack(u, id, b.note); }
}
