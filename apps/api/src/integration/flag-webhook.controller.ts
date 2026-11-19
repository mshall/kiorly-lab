import { Controller, Headers, HttpCode, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { verifyWebhook } from "@kiorex/contracts";
import { Public } from "../auth/decorators";
import type { AuthedRequest } from "../auth/auth.types";
import { appConfig } from "../config/app-config";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";

/** flag.changed push from the Kiorex control plane (HMAC webhook scheme, INTEGRATION.md): verified, then the snapshot is refreshed immediately. */
@ApiTags("feature-flags")
@Controller("feature-flags/kiorex")
export class FlagWebhookController {
  constructor(@Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService) {}

  @Public()
  @Post("changed")
  @HttpCode(202)
  async changed(@Req() req: AuthedRequest, @Headers("x-kiorly-timestamp") ts?: string, @Headers("x-kiorly-signature") sig?: string) {
    const v = verifyWebhook({ secret: appConfig.flagsWebhookSecret(), body: req.rawBody ?? "", timestamp: ts, signature: sig });
    if (!v.ok) throw new UnauthorizedException({ code: "INVALID_WEBHOOK_SIGNATURE", reason: v.reason });
    const r = await this.flags.refresh();
    return { accepted: true, refresh: r };
  }
}
