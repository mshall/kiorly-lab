import { Body, Controller, Get, Headers, Inject, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Perm, Public } from "../../auth/decorators";
import type { AuthUser } from "../../auth/auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { RequiresFlag } from "../../feature-flags/requires-flag.guard";
import { FeatureFlagsService } from "../../feature-flags/feature-flags.service";
import { assertFlagOn } from "../../feature-flags/flag-gate";
import { RequiresEntitlement } from "../../kernel-adapter/entitlement.guard";
import { KERNEL_ENTITLEMENTS, type EntitlementsPort } from "../../kernel-adapter/ports";
import { HttpException } from "@nestjs/common";
import { ZBody, z } from "../../common/zod";
import { AnalyzerIngestService } from "./analyzer-ingest.service";
import { AnalyzerSimulatorService } from "./analyzer-simulator.service";

const Ingest = z.object({ instrumentId: z.string(), protocol: z.enum(["ASTM_E1394", "HL7_V2"]).optional(), payload: z.string().min(1).max(200_000) }).strict();
const Simulate = z.object({ instrumentId: z.string(), specimenId: z.string().optional(), qc: z.object({ materialId: z.string(), z: z.number().min(-8).max(8) }).optional(), mode: z.enum(["normal", "abnormal", "critical"]).optional() }).strict();

/**
 * Analyzer bridge endpoints. Gated by flag `lab.analyzer_interfaces` (OFF => manual entry with dual control) and the PRO plan.
 * Deliberately outside the safety-path directories: these only create ENTERED results; QC, validation and release stay in analysis-qc/release.
 */
@ApiTags("analyzers")
@Controller("analyzers")
export class AnalyzersController {
  constructor(
    @Inject(AnalyzerIngestService) private readonly ingest: AnalyzerIngestService,
    @Inject(AnalyzerSimulatorService) private readonly sim: AnalyzerSimulatorService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(KERNEL_ENTITLEMENTS) private readonly ent: EntitlementsPort,
  ) {}

  /** Bridge endpoint: authenticated by instrument id + API key (not a staff login). */
  @Public()
  @Post("ingest")
  @ApiOperation({ summary: "Post an ASTM E1394 / HL7 v2 message from an instrument bridge" })
  @ZBody(Ingest)
  async post(@Body() b: z.infer<typeof Ingest>, @Headers("x-instrument-key") key?: string) {
    const inst = await this.ingest.authenticateInstrument(b.instrumentId, key);
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: inst.orgId } });
    assertFlagOn(this.flags, "lab.analyzer_interfaces", { orgId: inst.orgId, market: tenant.marketCode });
    if (!(await this.ent.has(inst.orgId, "analyzer_interfaces"))) throw new HttpException({ code: "PLAN_REQUIRED", capability: "analyzer_interfaces" }, 402);
    return this.ingest.ingest(inst.orgId, inst.id, b.payload, b.protocol);
  }

  @ApiBearerAuth()
  @Post("simulate")
  @Perm("analyzers.ingest")
  @RequiresFlag("lab.analyzer_interfaces")
  @RequiresEntitlement("analyzer_interfaces")
  @ApiOperation({ summary: "Simulated analyzer (ANALYZER_MODE=mock): runs a specimen or a QC level through the bridge" })
  @ZBody(Simulate)
  simulate(@CurrentUser() u: AuthUser, @Body() b: z.infer<typeof Simulate>) {
    if (b.qc) return this.sim.runQc(u.orgId, b.instrumentId, b.qc.materialId, b.qc.z);
    if (!b.specimenId) throw new HttpException({ code: "SPECIMEN_OR_QC_REQUIRED" }, 400);
    return this.sim.runSpecimen(u.orgId, b.instrumentId, b.specimenId, b.mode);
  }

  @ApiBearerAuth()
  @Get("messages")
  @Perm("qc.read")
  @RequiresFlag("lab.analyzer_interfaces")
  messages(@CurrentUser() u: AuthUser, @Query("instrumentId") instrumentId?: string) {
    return this.ingest.listMessages(u.orgId, instrumentId);
  }
}
