import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { SetupService } from "./setup.service";

const Skip = z.object({ action: z.enum(["skip", "complete"]), entityId: z.string().max(64).optional() }).strict();

/** Quick-setup checklist (computed from real data; every authenticated staff member can read it, the role decides what they can do). */
@ApiTags("setup")
@ApiBearerAuth()
@Controller("setup")
export class SetupController {
  constructor(@Inject(SetupService) private readonly svc: SetupService) {}
  @Get() get(@CurrentUser() u: AuthUser) { return this.svc.get(u); }
  @Patch("steps/:key") @ZBody(Skip) step(@CurrentUser() u: AuthUser, @Param("key") key: string, @Body() b: z.infer<typeof Skip>) {
    if (b.action === "complete") throw new BadRequestException({ code: "AUTO_STEP", message: "This step completes automatically when the work is done; it cannot be ticked by hand" });
    return this.svc.skip(u, key, b.entityId);
  }
  @Post("dismiss") dismiss(@CurrentUser() u: AuthUser) { return this.svc.dismiss(u); }
}
