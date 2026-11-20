import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { AnalyzerProtocol, InstrumentKind, LabSection, QcLevel } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, type Db } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { resolveLabId } from "../../common/lab-scope";
import { evaluateWestgard, zScore } from "./westgard";

const SAME_RUN_MINUTES = 120;

@Injectable()
export class QcService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ----------------------------------------------------------- instruments
  listInstruments(orgId: string) {
    return this.prisma.instrument.findMany({ where: { orgId }, select: { id: true, labId: true, name: true, kind: true, model: true, protocol: true, interfaceRef: true, simulated: true, active: true }, orderBy: { name: "asc" } });
  }
  async createInstrument(u: AuthUser, b: { labId?: string; name: string; kind: InstrumentKind; model?: string; protocol?: AnalyzerProtocol; interfaceRef?: string; simulated?: boolean }) {
    const labId = await resolveLabId(this.prisma, u, b.labId);
    const i = await this.prisma.instrument.create({ data: { orgId: u.orgId, labId, name: b.name, kind: b.kind, model: b.model, protocol: b.protocol, interfaceRef: b.interfaceRef, simulated: b.simulated ?? false } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "instrument.create", entityType: "Instrument", entityId: i.id });
    return i;
  }
  async setInstrumentActive(u: AuthUser, id: string, active: boolean) {
    const i = await this.prisma.instrument.findFirst({ where: { id, orgId: u.orgId } });
    if (!i) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    await this.prisma.instrument.update({ where: { id }, data: { active } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: active ? "instrument.activate" : "instrument.deactivate", entityType: "Instrument", entityId: id });
    return { id, active };
  }
  async setInstrumentSections(u: AuthUser, id: string, sections: LabSection[]) {
    const inst = await this.prisma.instrument.findFirst({ where: { id, orgId: u.orgId } });
    if (!inst) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    const row = await this.prisma.instrument.update({ where: { id }, data: { sections } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "instrument.sections", entityType: "Instrument", entityId: id, meta: { sections } });
    return row;
  }

  /** Issues a bridge API key (shown once; only its hash is stored). */
  async issueApiKey(u: AuthUser, id: string) {
    const i = await this.prisma.instrument.findFirst({ where: { id, orgId: u.orgId } });
    if (!i) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    const key = `kli_${randomBytes(24).toString("base64url")}`;
    await this.prisma.instrument.update({ where: { id }, data: { apiKeyHash: createHash("sha256").update(key).digest("hex") } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "instrument.api_key_issued", entityType: "Instrument", entityId: id });
    return { instrumentId: id, apiKey: key };
  }

  // -------------------------------------------------------------- materials
  listMaterials(orgId: string, analyteId?: string) {
    return this.prisma.qcMaterialLevel.findMany({ where: { orgId, ...(analyteId ? { analyteId } : {}) }, include: { analyte: { select: { code: true, nameEn: true, unit: true } } }, orderBy: [{ analyteId: "asc" }, { level: "asc" }] });
  }
  async createMaterial(u: AuthUser, b: { analyteId: string; level: QcLevel; materialLot: string; targetMean: number; targetSd: number; expiresAt?: string }) {
    if (!(b.targetSd > 0)) throw new BadRequestException({ code: "QC_SD_INVALID" });
    if (!(await this.prisma.analyte.findFirst({ where: { id: b.analyteId, orgId: u.orgId } }))) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    const m = await this.prisma.qcMaterialLevel.create({ data: { orgId: u.orgId, analyteId: b.analyteId, level: b.level, materialLot: b.materialLot, targetMean: b.targetMean, targetSd: b.targetSd, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "qc_material.create", entityType: "QcMaterialLevel", entityId: m.id });
    return m;
  }

  // -------------------------------------------------------------------- runs
  /**
   * KLQC02: records a QC observation, evaluates Westgard multirules and — on a rejection — opens a QcBlock for the analyte/instrument.
   * While a block is OPEN, release of any result from that analyte/instrument is impossible (service gate + DB trigger).
   * Unreleased results entered since the last passing run are sent back for re-run (status REJECTED).
   */
  async submitRun(u: Pick<AuthUser, "orgId" | "staffId">, b: { instrumentId: string; materialId: string; value: number; runAt?: Date }) {
    return this.prisma.$transaction(async (tx) => {
      const inst = await tx.instrument.findFirst({ where: { id: b.instrumentId, orgId: u.orgId, active: true } });
      if (!inst) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
      const mat = await tx.qcMaterialLevel.findFirst({ where: { id: b.materialId, orgId: u.orgId } });
      if (!mat) throw new NotFoundException({ code: "QC_MATERIAL_NOT_FOUND" });
      if (mat.expiresAt && mat.expiresAt < new Date()) throw new ConflictException({ code: "QC_MATERIAL_EXPIRED" });
      if (mat.status === "RETIRED") throw new ConflictException({ code: "QC_MATERIAL_RETIRED" });
      const runAt = b.runAt ?? new Date();
      const z = zScore(b.value, D(mat.targetMean), D(mat.targetSd));
      const prior = await tx.qcRun.findMany({ where: { instrumentId: inst.id, materialId: mat.id }, orderBy: { runAt: "desc" }, take: 9 });
      const history = [...prior.map((r) => D(r.zScore)).reverse(), z];
      const others = await tx.qcRun.findMany({
        where: { instrumentId: inst.id, material: { analyteId: mat.analyteId, id: { not: mat.id } }, runAt: { gte: new Date(runAt.getTime() - SAME_RUN_MINUTES * 60_000), lte: runAt } },
        orderBy: { runAt: "desc" },
      });
      const latestPerMaterial = new Map<string, number>();
      for (const o of others) if (!latestPerMaterial.has(o.materialId)) latestPerMaterial.set(o.materialId, D(o.zScore));
      const ev = evaluateWestgard({ history, sameRunOthers: [...latestPerMaterial.values()] });
      const run = await tx.qcRun.create({
        data: { orgId: u.orgId, instrumentId: inst.id, materialId: mat.id, value: b.value, zScore: Math.round(z * 10000) / 10000, status: ev.status, violatedRules: ev.violated, runBy: u.staffId, runAt },
      });
      let block: { id: string } | null = null;
      let revoked = 0;
      if (ev.status === "FAIL") {
        const open = await tx.qcBlock.findFirst({ where: { orgId: u.orgId, instrumentId: inst.id, analyteId: mat.analyteId, status: "OPEN" } });
        block = open ?? (await tx.qcBlock.create({ data: { orgId: u.orgId, instrumentId: inst.id, analyteId: mat.analyteId, openedByRunId: run.id, rule: ev.violated[0] } }));
        revoked = await this.revokeSinceLastPass(tx, u, inst.id, mat.analyteId, runAt);
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "qc.block_opened", entityType: "QcBlock", entityId: block.id, meta: { rules: ev.violated, revokedResults: revoked } }, tx);
      }
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "qc.run", entityType: "QcRun", entityId: run.id, meta: { status: ev.status, rules: ev.violated } }, tx);
      return { run, evaluation: ev, blockId: block?.id ?? null, revokedResults: revoked };
    });
  }

  /** Unreleased results entered since the last passing run for this analyte/instrument are not trustworthy: send them back for re-run. */
  private async revokeSinceLastPass(tx: Db, u: { orgId: string; staffId: string }, instrumentId: string, analyteId: string, failAt: Date): Promise<number> {
    const lastPass = await tx.qcRun.findFirst({ where: { instrumentId, material: { analyteId }, status: "PASS", runAt: { lt: failAt } }, orderBy: { runAt: "desc" } });
    const affected = await tx.result.findMany({ where: { orgId: u.orgId, instrumentId, OR: [{ analyteId }, { derivedFromIds: { has: analyteId } }], releasedAt: null, status: { in: ["ENTERED", "TECH_VALIDATED", "MEDICAL_VALIDATED"] }, enteredAt: { gt: lastPass?.runAt ?? new Date(0) } }, select: { id: true, orderItemId: true } });
    if (!affected.length) return 0;
    await tx.result.updateMany({ where: { id: { in: affected.map((a) => a.id) } }, data: { status: "REJECTED", correctionReason: "QC failure: re-run required", techValidatedBy: null, techValidatedAt: null, medicalValidatedBy: null, medicalValidatedAt: null } });
    for (const a of affected) await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "result.revoked_qc_failure", entityType: "Result", entityId: a.id }, tx);
    return affected.length;
  }

  listRuns(orgId: string, q: { instrumentId?: string; materialId?: string; limit?: number }) {
    return this.prisma.qcRun.findMany({
      where: { orgId, ...(q.instrumentId ? { instrumentId: q.instrumentId } : {}), ...(q.materialId ? { materialId: q.materialId } : {}) },
      include: { material: { include: { analyte: { select: { code: true } } } }, instrument: { select: { name: true } } }, orderBy: { runAt: "desc" }, take: Math.min(q.limit ?? 50, 500),
    });
  }

  /** Levey-Jennings chart data: points in z units + limits at +-1/2/3 SD in value units. */
  async leveyJennings(orgId: string, instrumentId: string, materialId: string, limit = 60) {
    const mat = await this.prisma.qcMaterialLevel.findFirst({ where: { id: materialId, orgId }, include: { analyte: true } });
    if (!mat) throw new NotFoundException({ code: "QC_MATERIAL_NOT_FOUND" });
    const runs = await this.prisma.qcRun.findMany({ where: { orgId, instrumentId, materialId }, orderBy: { runAt: "desc" }, take: Math.min(limit, 500) });
    const mean = D(mat.targetMean);
    const sd = D(mat.targetSd);
    return {
      analyte: { id: mat.analyteId, code: mat.analyte.code, unit: mat.analyte.unit },
      level: mat.level, lot: mat.materialLot, mean, sd,
      limits: { plus1: mean + sd, plus2: mean + 2 * sd, plus3: mean + 3 * sd, minus1: mean - sd, minus2: mean - 2 * sd, minus3: mean - 3 * sd },
      points: runs.reverse().map((r) => ({ id: r.id, runAt: r.runAt, value: D(r.value), z: D(r.zScore), status: r.status, violatedRules: r.violatedRules })),
    };
  }

  // ------------------------------------------------------------------ blocks
  listBlocks(orgId: string, status?: "OPEN" | "CLEARED") {
    return this.prisma.qcBlock.findMany({ where: { orgId, ...(status ? { status } : {}) }, include: { instrument: { select: { name: true } }, openedByRun: true }, orderBy: { openedAt: "desc" }, take: 200 });
  }

  /** Documented clearance: a NEWER passing run for the same instrument/analyte plus a written note by a person holding qc.clear_block. */
  async clearBlock(u: AuthUser, blockId: string, b: { clearedByRunId: string; note: string }) {
    if (b.note.trim().length < 10) throw new BadRequestException({ code: "CLEAR_NOTE_REQUIRED", message: "document the corrective action (min 10 characters)" });
    return this.prisma.$transaction(async (tx) => {
      const block = await tx.qcBlock.findFirst({ where: { id: blockId, orgId: u.orgId }, include: { openedByRun: true } });
      if (!block) throw new NotFoundException({ code: "QC_BLOCK_NOT_FOUND" });
      if (block.status !== "OPEN") throw new ConflictException({ code: "QC_BLOCK_NOT_OPEN" });
      const run = await tx.qcRun.findFirst({ where: { id: b.clearedByRunId, orgId: u.orgId }, include: { material: true } });
      if (!run || run.instrumentId !== block.instrumentId || run.material.analyteId !== block.analyteId) throw new BadRequestException({ code: "CLEARING_RUN_MISMATCH" });
      if (run.status !== "PASS") throw new ConflictException({ code: "CLEARING_RUN_NOT_PASSING", status: run.status });
      if (!(run.runAt > block.openedByRun.runAt) || run.id === block.openedByRunId) throw new ConflictException({ code: "CLEARING_RUN_NOT_NEWER" });
      await tx.qcBlock.update({ where: { id: blockId }, data: { status: "CLEARED", clearedByRunId: run.id, clearedBy: u.staffId, clearNote: b.note, clearedAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "qc.block_cleared", entityType: "QcBlock", entityId: blockId, meta: { clearedByRunId: run.id } }, tx);
      return tx.qcBlock.findUniqueOrThrow({ where: { id: blockId } });
    });
  }
}
