import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { HistopathologyService } from "./histopathology.service";

const Open = z.object({ orderItemId: z.string(), site: z.string().max(120).optional(), clinicalHistory: z.string().max(1000).optional() }).strict();
const Update = z.object({
  site: z.string().max(120).optional(), clinicalHistory: z.string().max(1000).optional(), grossDescription: z.string().max(4000).optional(), microscopicDescription: z.string().max(4000).optional(),
  diagnosis: z.string().max(2000).optional(), morphologyCode: z.string().max(40).optional(), synoptic: z.record(z.string().max(60), z.string().max(300)).optional(), blocks: z.number().int().min(0).max(200).optional(), slides: z.number().int().min(0).max(500).optional(),
}).strict();
const SignOut = z.object({ instrumentId: z.string() }).strict();
const Addendum = z.object({ text: z.string().min(5).max(2000) }).strict();

/** M4 histopathology / cytology basic reporting. */
@ApiTags("histopathology")
@ApiBearerAuth()
@Controller("histopathology")
export class HistopathologyController {
  constructor(@Inject(HistopathologyService) private readonly svc: HistopathologyService) {}

  @Get("cases") @Perm("results.read") list(@CurrentUser() u: AuthUser, @Query() q: { status?: string; kind?: string }) { return this.svc.list(u, q); }
  @Post("cases") @Perm("histo.report") @ZBody(Open) open(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Open>) { return this.svc.open(u, b); }
  @Get("cases/:id") @Perm("results.read") get(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.get(u.orgId, id); }
  @Put("cases/:id") @Perm("histo.report") @ZBody(Update) update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Update>) { return this.svc.update(u, id, b); }
  @Post("cases/:id/advance") @Perm("histo.report") advance(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.advance(u, id); }
  @Post("cases/:id/sign-out") @Perm("results.medical_validate") @ZBody(SignOut) signOut(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof SignOut>) { return this.svc.signOut(u, id, b); }
  @Post("cases/:id/addenda") @Perm("results.medical_validate") @ZBody(Addendum) addendum(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Addendum>) { return this.svc.addAddendum(u, id, b.text); }
}
