import { Body, Controller, Get, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { FieldSafetyService, UNSAFE_REASONS } from "./field-safety.service";

const Geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), districtId: z.string().optional() }).strict();
const Unsafe = z.object({ reason: z.enum(UNSAFE_REASONS), geostamp: Geo.optional() }).strict();
const Sos = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();

/**
 * Phlebotomist safety endpoints (HVSAF01/02, BR61). SAFETY CONTROLS (ADR-025): deliberately NOT behind `lab.home_collection`
 * or the home_collection entitlement: switching the feature off, or a plan downgrade, must never remove SOS or the safety timer
 * from a collector who is already out. safety-controls.node.test.ts fails if this directory references flags.
 */
@ApiTags("field-safety")
@ApiBearerAuth()
@Controller()
export class FieldSafetyController {
  constructor(@Inject(FieldSafetyService) private readonly safety: FieldSafetyService) {}

  @Post("home-collections/:id/safety/answer") @Perm("collection.perform") @ApiOperation({ summary: "\"I'm OK\" - answers the safety prompt (timer re-arms)" })
  answer(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.safety.answer(u, id); }

  @Post("home-collections/:id/sos") @Perm("collection.perform") @ZBody(Sos) @ApiOperation({ summary: "One-tap SOS: live location to the safety contact; response carries 123 / 122" })
  sos(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Sos>) { return this.safety.sos(u, id, b); }

  @Post("home-collections/:id/leave-unsafe") @Perm("collection.perform") @ZBody(Unsafe) @ApiOperation({ summary: "Leave visit - unsafe (never a no-show, BR61)" })
  leave(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Unsafe>) { return this.safety.abortUnsafe(u, id, b.reason, b.geostamp); }

  @Get("home-collections/safety/alerts") @Perm("collection.manage") @ApiOperation({ summary: "Safety alerts raised for this organisation (delivery outcome, SLA)" })
  alerts(@CurrentUser() u: AuthUser, @Query() q: { limit?: string }) { return this.safety.alerts(u.orgId, q); }
}
