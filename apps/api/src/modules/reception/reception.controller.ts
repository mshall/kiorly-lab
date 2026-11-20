import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { AppointmentsService } from "./appointments.service";
import { searchIcd } from "./icd";
import { OrderEditService } from "./order-edit.service";
import { QueueService } from "./queue.service";

const Prio = z.enum(["ROUTINE", "URGENT", "STAT"]);
const Appt = z.object({ labId: z.string().optional(), patientId: z.string().optional(), patientName: z.string().min(2).max(160), phone: z.string().max(24).optional(), startsAt: z.string(), kind: z.enum(["WALK_IN", "PACKAGE", "HOME", "FOLLOW_UP"]).optional(), testCodes: z.array(z.string()).max(60).optional(), packageCode: z.string().optional(), fasting: z.boolean().optional(), note: z.string().max(300).optional() }).strict();
const CheckIn = z.object({ priority: Prio.optional() }).strict();
const ToOrder = z.object({ testCodes: z.array(z.string()).optional(), packageCodes: z.array(z.string()).optional(), identifiersChecked: z.array(z.string()).optional(), priority: Prio.optional() }).strict();
const Ticket = z.object({ labId: z.string().optional(), priority: Prio.optional(), patientName: z.string().max(160).optional(), orderId: z.string().optional() }).strict();
const Call = z.object({ labId: z.string().optional(), counter: z.string().min(1).max(20) }).strict();
const Patch = z.object({
  priority: Prio.optional(), clinicalInfo: z.string().max(1000).nullable().optional(), icdCodes: z.array(z.string().regex(/^[A-Z]\d{2}(\.\d{1,4})?$/)).max(10).optional(), fastingConfirmed: z.boolean().nullable().optional(),
  referringDoctorName: z.string().max(160).nullable().optional(), referringDoctorPhone: z.string().max(24).nullable().optional(), referrerId: z.string().nullable().optional(), b2bAccountId: z.string().nullable().optional(), reason: z.string().max(300).optional(),
}).strict();
const AddTests = z.object({ testCodes: z.array(z.string()).min(1).max(30) }).strict();
const Reason = z.object({ reason: z.string().max(300).optional() }).strict();

/** M2 (KLORD): reception desk: appointments, queue/token board, audited order edits, ICD-10 hints. Not flag-gated. */
@ApiTags("reception")
@ApiBearerAuth()
@Controller()
export class ReceptionController {
  constructor(
    @Inject(AppointmentsService) private readonly appts: AppointmentsService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(OrderEditService) private readonly edit: OrderEditService,
  ) {}

  @Get("icd/search") @Perm("orders.read") icd(@Query("q") q?: string) { return searchIcd(q ?? ""); }

  @Get("appointments/availability") @Perm("orders.read") avail(@CurrentUser() u: AuthUser, @Query() q: { date: string; labId?: string }) { return this.appts.availability(u, q.date, q.labId); }
  @Get("appointments") @Perm("orders.read") list(@CurrentUser() u: AuthUser, @Query() q: Record<string, string>) { return this.appts.list(u, q); }
  @Post("appointments") @Perm("appointments.manage") @ZBody(Appt) book(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Appt>) { return this.appts.book(u, b); }
  @Post("appointments/:id/cancel") @Perm("appointments.manage") cancel(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.appts.setStatus(u, id, "CANCELLED"); }
  @Post("appointments/:id/no-show") @Perm("appointments.manage") noShow(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.appts.setStatus(u, id, "NO_SHOW"); }
  @Post("appointments/:id/check-in") @Perm("appointments.manage") @ZBody(CheckIn) checkIn(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof CheckIn>) { return this.appts.checkIn(u, id, b.priority); }
  @Post("appointments/:id/order") @Perm("orders.create") @ZBody(ToOrder) toOrder(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof ToOrder>) { return this.appts.toOrder(u, id, b); }

  @Get("queue/board") @Perm("orders.read") board(@CurrentUser() u: AuthUser, @Query("labId") labId?: string) { return this.queue.board(u, labId); }
  @Get("queue/tickets") @Perm("orders.read") tickets(@CurrentUser() u: AuthUser, @Query("labId") labId?: string) { return this.queue.list(u, labId); }
  @Post("queue/tickets") @Perm("queue.manage") @ZBody(Ticket) issue(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Ticket>) { return this.queue.issue(u, b); }
  @Post("queue/call-next") @Perm("queue.manage") @ZBody(Call) callNext(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Call>) { return this.queue.callNext(u, b); }
  @Post("queue/tickets/:id/serve") @Perm("queue.manage") serve(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.queue.setStatus(u, id, "SERVING"); }
  @Post("queue/tickets/:id/done") @Perm("queue.manage") done(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.queue.setStatus(u, id, "DONE"); }
  @Post("queue/tickets/:id/skip") @Perm("queue.manage") skip(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.queue.setStatus(u, id, "SKIPPED"); }
  @Post("queue/tickets/:id/recall") @Perm("queue.manage") recall(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.queue.setStatus(u, id, "WAITING"); }
  @Post("queue/tickets/:id/cancel") @Perm("queue.manage") cancelTicket(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.queue.setStatus(u, id, "CANCELLED"); }

  @Put("orders/:id") @Perm("orders.edit") @ZBody(Patch) editOrder(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Patch>) { return this.edit.edit(u, id, b); }
  @Get("orders/:id/revisions") @Perm("orders.read") revisions(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.edit.revisions(u, id); }
  @Post("orders/:id/tests") @Perm("orders.edit") @ZBody(AddTests) addTests(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof AddTests>) { return this.edit.addTests(u, id, b.testCodes); }
  @Delete("orders/:id/tests/:itemId") @Perm("orders.edit") removeTest(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("itemId") itemId: string, @Query("reason") reason?: string) { return this.edit.removeTest(u, id, itemId, reason); }
}
void Reason;
