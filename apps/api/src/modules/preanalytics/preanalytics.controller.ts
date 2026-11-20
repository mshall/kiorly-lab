import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm, Public } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { ManifestsService } from "./manifests.service";
import { RecollectionsService } from "./recollections.service";
import { StorageService } from "./storage.service";

const num = z.coerce.number();
const Unit = z.object({ labId: z.string().optional(), name: z.string().min(1).max(60), kind: z.enum(["FRIDGE", "FREEZER_MINUS20", "FREEZER_MINUS80", "ROOM_TEMP", "RACK"]).optional(), rows: z.number().int().min(1).max(26).optional(), cols: z.number().int().min(1).max(99).optional(), tempMinC: num.optional(), tempMaxC: num.optional() }).strict();
const Assign = z.object({ unitId: z.string(), slot: z.string().max(5).optional(), scannedBarcode: z.string().optional() }).strict();
const Rule = z.object({ specimenType: z.string().min(1).max(60), retentionDays: z.number().int().min(1).max(3650) }).strict();
const Dispose = z.object({ specimenIds: z.array(z.string()).min(1).max(200), force: z.boolean().optional() }).strict();
const Courier = z.object({ name: z.string().min(2).max(80), phone: z.string().max(24).optional(), company: z.string().max(80).optional() }).strict();
const Manifest = z.object({ kind: z.enum(["INTER_BRANCH", "SEND_OUT"]), fromLabId: z.string().optional(), toLabId: z.string().optional(), destinationName: z.string().max(120).optional(), specimenIds: z.array(z.string()).min(1).max(200), courierId: z.string().optional(), courierName: z.string().max(80).optional(), courierPhone: z.string().max(24).optional(), temperatureC: num.optional(), note: z.string().max(300).optional() }).strict();
const Dispatch = z.object({ courierName: z.string().max(80).optional(), courierPhone: z.string().max(24).optional(), temperatureC: num.optional() }).strict();
const Event = z.object({ status: z.enum(["PICKED_UP", "IN_TRANSIT", "DELAYED", "DELIVERED", "NOTE"]), location: z.string().max(120).optional(), note: z.string().max(300).optional(), temperatureC: num.optional() }).strict();
const Receive = z.object({ barcodes: z.array(z.string()).max(500), temperatureC: num.optional(), note: z.string().max(300).optional() }).strict();

/** M3 (KLSPC): storage + retention, recollections, transport manifests with courier tracking. Safety path: never flag-gated. */
@ApiTags("preanalytics")
@Controller()
export class PreanalyticsController {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ManifestsService) private readonly manifests: ManifestsService,
    @Inject(RecollectionsService) private readonly recollect: RecollectionsService,
  ) {}

  @ApiBearerAuth() @Get("storage/units") @Perm("specimens.read") units(@CurrentUser() u: AuthUser) { return this.storage.units(u); }
  @ApiBearerAuth() @Post("storage/units") @Perm("storage.manage") @ZBody(Unit) createUnit(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Unit>) { return this.storage.createUnit(u, b); }
  @ApiBearerAuth() @Get("storage/units/:id") @Perm("specimens.read") contents(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.storage.unitContents(u, id); }
  @ApiBearerAuth() @Get("storage/locate") @Perm("specimens.read") locate(@CurrentUser() u: AuthUser, @Query() q: { specimenId?: string; barcode?: string }) { return this.storage.locate(u, q); }
  @ApiBearerAuth() @Post("specimens/:id/storage") @Perm("storage.manage") @ZBody(Assign) assign(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Assign>) { return this.storage.assign(u, id, b); }
  @ApiBearerAuth() @Post("specimens/:id/retrieve") @Perm("specimens.process") retrieve(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.storage.retrieve(u, id); }
  @ApiBearerAuth() @Get("retention-rules") @Perm("specimens.read") rules(@CurrentUser() u: AuthUser) { return this.storage.rules(u); }
  @ApiBearerAuth() @Put("retention-rules") @Perm("storage.manage") @ZBody(Rule) setRule(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Rule>) { return this.storage.setRule(u, b.specimenType, b.retentionDays); }
  @ApiBearerAuth() @Get("storage/disposal-due") @Perm("specimens.read") due(@CurrentUser() u: AuthUser, @Query("asOf") asOf?: string) { return this.storage.disposalDue(u, asOf); }
  @ApiBearerAuth() @Post("storage/dispose") @Perm("specimens.process") @ZBody(Dispose) dispose(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Dispose>) { return this.storage.disposeBulk(u, b.specimenIds, b.force); }

  @ApiBearerAuth() @Get("recollections") @Perm("specimens.read") recollections(@CurrentUser() u: AuthUser, @Query("status") status?: string) { return this.recollect.list(u, { status }); }
  @ApiBearerAuth() @Post("recollections/:id/notify") @Perm("specimens.reject") notify(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.recollect.notify(u, id); }
  @ApiBearerAuth() @Post("recollections/:id/cancel") @Perm("specimens.reject") cancelRecollection(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.recollect.cancel(u, id); }

  @ApiBearerAuth() @Get("couriers") @Perm("specimens.read") couriers(@CurrentUser() u: AuthUser) { return this.manifests.couriers(u); }
  @ApiBearerAuth() @Post("couriers") @Perm("manifests.manage") @ZBody(Courier) createCourier(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Courier>) { return this.manifests.createCourier(u, b); }
  @ApiBearerAuth() @Get("manifests") @Perm("specimens.read") list(@CurrentUser() u: AuthUser, @Query() q: { status?: string; kind?: string }) { return this.manifests.list(u, q); }
  @ApiBearerAuth() @Post("manifests") @Perm("manifests.manage") @ZBody(Manifest) create(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Manifest>) { return this.manifests.create(u, b); }
  @ApiBearerAuth() @Get("manifests/:id") @Perm("specimens.read") get(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.manifests.get(u, id); }
  @ApiBearerAuth() @Post("manifests/:id/dispatch") @Perm("manifests.manage") @ZBody(Dispatch) dispatch(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Dispatch>) { return this.manifests.dispatch(u, id, b); }
  @ApiBearerAuth() @Post("manifests/:id/events") @Perm("manifests.manage") @ZBody(Event) event(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Event>) { return this.manifests.addEvent(u, id, b); }
  @ApiBearerAuth() @Post("manifests/:id/receive") @Perm("specimens.receive") @ZBody(Receive) receive(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Receive>) { return this.manifests.receive(u, id, b); }
  @ApiBearerAuth() @Post("manifests/:id/cancel") @Perm("manifests.manage") cancel(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.manifests.cancel(u, id); }
  @Public() @Get("public/track/:ref") track(@Param("ref") ref: string) { return this.manifests.track(ref); }
}
