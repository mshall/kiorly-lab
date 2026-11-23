import { Body, Controller, Get, HttpCode, Inject, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "./decorators";
import { ZBody, z } from "../common/zod";
import { PassportService } from "./passport.service";
import { PassportSessions } from "./passport-sessions.service";

const Exchange = z.object({ code: z.string().min(1).max(2048), codeVerifier: z.string().min(43).max(128), redirectUri: z.string().url().max(512), nonce: z.string().min(1).max(256) }).strict();

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(@Inject(PassportService) private readonly passport: PassportService, @Inject(PassportSessions) private readonly sessions: PassportSessions) {}

  /** Login page configuration: is the dev login offered, and is Kiorex Passport (OIDC + PKCE) available. Nothing secret. */
  @Public() @Get("config") config() { return this.passport.publicConfig(); }

  /** Web Passport sign-in: the SPA did authorize + PKCE; the API redeems the code server-side and issues the staff session. */
  @Public() @Post("oidc/exchange") @HttpCode(200) @ZBody(Exchange) exchange(@Body() b: z.infer<typeof Exchange>) { return this.passport.exchange(b); }

  /**
   * OIDC Back-Channel Logout receiver (registered as `backchannel_logout_uri` of the Passport client kiorly-lab-web).
   * Public by design: the signed `logout_token` is the credential. 200 = processed (idempotent per sid); 400 = invalid or replayed.
   */
  @Public() @Post("oidc/backchannel-logout") @HttpCode(200)
  async backchannelLogout(@Body("logout_token") logoutToken: unknown, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    await this.sessions.backchannelLogout(logoutToken);
    return {};
  }
}
