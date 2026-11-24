import { Body, Controller, Get, HttpCode, HttpException, Inject, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../prisma/prisma.service";
import { CurrentUser } from "./decorators";
import type { AuthUser } from "./auth.types";
import { isValidDismissedBody, sanitizeDismissed } from "./dismissed-cards";

/** Per-user preferences. Dismissed home cards live on the staff row so they follow the person across browsers and devices. */
@ApiTags("me")
@Controller("me/preferences")
export class MePreferencesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get("dismissed-cards")
  async get(@CurrentUser() u: AuthUser) {
    const r = await this.prisma.staffUser.findFirst({ where: { id: u.staffId, orgId: u.orgId }, select: { dismissedCards: true } });
    return { keys: sanitizeDismissed(r?.dismissedCards) };
  }
  @Put("dismissed-cards") @HttpCode(200)
  async put(@CurrentUser() u: AuthUser, @Body() b: unknown) {
    if (!isValidDismissedBody(b)) throw new HttpException({ statusCode: 400, code: "INVALID_REQUEST", message: "keys must be a list of up to 50 short card keys" }, 400);
    const keys = sanitizeDismissed(b.keys);
    const r = await this.prisma.staffUser.updateMany({ where: { id: u.staffId, orgId: u.orgId }, data: { dismissedCards: keys } });
    if (!r.count) throw new HttpException({ statusCode: 404, code: "NOT_FOUND", message: "User not found" }, 404);
    return { keys };
  }
}
