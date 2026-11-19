import { Body, Controller, Get, Inject, Param, Post, Put, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { ZBody, z } from "../../common/zod";
import { QcService } from "./qc.service";
import { ResultsService } from "./results.service";

const num = z.coerce.number();
const Instrument = z.object({ labId: z.string().optional(), name: z.string().min(1), kind: z.enum(["ANALYZER", "MANUAL_BENCH"]), model: z.string().optional(), protocol: z.enum(["ASTM_E1394", "HL7_V2"]).optional(), interfaceRef: z.string().optional(), simulated: z.boolean().optional() }).strict();
const Active = z.object({ active: z.boolean() }).strict();
const Material = z.object({ analyteId: z.string(), level: z.enum(["LEVEL_1", "LEVEL_2", "LEVEL_3"]), materialLot: z.string().min(1), targetMean: num, targetSd: num.positive(), expiresAt: z.string().optional() }).strict();
const Run = z.object({ instrumentId: z.string(), materialId: z.string(), value: num }).strict();
const Clear = z.object({ clearedByRunId: z.string(), note: z.string().min(10).max(1000) }).strict();
const Enter = z.object({ orderItemId: z.string(), analyteId: z.string(), instrumentId: z.string(), value: num.optional(), valueText: z.string().max(500).optional(), unit: z.string().optional() }).strict();
const Second = z.object({ value: num.optional(), valueText: z.string().max(500).optional() }).strict();
const Tech = z.object({ deltaAcknowledged: z.boolean().optional(), note: z.string().max(500).optional() }).strict();
const Correct = z.object({ value: num.optional(), valueText: z.string().max(500).optional(), reason: z.string().min(5).max(500) }).strict();
const Avr = z.object({ enabled: z.boolean(), maxDeltaPercent: num.nullable().optional(), requireNormal: z.boolean().optional() }).strict();

/** KLQC. SAFETY PATH (ADR-025): nothing here is flag-gated. */
@ApiTags("analysis-qc")
@ApiBearerAuth()
@Controller()
export class AnalysisQcController {
  constructor(
    @Inject(QcService) private readonly qc: QcService,
    @Inject(ResultsService) private readonly results: ResultsService,
  ) {}

  @Get("instruments") @Perm("qc.read") instruments(@CurrentUser() u: AuthUser) { return this.qc.listInstruments(u.orgId); }
  @Post("instruments") @Perm("instruments.manage") @ZBody(Instrument) createInstrument(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Instrument>) { return this.qc.createInstrument(u, b); }
  @Put("instruments/:id/active") @Perm("instruments.manage") @ZBody(Active) setActive(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Active>) { return this.qc.setInstrumentActive(u, id, b.active); }
  @Post("instruments/:id/api-key") @Perm("instruments.manage") apiKey(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.qc.issueApiKey(u, id); }

  @Get("qc/materials") @Perm("qc.read") materials(@CurrentUser() u: AuthUser, @Query("analyteId") analyteId?: string) { return this.qc.listMaterials(u.orgId, analyteId); }
  @Post("qc/materials") @Perm("instruments.manage") @ZBody(Material) createMaterial(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Material>) { return this.qc.createMaterial(u, b); }
  @Post("qc/runs") @Perm("qc.run") @ZBody(Run) run(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Run>) { return this.qc.submitRun(u, b); }
  @Get("qc/runs") @Perm("qc.read") runs(@CurrentUser() u: AuthUser, @Query() q: { instrumentId?: string; materialId?: string; limit?: string }) { return this.qc.listRuns(u.orgId, { ...q, limit: q.limit ? Number(q.limit) : undefined }); }
  @Get("qc/levey-jennings") @Perm("qc.read") lj(@CurrentUser() u: AuthUser, @Query() q: { instrumentId: string; materialId: string; limit?: string }) { return this.qc.leveyJennings(u.orgId, q.instrumentId, q.materialId, q.limit ? Number(q.limit) : 60); }
  @Get("qc/blocks") @Perm("qc.read") blocks(@CurrentUser() u: AuthUser, @Query("status") status?: "OPEN" | "CLEARED") { return this.qc.listBlocks(u.orgId, status); }
  @Post("qc/blocks/:id/clear") @Perm("qc.clear_block") @ZBody(Clear) clear(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Clear>) { return this.qc.clearBlock(u, id, b); }

  @Get("worklist") @Perm("results.read") worklist(@CurrentUser() u: AuthUser, @Query("status") status?: "PROCESSING" | "RECEIVED") { return this.results.worklist(u.orgId, u.labIds, status ?? "PROCESSING"); }
  @Get("validation-queue") @Perm("results.read") queue(@CurrentUser() u: AuthUser, @Query("stage") stage: "tech" | "medical" = "tech") { return this.results.validationQueue(u.orgId, stage === "medical" ? "medical" : "tech"); }
  @Get("orders/:orderId/results") @Perm("results.read") forOrder(@CurrentUser() u: AuthUser, @Param("orderId") orderId: string) { return this.results.forOrder(u.orgId, orderId); }
  @Post("results") @Perm("results.enter") @ZBody(Enter) enter(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Enter>) { return this.results.enterManual(u, b); }
  @Post("results/:id/second-entry") @Perm("results.second_entry") @ZBody(Second) second(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Second>) { return this.results.secondEntry(u, id, b); }
  @Post("results/:id/tech-validate") @Perm("results.tech_validate") @ZBody(Tech) tech(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Tech>) { return this.results.techValidate(u, id, b); }
  @Post("results/:id/medical-validate") @Perm("results.medical_validate") medical(@CurrentUser() u: AuthUser, @Param("id") id: string) { return this.results.medicalValidate(u, id); }
  @Post("orders/:orderId/medical-validate") @Perm("results.medical_validate") medicalOrder(@CurrentUser() u: AuthUser, @Param("orderId") orderId: string) { return this.results.medicalValidateOrder(u, orderId); }
  @Post("results/:id/correct") @Perm("results.correct") @ZBody(Correct) correct(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Correct>) { return this.results.correct(u, id, b); }

  @Get("auto-verification") @Perm("qc.read") avr(@CurrentUser() u: AuthUser) { return this.results.listAutoVerification(u.orgId); }
  @Put("analytes/:id/auto-verification") @Perm("instruments.manage") @ZBody(Avr) setAvr(@CurrentUser() u: AuthUser, @Param("id") id: string, @Body() b: z.infer<typeof Avr>) { return this.results.setAutoVerification(u, id, b); }
}
