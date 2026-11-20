import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { QualityService } from "./quality.service";

const num = z.coerce.number();
const Lot = z.object({ manufacturer: z.string().max(80).optional(), openedAt: z.string().optional(), expiresAt: z.string().optional(), status: z.enum(["ACTIVE", "RETIRED"]).optional() }).strict();
const Calib = z.object({ instrumentId: z.string(), analyteId: z.string().optional(), calibratorLot: z.string().min(1).max(60), calibratorExpiry: z.string().optional(), status: z.enum(["PASS", "FAIL"]), slope: num.optional(), intercept: num.optional(), nextDueDays: z.number().int().min(1).max(3650).optional(), note: z.string().max(500).optional() }).strict();
const Eqa = z.object({ scheme: z.string().min(2).max(60), cycle: z.string().min(1).max(30), sampleCode: z.string().min(1).max(30), analyteId: z.string(), instrumentId: z.string().optional(), reportedValue: num, assignedValue: num, groupSd: num.positive(), note: z.string().max(300).optional() }).strict();
const Sched = z.object({ instrumentId: z.string(), task: z.string().min(3).max(160), frequencyDays: z.number().int().min(1).max(3650), firstDueAt: z.string().optional() }).strict();
const MLog = z.object({ instrumentId: z.string(), scheduleId: z.string().optional(), kind: z.enum(["PREVENTIVE", "CORRECTIVE", "CLEANING", "CALIBRATION", "PARTS"]), notes: z.string().max(1000).optional(), downtimeMinutes: z.number().int().min(0).max(100000).optional(), partsReplaced: z.string().max(300).optional() }).strict();
const Ncr = z.object({ title: z.string().min(3).max(160), description: z.string().min(3).max(2000), area: z.enum(["PRE_ANALYTICAL", "ANALYTICAL", "POST_ANALYTICAL", "EQUIPMENT", "DOCUMENT", "PERSONNEL", "SAFETY", "OTHER"]).optional(), severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]).optional(), source: z.enum(["MANUAL", "QC", "EQA", "COMPLAINT", "AUDIT", "SPECIMEN", "INSTRUMENT"]).optional(), relatedType: z.string().max(40).optional(), relatedId: z.string().max(60).optional() }).strict();
const Advance = z.object({ to: z.enum(["INVESTIGATING", "ACTION", "VERIFIED", "CLOSED"]), rootCause: z.string().max(2000).optional(), containment: z.string().max(2000).optional() }).strict();
const Capa = z.object({ kind: z.enum(["CORRECTIVE", "PREVENTIVE"]).optional(), description: z.string().min(3).max(1000), ownerId: z.string().optional(), dueAt: z.string().optional() }).strict();
const Verify = z.object({ effectiveness: z.string().min(3).max(1000) }).strict();
const Doc = z.object({ code: z.string().min(2).max(30), title: z.string().min(3).max(160), category: z.enum(["SOP", "POLICY", "FORM", "MANUAL", "WORK_INSTRUCTION"]).optional(), section: z.string().max(60).optional(), body: z.string().min(1).max(100000) }).strict();
const Revise = z.object({ body: z.string().min(1).max(100000).optional(), changeNote: z.string().min(3).max(300) }).strict();
const Body_ = z.object({ body: z.string().min(1).max(100000) }).strict();
const Approve = z.object({ reviewMonths: z.number().int().min(1).max(60).optional() }).strict();

/** M5 (KLQM): quality management. Not flag-gated. */
@ApiTags("quality")
@ApiBearerAuth()
@Controller()
export class QualityController {
  constructor(@Inject(QualityService) private readonly q: QualityService) {}

  @Get("quality/summary") @Perm("quality.read") summary(@CurrentUser() u: AuthUser) { return this.q.summary(u); }
  @Get("qc/lots") @Perm("qc.read") lots(@CurrentUser() u: AuthUser) { return this.q.lots(u); }
  @Put("qc/lots/:id") @Perm("quality.manage") @ZBody(Lot) updateLot(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Lot>) { return this.q.updateLot(u, id, b); }
  @Get("qc/statistics") @Perm("qc.read") stats(@CurrentUser() u: AuthUser, @Query() q: { materialId: string; instrumentId?: string; limit?: string }) { return this.q.statistics(u, { ...q, limit: q.limit ? Number(q.limit) : undefined }); }

  @Get("calibrations") @Perm("quality.read") calibrations(@CurrentUser() u: AuthUser, @Query() q: { instrumentId?: string; dueBefore?: string }) { return this.q.calibrations(u, q); }
  @Post("calibrations") @Perm("quality.log") @ZBody(Calib) calibrate(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Calib>) { return this.q.calibrate(u, b); }
  @Get("eqa") @Perm("quality.read") eqa(@CurrentUser() u: AuthUser, @Query() q: { analyteId?: string; scheme?: string }) { return this.q.eqa(u, q); }
  @Post("eqa") @Perm("quality.log") @ZBody(Eqa) recordEqa(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Eqa>) { return this.q.recordEqa(u, b); }

  @Get("maintenance/schedules") @Perm("quality.read") schedules(@CurrentUser() u: AuthUser, @Query() q: { instrumentId?: string; overdue?: string }) { return this.q.schedules(u, q); }
  @Post("maintenance/schedules") @Perm("quality.manage") @ZBody(Sched) createSchedule(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Sched>) { return this.q.createSchedule(u, b); }
  @Get("maintenance/logs") @Perm("quality.read") logs(@CurrentUser() u: AuthUser, @Query("instrumentId") instrumentId?: string) { return this.q.maintenanceLogs(u, instrumentId); }
  @Post("maintenance/logs") @Perm("quality.log") @ZBody(MLog) log(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof MLog>) { return this.q.logMaintenance(u, b); }

  @Get("ncrs") @Perm("quality.read") ncrs(@CurrentUser() u: AuthUser, @Query() q: { status?: string; severity?: string }) { return this.q.ncrs(u, q); }
  @Post("ncrs") @Perm("quality.log") @ZBody(Ncr) raise(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Ncr>) { return this.q.raiseNcr(u, b); }
  @Get("ncrs/:id") @Perm("quality.read") ncr(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.q.ncr(u, id); }
  @Post("ncrs/:id/advance") @Perm("quality.manage") @ZBody(Advance) advance(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Advance>) { return this.q.advanceNcr(u, id, b); }
  @Post("ncrs/:id/actions") @Perm("quality.manage") @ZBody(Capa) addCapa(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Capa>) { return this.q.addCapa(u, id, b); }
  @Get("capa-actions") @Perm("quality.read") capa(@CurrentUser() u: AuthUser, @Query() q: { status?: string; overdue?: string }) { return this.q.capaActions(u, q); }
  @Post("capa-actions/:id/complete") @Perm("quality.log") completeCapa(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.q.completeCapa(u, id); }
  @Post("capa-actions/:id/verify") @Perm("quality.manage") @ZBody(Verify) verifyCapa(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Verify>) { return this.q.verifyCapa(u, id, b.effectiveness); }

  @Get("documents") @Perm("quality.read") docs(@CurrentUser() u: AuthUser, @Query() q: { search?: string; category?: string }) { return this.q.documents(u, q); }
  @Get("documents/pending-acks") @Perm("quality.read") pending(@CurrentUser() u: AuthUser) { return this.q.pendingAcks(u); }
  @Post("documents") @Perm("quality.manage") @ZBody(Doc) createDoc(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Doc>) { return this.q.createDocument(u, b); }
  @Get("documents/:id") @Perm("quality.read") doc(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.q.document(u, id); }
  @Post("documents/:id/revisions") @Perm("quality.manage") @ZBody(Revise) revise(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Revise>) { return this.q.reviseDocument(u, id, b); }
  @Put("documents/:id/versions/:versionId") @Perm("quality.manage") @ZBody(Body_) edit(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("versionId") vid: string, @Body() b: z.infer<typeof Body_>) { return this.q.editDraft(u, id, vid, b.body); }
  @Post("documents/:id/versions/:versionId/submit") @Perm("quality.manage") submit(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("versionId") vid: string) { return this.q.transitionVersion(u, id, vid, "IN_REVIEW"); }
  @Post("documents/:id/versions/:versionId/reject") @Perm("documents.approve") reject(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("versionId") vid: string) { return this.q.transitionVersion(u, id, vid, "DRAFT"); }
  @Post("documents/:id/versions/:versionId/approve") @Perm("documents.approve") @ZBody(Approve) approve(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("versionId") vid: string, @Body() b: z.infer<typeof Approve>) { return this.q.transitionVersion(u, id, vid, "APPROVED", b); }
  @Post("documents/:id/versions/:versionId/ack") @Perm("quality.read") ack(@CurrentUser() u: AuthUser, @Param("id") id: string, @Param("versionId") vid: string) { return this.q.acknowledge(u, id, vid); }
}
