import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { MicrobiologyService } from "./microbiology.service";

const num = z.coerce.number();
const Organism = z.object({ code: z.string().min(2).max(16), nameEn: z.string().min(2), nameAr: z.string().optional(), gram: z.enum(["POS", "NEG", "YEAST", "OTHER"]).optional() }).strict();
const Antibiotic = z.object({ code: z.string().min(2).max(16), nameEn: z.string().min(2), nameAr: z.string().optional(), antibioticClass: z.string().optional() }).strict();
const Panel = z.object({ name: z.string().min(2).max(80), organismGroup: z.string().min(2).max(80), antibioticCodes: z.array(z.string()).min(1).max(40) }).strict();
const Open = z.object({ orderItemId: z.string(), site: z.string().max(80).optional(), gramStain: z.string().max(300).optional(), cultureMedia: z.array(z.string().max(40)).max(8).optional() }).strict();
const Update = z.object({ site: z.string().max(80).optional(), gramStain: z.string().max(300).optional(), cultureMedia: z.array(z.string().max(40)).max(8).optional(), status: z.enum(["INCUBATING", "PRELIMINARY"]).optional(), growth: z.boolean().optional(), comment: z.string().max(500).optional() }).strict();
const Isolate = z.object({ organismId: z.string(), quantity: z.string().max(60).optional(), note: z.string().max(300).optional() }).strict();
const Susc = z.object({ rows: z.array(z.object({ antibioticId: z.string(), method: z.enum(["DISK", "MIC", "ETEST"]).optional(), micMgL: num.positive().optional(), zoneMm: z.number().int().min(0).max(80).optional(), interpretation: z.enum(["S", "I", "R", "SDD", "NS"]), reported: z.boolean().optional() }).strict()).min(1).max(40) }).strict();
const Finalize = z.object({ instrumentId: z.string(), comment: z.string().max(500).optional() }).strict();

/** M4 microbiology (culture & sensitivity). Results still pass QC cover + tech/medical validation (safety path in analysis-qc). */
@ApiTags("microbiology")
@ApiBearerAuth()
@Controller("microbiology")
export class MicrobiologyController {
  constructor(@Inject(MicrobiologyService) private readonly svc: MicrobiologyService) {}

  @Get("organisms") @Perm("results.read") organisms(@CurrentUser() u: AuthUser) { return this.svc.organisms(u.orgId); }
  @Post("organisms") @Perm("catalogue.write") @ZBody(Organism) createOrganism(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Organism>) { return this.svc.createOrganism(u, b); }
  @Get("antibiotics") @Perm("results.read") antibiotics(@CurrentUser() u: AuthUser) { return this.svc.antibiotics(u.orgId); }
  @Post("antibiotics") @Perm("catalogue.write") @ZBody(Antibiotic) createAntibiotic(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Antibiotic>) { return this.svc.createAntibiotic(u, b); }
  @Get("panels") @Perm("results.read") panels(@CurrentUser() u: AuthUser) { return this.svc.panels(u.orgId); }
  @Post("panels") @Perm("catalogue.write") @ZBody(Panel) createPanel(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Panel>) { return this.svc.createPanel(u, b); }
  @Post("catalogue/starter") @Perm("catalogue.write") starter(@CurrentUser() u: AuthUser) { return this.svc.loadStarter(u.orgId); }

  @Get("cases") @Perm("results.read") list(@CurrentUser() u: AuthUser, @Query() q: { status?: string }) { return this.svc.list(u, q); }
  @Post("cases") @Perm("micro.enter") @ZBody(Open) open(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Open>) { return this.svc.open(u, b); }
  @Get("cases/:id") @Perm("results.read") get(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.get(u.orgId, id); }
  @Put("cases/:id") @Perm("micro.enter") @ZBody(Update) update(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Update>) { return this.svc.update(u, id, b); }
  @Post("cases/:id/isolates") @Perm("micro.enter") @ZBody(Isolate) isolate(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Isolate>) { return this.svc.addIsolate(u, id, b); }
  @Delete("cases/:id/isolates/:isolateId") @Perm("micro.enter") removeIsolate(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("isolateId") isolateId: string) { return this.svc.removeIsolate(u, id, isolateId); }
  @Put("cases/:id/isolates/:isolateId/susceptibilities") @Perm("micro.enter") @ZBody(Susc) susc(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("isolateId") isolateId: string, @Body() b: z.infer<typeof Susc>) { return this.svc.setSusceptibilities(u, id, isolateId, b.rows); }
  @Post("cases/:id/finalize") @Perm("micro.enter") @ZBody(Finalize) finalize(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Finalize>) { return this.svc.finalize(u, id, b); }
}
