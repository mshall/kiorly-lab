import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser, AuthedRequest } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { MobileUpgradeService } from "./mobile-upgrade.service";
import { MobileService } from "./mobile.service";

const Device = z.object({ deviceId: z.string().min(8).max(80), platform: z.enum(["ios", "android", "web"]), name: z.string().min(1).max(120), appVersion: z.string().max(40).optional(), pushToken: z.string().max(300).optional() }).strict();
const UpgradeRequest = z.object({ featureKey: z.string().max(80).optional(), note: z.string().max(500).optional() }).strict();
const PushToken = z.object({ token: z.string().min(1).max(300), provider: z.enum(["expo", "mock"]) }).strict();

/** Kiorly Work staff app API. Every route except bootstrap / alerts / DELETE devices needs the `mobile_staff_app` entitlement (MobileGuard). */
@ApiTags("mobile")
@ApiBearerAuth()
@Controller("mobile")
export class MobileController {
  constructor(@Inject(MobileService) private readonly svc: MobileService, @Inject(MobileUpgradeService) private readonly upgrade: MobileUpgradeService) {}

  @Get("bootstrap") bootstrap(@CurrentUser() u: AuthUser, @Req() req: AuthedRequest) { return this.svc.bootstrap(u, req); }

  /** Exempt from FEATURE_DISABLED (a Basic org must be able to ask). Idempotent: a repeat for the same feature within 24h returns the original. */
  @Post("upgrade-request") @ZBody(UpgradeRequest) upgradeRequest(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof UpgradeRequest>) { return this.upgrade.request(u, b); }

  @Post("devices") @ZBody(Device) async register(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Device>) { return this.svc.registerDevice(u, b); }
  @Get("devices") devices(@CurrentUser() u: AuthUser) { return this.svc.listDevices(u); }
  @Delete("devices/:id") revoke(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.revokeDevice(u, id); }
  @Put("devices/:id/push-token") @ZBody(PushToken) pushToken(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof PushToken>) { return this.svc.setPushToken(u, id, b); }

  @Get("inbox") inbox(@CurrentUser() u: AuthUser, @Query() q: { limit?: string; cursor?: string }) { return this.svc.inbox(u, q); }
  @Post("inbox/read-all") readAll(@CurrentUser() u: AuthUser) { return this.svc.markAllRead(u); }
  @Post("inbox/:id/read") read(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.markRead(u, id); }
  @Post("push/test") pushTest(@CurrentUser() u: AuthUser) { return this.svc.pushTest(u); }

  @Get("summary") summary(@CurrentUser() u: AuthUser) { return this.svc.summary(u); }
  @Get("worklist/progress") @Perm("results.read") progress(@CurrentUser() u: AuthUser) { return this.svc.worklistProgress(u); }
  @Get("scan") @Perm("specimens.read") scan(@CurrentUser() u: AuthUser, @Query("code") code: string) { return this.svc.scan(u, code ?? ""); }
  @Get("search") search(@CurrentUser() u: AuthUser, @Query("q") q: string) { return this.svc.search(u, q ?? ""); }
  @Get("reagents/low-stock") @Perm("inventory.read") reagents(@CurrentUser() u: AuthUser) { return this.svc.reagentsLowStock(u); }
}
