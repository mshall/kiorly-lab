import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BadRequestException } from "@nestjs/common";
import type { AuthUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators";
import { GrowthFlagGuard, RequiresGrowthLinks } from "./growth-flag.guard";
import { GrowthMobileService } from "./growth-mobile.service";
import { type CreateLinkBody, type UpdateLinkBody } from "./provider-links.service";

/** Kiorly staff app Growth tab API, Lab roles (GRW-P4-B1). Plan gate `mobile_staff_app` first (global MobileClientGuard), then role and Kiorex connection. */
@ApiTags("mobile")
@ApiBearerAuth()
@UseGuards(GrowthFlagGuard)
@Controller("mobile/growth")
export class GrowthMobileController {
  constructor(@Inject(GrowthMobileService) private readonly svc: GrowthMobileService) {}

  @Get() @ApiOperation({ summary: "Growth tab payload: links with 30-day counts, performance, recommendations, profile link" })
  overview(@CurrentUser() u: AuthUser) { return this.svc.overview(u); }

  @Get("links") @ApiOperation({ summary: "My provider links with last-30-day counts" })
  links(@CurrentUser() u: AuthUser) { return this.svc.linksOnly(u); }

  @Get("qr") @ApiOperation({ summary: "QR (SVG) of a link" })
  async qr(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response, @Query("linkId") linkId?: string) {
    if (!linkId) throw new BadRequestException({ code: "GROWTH_LINK_INVALID", message: "linkId is required" });
    const svg = await this.svc.qr(u, linkId); res.type("image/svg+xml; charset=utf-8"); return svg;
  }

  @RequiresGrowthLinks() @Post("links") @HttpCode(201) @ApiOperation({ summary: "Create a link (plan link limits apply)" })
  create(@CurrentUser() u: AuthUser, @Body() b: CreateLinkBody) { return this.svc.create(u, b ?? {}); }

  @Patch("links/:id") @ApiOperation({ summary: "Pause or resume a link (revoke is web only)" })
  update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: UpdateLinkBody) { return this.svc.update(u, id, b ?? {}); }
}
