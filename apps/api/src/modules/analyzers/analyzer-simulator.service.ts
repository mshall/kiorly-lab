import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { appConfig } from "../../config/app-config";
import { D } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { AnalyzerIngestService, type IngestOutcome } from "./analyzer-ingest.service";

/** Transport between an analyzer bridge and the LIS. mock = in-process (same ingest code path); real = TCP/MLLP listener (go-live). */
export interface AnalyzerTransport {
  send(orgId: string, instrumentId: string, raw: string): Promise<IngestOutcome>;
}

@Injectable()
export class MockAnalyzerTransport implements AnalyzerTransport {
  constructor(@Inject(AnalyzerIngestService) private readonly ingest: AnalyzerIngestService) {}
  async send(orgId: string, instrumentId: string, raw: string): Promise<IngestOutcome> {
    if (appConfig.analyzerMode() === "real") throw new ConflictException({ code: "ANALYZER_MODE_REAL_NOT_WIRED", message: "ANALYZER_MODE=real needs the TCP/MLLP bridge (Docs/NEEDS_HUMAN.md, Provider go-live)" });
    return this.ingest.ingest(orgId, instrumentId, raw);
  }
}

const ts = (d = new Date()) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
/** Deterministic pseudo-random in [0,1) from a string. */
const unit = (s: string) => parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) / 0x1_0000_0000;

/** Simulated analyzer: builds ASTM E1394 / HL7 v2 ORU messages for specimens in the lab and posts them through the transport. */
@Injectable()
export class AnalyzerSimulatorService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MockAnalyzerTransport) private readonly transport: MockAnalyzerTransport,
  ) {}

  /** Value for an analyte: inside the reference interval unless `abnormal` (then just above the high limit) or `critical`. */
  private valueFor(seed: string, low: number | null, high: number | null, mode: "normal" | "abnormal" | "critical", critHigh: number | null): number {
    const lo = low ?? 1;
    const hi = high ?? lo * 2;
    if (mode === "critical" && critHigh != null) return Math.round((critHigh * 1.05) * 100) / 100;
    if (mode === "abnormal") return Math.round(hi * 1.15 * 100) / 100;
    return Math.round((lo + (hi - lo) * (0.2 + 0.6 * unit(seed))) * 100) / 100;
  }

  async buildForSpecimen(orgId: string, instrumentId: string, specimenId: string, mode: "normal" | "abnormal" | "critical" = "normal") {
    const inst = await this.prisma.instrument.findFirst({ where: { id: instrumentId, orgId } });
    if (!inst) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    const sp = await this.prisma.specimen.findFirst({ where: { id: specimenId, orgId }, include: { order: { include: { patient: true } } } });
    if (!sp) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    const items = await this.prisma.orderItem.findMany({ where: { specimenId, status: { not: "CANCELLED" } }, include: { test: { include: { analytes: { include: { analyte: { include: { referenceIntervals: true, criticalRules: true } } } } } } } });
    const obs: { code: string; name: string; value: number; unit: string; range: string }[] = [];
    for (const it of items) {
      for (const ta of it.test.analytes) {
        const a = ta.analyte;
        if (await this.prisma.result.findFirst({ where: { orderItemId: it.id, analyteId: a.id, status: { notIn: ["CORRECTED", "REJECTED"] } } })) continue;
        const iv = a.referenceIntervals.filter((r) => !r.effectiveTo && (r.sex == null || r.sex === sp.order.patient.sex)).sort((x, y) => Number(y.sex === sp.order.patient.sex) - Number(x.sex === sp.order.patient.sex))[0];
        const rule = a.criticalRules.find((r) => r.active);
        const v = this.valueFor(`${sp.accessionNumber}:${a.code}`, iv?.low == null ? null : D(iv.low), iv?.high == null ? null : D(iv.high), mode, rule?.criticalHigh == null ? null : D(rule.criticalHigh));
        obs.push({ code: a.analyzerCodes[0] ?? a.code, name: a.nameEn, value: v, unit: a.unit ?? "", range: iv ? `${iv.low ?? ""}-${iv.high ?? ""}` : "" });
      }
    }
    if (!obs.length) throw new BadRequestException({ code: "NOTHING_TO_SIMULATE" });
    const protocol = inst.protocol ?? "ASTM_E1394";
    return { protocol, raw: protocol === "ASTM_E1394" ? this.astm(sp.barcode, sp.order.patient.externalId ?? sp.order.patientId, obs, inst.name) : this.hl7(sp.barcode, sp.order.patient.externalId ?? sp.order.patientId, obs, inst.name) };
  }

  private astm(specimenId: string, patientId: string, obs: { code: string; name: string; value: number; unit: string; range: string }[], sender: string): string {
    const lines = [`H|\\^&|||${sender}^SIM1.0|||||||P|1|${ts()}`, `P|1||${patientId}`, `O|1|${specimenId}||^^^PANEL|||||||||||||||||||F`];
    obs.forEach((o, i) => lines.push(`R|${i + 1}|^^^${o.code}^${o.name}|${o.value}|${o.unit}|${o.range}|N||F||sim|${ts()}|${ts()}`));
    lines.push("L|1|N");
    return lines.join("\r") + "\r";
  }

  private hl7(specimenId: string, patientId: string, obs: { code: string; name: string; value: number; unit: string; range: string }[], sender: string): string {
    const id = `SIM${Date.now().toString(36)}`;
    const segs = [`MSH|^~\\&|${sender}|LAB|KIORLY|LAB|${ts()}||ORU^R01|${id}|P|2.5`, `PID|1||${patientId}`, `OBR|1||${specimenId}|PANEL`];
    obs.forEach((o, i) => segs.push(`OBX|${i + 1}|NM|${o.code}^${o.name}||${o.value}|${o.unit}|${o.range}|N|||F`));
    return segs.join("\r") + "\r";
  }

  /** Simulates the instrument running a specimen: builds the message and posts it through the bridge transport. */
  async runSpecimen(orgId: string, instrumentId: string, specimenId: string, mode: "normal" | "abnormal" | "critical" = "normal") {
    const m = await this.buildForSpecimen(orgId, instrumentId, specimenId, mode);
    const outcome = await this.transport.send(orgId, instrumentId, m.raw);
    return { raw: m.raw, outcome };
  }

  /** Simulates a QC measurement at `z` SDs from the target mean. */
  async runQc(orgId: string, instrumentId: string, materialId: string, z: number) {
    const inst = await this.prisma.instrument.findFirst({ where: { id: instrumentId, orgId } });
    if (!inst) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    const mat = await this.prisma.qcMaterialLevel.findFirst({ where: { id: materialId, orgId }, include: { analyte: true } });
    if (!mat) throw new NotFoundException({ code: "QC_MATERIAL_NOT_FOUND" });
    const value = Math.round((D(mat.targetMean) + z * D(mat.targetSd)) * 1000) / 1000;
    const code = mat.analyte.analyzerCodes[0] ?? mat.analyte.code;
    const protocol = inst.protocol ?? "ASTM_E1394";
    const raw =
      protocol === "ASTM_E1394"
        ? [`H|\\^&|||${inst.name}^SIM1.0|||||||P|1|${ts()}`, `O|1|QC^${mat.level}^${mat.materialLot}||^^^${code}|||||||||Q`, `R|1|^^^${code}|${value}|${mat.analyte.unit ?? ""}|||||F||sim|${ts()}|${ts()}`, "L|1|N"].join("\r") + "\r"
        : [`MSH|^~\\&|${inst.name}|LAB|KIORLY|LAB|${ts()}||ORU^R01|SIMQC${Date.now().toString(36)}|P|2.5`, `OBR|1||QC^${mat.level}^${mat.materialLot}|CTRL|||||||Q`, `OBX|1|NM|${code}^${mat.analyte.nameEn}||${value}|${mat.analyte.unit ?? ""}|||||F`].join("\r") + "\r";
    return { raw, outcome: await this.transport.send(orgId, instrumentId, raw) };
  }
}
