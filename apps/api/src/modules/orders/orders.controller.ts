import { Body, Controller, Get, Headers, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { RequiresFlag } from "../../feature-flags/requires-flag.guard";
import { RequiresEntitlement } from "../../kernel-adapter/entitlement.guard";
import { ZBody, z } from "../../common/zod";
import { HomeCollectionService } from "./home-collection.service";
import { OrdersService } from "./orders.service";
import { PatientsService } from "./patients.service";

const Channels = z.array(z.enum(["PRINTED", "PATIENT_LINK_OTP", "KIORLY_CLINIC_IMPORT", "KIOREX_VAULT"]));
const PatientBody = z.object({
  fullName: z.string().min(2).max(160), dateOfBirth: z.string().optional(), sex: z.enum(["M", "F", "OTHER", "UNKNOWN"]).optional(), phone: z.string().min(6).max(24).optional(),
  nationalId: z.string().min(5).max(32).optional(), externalId: z.string().optional(), preferredLocale: z.enum(["ar", "en"]).optional(),
}).strict();
const HomeBody = z.object({ slotId: z.string().optional(), address: z.string().min(5), contactPhone: z.string().optional(), geo: z.object({ lat: z.number(), lng: z.number() }).optional() }).strict();
export const OrderBody = z.object({
  labId: z.string().optional(), patientId: z.string().optional(), patient: PatientBody.optional(),
  testCodes: z.array(z.string()).optional(), packageCodes: z.array(z.string()).optional(),
  source: z.enum(["WALK_IN", "REFERRING_DOCTOR"]).optional(), referringDoctorName: z.string().optional(), referringDoctorRef: z.string().optional(), referringDoctorPhone: z.string().optional(),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).optional(), collectionType: z.enum(["IN_LAB", "HOME"]).optional(), b2bAccountId: z.string().optional(),
  identifiersChecked: z.array(z.string()).optional(), consentChannels: Channels.optional(), homeCollection: HomeBody.optional(),
}).strict();
const Identity = z.object({ identifiersChecked: z.array(z.string()).min(2) }).strict();
const Consent = z.object({ channels: Channels }).strict();
const Cancel = z.object({ reason: z.string().max(300).optional() }).strict();
const Assign = z.object({ phlebotomistId: z.string(), routeSequence: z.number().int().min(1).optional() }).strict();
const Route = z.object({ date: z.string(), phlebotomistId: z.string(), start: z.object({ lat: z.number(), lng: z.number() }).optional() }).strict();
const Confirm = z.object({ scannedBarcodes: z.array(z.string()).min(1), identifiersChecked: z.array(z.string()).optional(), labelPhotoKey: z.string().optional(), temperatureC: z.number().optional() }).strict();
const Fail = z.object({ reason: z.string().min(2).max(300) }).strict();
const Photo = z.object({ imageBase64: z.string().min(10), contentType: z.enum(["image/jpeg", "image/png"]) }).strict();

@ApiTags("orders")
@ApiBearerAuth()
@Controller()
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PatientsService) private readonly patients: PatientsService,
    @Inject(HomeCollectionService) private readonly home: HomeCollectionService,
  ) {}

  @Get("patients") @Perm("patients.read") listPatients(@CurrentUser() u: AuthUser, @Query() q: { search?: string; limit?: string; offset?: string }) { return this.patients.list(u, q); }
  @Post("patients") @Perm("patients.write") @RequiresFlag("lab.module") @ZBody(PatientBody) createPatient(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof PatientBody>) { return this.patients.create(u, b); }
  @Get("patients/:id") @Perm("patients.read") getPatient(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.patients.get(u, id); }

  @Get("orders") @Perm("orders.read") @ApiOperation({ summary: "Orders worklist" }) list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.orders.list(u, q); }
  @Post("orders") @Perm("orders.create") @RequiresFlag("lab.module") @ApiOperation({ summary: "KLORD02 create an order (walk-in / referring doctor; home collection needs lab.home_collection)" })
  @ZBody(OrderBody) async create(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof OrderBody>) { return (await this.orders.create(u, b)).order; }
  @Get("orders/:id") @Perm("orders.read") get(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.orders.get(u.orgId, id); }
  @Post("orders/:id/verify-identity") @Perm("orders.create") @ZBody(Identity) verify(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Identity>) { return this.orders.verifyIdentity(u, id, b.identifiersChecked); }
  @Put("orders/:id/consent") @Perm("orders.create") @ZBody(Consent) consent(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Consent>) { return this.orders.setConsent(u, id, b.channels); }
  @Post("orders/:id/cancel") @Perm("orders.cancel") @ZBody(Cancel) cancel(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Cancel>) { return this.orders.cancel(u, id, b.reason); }

  // ---- home collection (flag lab.home_collection + PRO plan)
  @Get("home-collection/slots") @Perm("orders.read") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") slots(@CurrentUser() u: AuthUser, @Query() q: { date: string; labId?: string }) { return this.home.slots(u, q.date, q.labId); }
  @Get("home-collections") @Perm("collection.manage") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") listHome(@CurrentUser() u: AuthUser, @Query() q: { date?: string; status?: string; phlebotomistId?: string }) { return this.home.list(u, q); }
  @Get("home-collections/my-route") @Perm("collection.perform") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") myRoute(@CurrentUser() u: AuthUser, @Query() q: { date: string }) { return this.home.myRoute(u, q.date); }
  @Post("home-collections/route/optimise") @Perm("collection.manage") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") @ZBody(Route) route(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Route>) { return this.home.optimiseRoute(u, b.date, b.phlebotomistId, b.start); }
  @Post("home-collections/:id/assign") @Perm("collection.manage") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") @ZBody(Assign) assign(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Assign>) { return this.home.assign(u, id, b.phlebotomistId, b.routeSequence); }
  @Post("home-collections/:id/start") @Perm("collection.perform") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") start(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.home.start(u, id); }
  @Post("home-collections/:id/fail") @Perm("collection.perform") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") @ZBody(Fail) fail(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Fail>) { return this.home.fail(u, id, b.reason); }
  @Post("home-collections/:id/label-photo") @Perm("collection.perform") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") @ZBody(Photo) photo(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Photo>) { return this.home.uploadLabelPhoto(u, id, b.imageBase64, b.contentType); }
  @Post("home-collections/:id/confirm") @Perm("collection.perform") @RequiresFlag("lab.home_collection") @RequiresEntitlement("home_collection") @ZBody(Confirm)
  confirm(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Confirm>, @Headers("idempotency-key") key?: string) { return this.home.confirm(u, id, b, key); }
}
