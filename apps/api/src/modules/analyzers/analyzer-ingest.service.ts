import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { AnalyzerMessageStatus, QcLevel } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { PrismaService } from "../../prisma/prisma.service";
import { QcService } from "../analysis-qc/qc.service";
import { ResultsService } from "../analysis-qc/results.service";
import { ParseError, buildHl7Ack, parseAnalyzerMessage, type ParsedMessage } from "./parsers";

export interface IngestOutcome {
  messageId: string;
  status: AnalyzerMessageStatus;
  accepted: number;
  duplicates: number;
  errors: { specimen?: string; test?: string; code: string }[];
  qcRuns: { runId: string; status: string; blockId: string | null }[];
  ack: string;
}

@Injectable()
export class AnalyzerIngestService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ResultsService) private readonly results: ResultsService,
    @Inject(QcService) private readonly qc: QcService,
  ) {}

  /** Bridge authentication: instrument id + API key (hash compared in constant time). Returns the instrument. */
  async authenticateInstrument(instrumentId: string, apiKey: string | undefined) {
    const inst = await this.prisma.instrument.findUnique({ where: { id: instrumentId } });
    if (!inst || !inst.active || !inst.apiKeyHash || !apiKey) throw new UnauthorizedException({ code: "INSTRUMENT_AUTH_FAILED" });
    const got = Buffer.from(createHash("sha256").update(apiKey).digest("hex"));
    const want = Buffer.from(inst.apiKeyHash);
    if (got.length !== want.length || !timingSafeEqual(got, want)) throw new UnauthorizedException({ code: "INSTRUMENT_AUTH_FAILED" });
    return inst;
  }

  /** Parses a raw analyzer message, stores it, posts results (or QC runs) and returns an ACK-able outcome. Same path for the simulator and real bridges. */
  async ingest(orgId: string, instrumentId: string, raw: string, protocolOverride?: "ASTM_E1394" | "HL7_V2"): Promise<IngestOutcome> {
    const inst = await this.prisma.instrument.findFirst({ where: { id: instrumentId, orgId, active: true } });
    if (!inst) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    const protocol = protocolOverride ?? inst.protocol;
    if (!protocol) throw new ConflictException({ code: "INSTRUMENT_PROTOCOL_NOT_SET" });
    const outcome: IngestOutcome = { messageId: "", status: "PARSED", accepted: 0, duplicates: 0, errors: [], qcRuns: [], ack: "" };
    let parsed: ParsedMessage | null = null;
    let parseError: string | null = null;
    try {
      parsed = parseAnalyzerMessage(protocol, raw);
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      parseError = e.message;
    }
    const row = await this.prisma.analyzerMessage.create({ data: { orgId, instrumentId, protocol, raw, status: parseError ? "FAILED" : "PARSED", error: parseError } });
    outcome.messageId = row.id;
    if (!parsed) {
      outcome.status = "FAILED";
      outcome.errors.push({ code: "PARSE_ERROR" });
      outcome.ack = protocol === "HL7_V2" ? buildHl7Ack(raw, false, "parse error") : "\x15";
      return outcome;
    }
    const analytes = await this.prisma.analyte.findMany({ where: { orgId } });
    const byCode = (c: string) => analytes.find((a) => a.code.toUpperCase() === c.toUpperCase() || a.analyzerCodes.some((x) => x.toUpperCase() === c.toUpperCase()));

    for (const g of parsed.groups) {
      if (g.isQc) {
        for (const o of g.observations) {
          const a = byCode(o.testCode);
          if (!a || o.value === undefined) {
            outcome.errors.push({ test: o.testCode, code: a ? "QC_VALUE_NOT_NUMERIC" : "UNKNOWN_ANALYTE" });
            continue;
          }
          const mat = await this.prisma.qcMaterialLevel.findFirst({ where: { orgId, analyteId: a.id, ...(g.qc?.level ? { level: g.qc.level as QcLevel } : {}), ...(g.qc?.lot ? { materialLot: g.qc.lot } : {}) }, orderBy: { level: "asc" } });
          if (!mat) {
            outcome.errors.push({ test: o.testCode, code: "UNKNOWN_QC_MATERIAL" });
            continue;
          }
          try {
            const r = await this.qc.submitRun({ orgId, staffId: `instrument:${instrumentId}` }, { instrumentId, materialId: mat.id, value: o.value }); // evaluated in receipt order (analyzer clocks have 1 s resolution)
            outcome.qcRuns.push({ runId: r.run.id, status: r.run.status, blockId: r.blockId });
            outcome.accepted++;
          } catch (e) {
            outcome.errors.push({ test: o.testCode, code: errCode(e) });
          }
        }
        continue;
      }
      const sp = g.specimenId ? await this.prisma.specimen.findFirst({ where: { orgId, barcode: g.specimenId } }) : null;
      if (!sp) {
        outcome.errors.push({ specimen: g.specimenId || "(none)", code: "UNKNOWN_SPECIMEN" });
        continue;
      }
      for (const o of g.observations) {
        const a = byCode(o.testCode);
        if (!a) {
          outcome.errors.push({ specimen: sp.accessionNumber, test: o.testCode, code: "UNKNOWN_ANALYTE" });
          continue;
        }
        try {
          await this.results.enterFromAnalyzer(orgId, instrumentId, { specimenId: sp.id, analyteId: a.id, value: o.value, valueText: o.valueText, unit: o.unit, protocol, messageId: row.id });
          outcome.accepted++;
        } catch (e) {
          const code = errCode(e);
          if (code === "RESULT_EXISTS") outcome.duplicates++;
          else outcome.errors.push({ specimen: sp.accessionNumber, test: o.testCode, code });
        }
      }
    }
    outcome.status = outcome.errors.length === 0 ? "PARSED" : outcome.accepted > 0 || outcome.duplicates > 0 ? "PARTIAL" : "FAILED";
    await this.prisma.analyzerMessage.update({ where: { id: row.id }, data: { status: outcome.status, resultCount: outcome.accepted, error: outcome.errors.length ? JSON.stringify(outcome.errors.slice(0, 20)) : null } });
    await this.audit.record({ orgId, actorId: `instrument:${instrumentId}`, action: "analyzer.message", entityType: "AnalyzerMessage", entityId: row.id, meta: { status: outcome.status, accepted: outcome.accepted, errors: outcome.errors.length } });
    outcome.ack = protocol === "HL7_V2" ? buildHl7Ack(raw, outcome.status !== "FAILED") : outcome.status === "FAILED" ? "\x15" : "\x06";
    return outcome;
  }

  listMessages(orgId: string, instrumentId?: string) {
    return this.prisma.analyzerMessage.findMany({ where: { orgId, ...(instrumentId ? { instrumentId } : {}) }, select: { id: true, instrumentId: true, protocol: true, status: true, resultCount: true, error: true, receivedAt: true }, orderBy: { receivedAt: "desc" }, take: 100 });
  }

  /** For tests/diagnostics. */
  assertOrg(orgId: string, other: string) {
    if (orgId !== other) throw new ForbiddenException();
  }
}

function errCode(e: unknown): string {
  const r = (e as { response?: { code?: string } }).response;
  return r?.code ?? (e as Error).message ?? "ERROR";
}

