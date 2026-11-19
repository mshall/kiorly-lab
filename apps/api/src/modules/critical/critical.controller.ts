import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { CatalogueService } from "../catalogue/catalogue.service";
import { CriticalService } from "./critical.service";

const Ack = z.object({ note: z.string().max(500).optional() }).strict();
const CriticalBody = z.object({ criticalLow: z.coerce.number().nullable().optional(), criticalHigh: z.coerce.number().nullable().optional(), ackWithinMinutes: z.number().int().min(1).max(1440) }).strict();

/** Safety path (ADR-025): not flag-gated, no switch. */
@ApiTags("critical")
@ApiBearerAuth()
@Controller()
export class CriticalController {
  constructor(
    @Inject(CriticalService) private readonly svc: CriticalService,
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
  ) {}

  @Get("critical-alerts") @Perm("critical.read") list(@CurrentUser() u: AuthUser, @Query("status") status?: string) { return this.svc.list(u.orgId, status); }
  @Post("critical-alerts/:id/ack") @Perm("critical.ack") @ZBody(Ack) ack(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Ack>) { return this.svc.acknowledge(u, id, b.note); }
  @Get("critical-rules") @Perm("critical.read") rules(@CurrentUser() u: AuthUser) { return this.catalogue.listCriticalRules(u.orgId); }
  @Put("analytes/:id/critical-rule") @Perm("critical.configure") @ZBody(CriticalBody) setRule(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof CriticalBody>) { return this.catalogue.setCriticalRule(u, id, b); }
}
