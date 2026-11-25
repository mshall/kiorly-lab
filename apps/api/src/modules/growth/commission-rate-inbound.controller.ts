import { Body, Controller, HttpCode, Inject, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../auth/decorators";
import type { AuthedRequest } from "../../auth/auth.types";
import { IntegrationAuthService } from "../../integration/integration-auth.service";
import { CommissionRateService } from "./commission-rate.service";

/** COM-2 (additive, contracts 1.13.0): Kiorex -> Lab. HMAC like every integration call; the client key binds the organisation, a view addressed to another organisation is refused. */
@ApiTags("integration")
@Controller("integration/v1")
export class CommissionRateInboundController {
  constructor(@Inject(IntegrationAuthService) private readonly auth: IntegrationAuthService, @Inject(CommissionRateService) private readonly rates: CommissionRateService) {}

  @Public() @Post("commission-rates") @HttpCode(200)
  @ApiOperation({ summary: "HMAC: Kiorex reports the lab's commission rate view; idempotent, newest version wins" })
  async receive(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    const client = await this.auth.authenticate(req);
    if (client.source !== "KIOREX_BOOKING") return { applied: false, ignored: true };
    return this.rates.ingest(client.orgId, body);
  }
}
