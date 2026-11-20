import { Body, Controller, Get, Header, Inject, Param, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { SpecimensService } from "./specimens.service";

const Transit = z.object({ scannedBarcode: z.string().optional(), temperatureC: z.number().min(-90).max(60).optional(), location: z.string().max(120).optional(), note: z.string().max(500).optional() }).strict();
const Reject = z.object({ reason: z.enum(["HAEMOLYSED", "INSUFFICIENT_VOLUME", "MISLABELLED", "WRONG_CONTAINER", "CLOTTED", "OTHER"]), note: z.string().max(500).optional() }).strict();
const Aliquot = z.object({ count: z.number().int().min(1).max(20) }).strict();
const Scan = z.object({ barcode: z.string().min(1) }).strict();
const Accession = z.object({ accessionNumber: z.string().optional() }).strict();

/** Safety path (ADR-025): nothing here is flag-gated. */
@ApiTags("specimens")
@ApiBearerAuth()
@Controller()
export class SpecimensController {
  constructor(@Inject(SpecimensService) private readonly svc: SpecimensService) {}

  @Get("specimens") @Perm("specimens.read") list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.svc.list(u, q); }
  @Post("specimens/scan") @Perm("specimens.read") @ZBody(Scan) scan(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Scan>) { return this.svc.byBarcode(u.orgId, b.barcode); }
  @Get("specimens/:id") @Perm("specimens.read") get(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.get(u.orgId, id); }
  @Get("specimens/:id/custody") @Perm("specimens.read") custody(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.custodyChain(u.orgId, id); }
  @Get("specimens/:id/label") @Perm("specimens.read") label(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.label(u.orgId, id); }
  @Get("orders/:orderId/labels") @Perm("specimens.read") orderLabels(@CurrentUser() u: AuthUser, @Param("orderId") orderId: string) { return this.svc.orderLabels(u.orgId, orderId); }
  @Post("specimens/:id/label/print") @Perm("specimens.label") print(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.svc.markPrinted(u, id); }

  @Post("orders/:orderId/accession") @Perm("specimens.label") @ZBody(Accession) accession(@CurrentUser() u: AuthUser, @Param("orderId") orderId: string, @Body() b: z.infer<typeof Accession>) { return this.svc.accessionOrder(u, orderId, b.accessionNumber); }

  @Post("specimens/:id/collect") @Perm("specimens.collect") @ZBody(Transit) collect(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Transit>) { return this.svc.transition(u, id, "collect", b); }
  @Post("specimens/:id/transport") @Perm("specimens.collect") @ZBody(Transit) transport(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Transit>) { return this.svc.transition(u, id, "transport", b); }
  @Post("specimens/:id/receive") @Perm("specimens.receive") @ZBody(Transit) receive(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Transit>) { return this.svc.transition(u, id, "receive", b); }
  @Post("specimens/:id/process") @Perm("specimens.process") @ZBody(Transit) process(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Transit>) { return this.svc.transition(u, id, "process", b); }
  @Post("specimens/:id/store") @Perm("specimens.process") @ZBody(Transit) store(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Transit>) { return this.svc.transition(u, id, "store", b); }
  @Post("specimens/:id/dispose") @Perm("specimens.process") @ZBody(Transit) dispose(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Transit>) { return this.svc.transition(u, id, "dispose", b); }
  @Post("specimens/:id/aliquots") @Perm("specimens.process") @ZBody(Aliquot) aliquot(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Aliquot>) { return this.svc.aliquot(u, id, b.count); }
  @Post("specimens/:id/reject") @Perm("specimens.reject") @ZBody(Reject) reject(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Reject>) { return this.svc.reject(u, id, b.reason, b.note); }
}
