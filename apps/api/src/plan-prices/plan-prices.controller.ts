import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/decorators";
import { PlanPricesService } from "./plan-prices.service";
import { PlatformAdminHmacGuard } from "./platform-admin-hmac.guard";

/**
 * Kiorex platform -> this product (Lab): plan prices (Kiorly admin, maker-checker in the platform). Signed machine route under integration/v1, like the other Kiorex machine routes of the Lab.
 * GET lists every version and the organisations per edition and market; POST previews (`preview: true`) or publishes an approved proposal.
 */
@ApiTags("platform-plans")
@ApiExcludeController()
@Public()
@UseGuards(PlatformAdminHmacGuard)
@Controller("integration/v1/plans")
export class PlanPricesController {
  constructor(@Inject(PlanPricesService) private readonly svc: PlanPricesService) {}

  @Get() overview() { return this.svc.overview(); }
  @Post("prices") @HttpCode(200) price(@Body() body: unknown) { return this.svc.request(body); }
}
