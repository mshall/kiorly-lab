import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { Prisma, Result, ResultSource } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { SIGNATORY_ROLES } from "../../auth/rbac";
import { AuditService } from "../../audit/audit.service";
import { ageInDays } from "../../common/age";
import { classifyResult, deltaPercent, isCriticalFlag } from "../../common/clinical-flags";
import { D, type Db } from "../../common/db";
import { OrderStatusService } from "../../common/order-status.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CatalogueService } from "../catalogue/catalogue.service";
import { CriticalService } from "../critical/critical.service";
import { ANALYZABLE } from "../specimens/specimen-state";
import { qcBlockers } from "./qc-gate";

export interface EnterInput {
  orderItemId: string;
  analyteId: string;
  instrumentId: string;
  value?: number;
  valueText?: string;
  unit?: string;
}

type PersistInput = EnterInput & { orgId: string; actor: string; source: ResultSource; analyzerMessageId?: string; supersedes?: string; correctionReason?: string };

/** Decimal columns -> JSON numbers for API responses. */
export function normalizeResult<T extends { valueNumeric?: unknown; refLow?: unknown; refHigh?: unknown; deltaPercent?: unknown }>(r: T): T {
  const n = (v: unknown) => (v == null ? null : Number(String(v)));
  return { ...r, valueNumeric: n(r.valueNumeric), refLow: n(r.refLow), refHigh: n(r.refHigh), deltaPercent: n(r.deltaPercent) };
}

const CURRENT = { status: { notIn: ["CORRECTED", "REJECTED"] as ("CORRECTED" | "REJECTED")[] } };

@Injectable()
export class ResultsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CatalogueService) private readonly catalogue: CatalogueService,
    @Inject(CriticalService) private readonly critical: CriticalService,
    @Inject(OrderStatusService) private readonly orderStatus: OrderStatusService,
  ) {}

  // ------------------------------------------------------------- entry
  /** KLQC01: manual entry. A second, different person must re-key the value (dual control) before technical validation. */
  async enterManual(u: AuthUser, b: EnterInput) {
    return this.persist(this.prisma, { orgId: u.orgId, actor: u.staffId, source: "MANUAL", ...b });
  }

  /** Analyzer-sourced result (called by the analyzer bridge). No dual control (machine-captured); still needs a processing specimen. */
  async enterFromAnalyzer(orgId: string, instrumentId: string, b: { specimenId: string; analyteId: string; value?: number; valueText?: string; unit?: string; protocol: "ASTM_E1394" | "HL7_V2"; messageId: string }) {
    const item = await this.prisma.orderItem.findFirst({ where: { specimenId: b.specimenId, order: { orgId }, test: { analytes: { some: { analyteId: b.analyteId } } }, status: { not: "CANCELLED" } } });
    if (!item) throw new UnprocessableEntityException({ code: "NO_ORDER_ITEM_FOR_ANALYTE" });
    return this.persist(this.prisma, {
      orgId, actor: `instrument:${instrumentId}`, source: b.protocol === "ASTM_E1394" ? "ANALYZER_ASTM" : "ANALYZER_HL7", orderItemId: item.id, analyteId: b.analyteId, instrumentId,
      value: b.value, valueText: b.valueText, unit: b.unit, analyzerMessageId: b.messageId,
    });
  }

  private persist(db: PrismaService, i: PersistInput): Promise<Result> {
    return db.$transaction((tx) => this.persistIn(tx, i));
  }

  private async persistIn(tx: Prisma.TransactionClient, i: PersistInput): Promise<Result> {
    if (i.value == null && !i.valueText) throw new BadRequestException({ code: "VALUE_REQUIRED" });
    if (i.value != null && !Number.isFinite(i.value)) throw new BadRequestException({ code: "VALUE_INVALID" });
    {
      const item = await tx.orderItem.findFirst({ where: { id: i.orderItemId, order: { orgId: i.orgId } }, include: { order: { include: { patient: true } }, test: { include: { analytes: true } } } });
      if (!item) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
      if (!item.test.analytes.some((a) => a.analyteId === i.analyteId)) throw new BadRequestException({ code: "ANALYTE_NOT_IN_TEST" });
      if (!item.specimenId) throw new ConflictException({ code: "NO_SPECIMEN" });
      const sp = await tx.specimen.findUniqueOrThrow({ where: { id: item.specimenId } });
      if (!ANALYZABLE.includes(sp.status)) throw new ConflictException({ code: "SPECIMEN_NOT_PROCESSABLE", status: sp.status, message: "scan and start processing the specimen first (label match)" });
      const inst = await tx.instrument.findFirst({ where: { id: i.instrumentId, orgId: i.orgId, active: true } });
      if (!inst) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
      if (!i.supersedes && (await tx.result.findFirst({ where: { orderItemId: item.id, analyteId: i.analyteId, ...CURRENT } }))) {
        throw new ConflictException({ code: "RESULT_EXISTS", message: "a result already exists; use correction or reject + re-run" });
      }
      const analyte = await tx.analyte.findUniqueOrThrow({ where: { id: i.analyteId } });

      // reference interval + critical rule + flag
      const at = new Date();
      const patient = item.order.patient;
      const interval = await this.catalogue.resolveInterval(tx, i.orgId, i.analyteId, patient.sex, ageInDays(patient.dateOfBirth, at), at);
      const rule = await tx.criticalRule.findFirst({ where: { orgId: i.orgId, analyteId: i.analyteId, active: true } });
      const low = interval?.low == null ? null : D(interval.low);
      const high = interval?.high == null ? null : D(interval.high);
      const flag = i.value != null ? classifyResult(i.value, { low, high }, rule ? { criticalLow: rule.criticalLow == null ? null : D(rule.criticalLow), criticalHigh: rule.criticalHigh == null ? null : D(rule.criticalHigh) } : null) : "NORMAL";

      // delta check vs the patient's prior validated/released result
      let dPct: number | null = null;
      let deltaFailed = false;
      if (i.value != null) {
        const prior = await tx.result.findFirst({
          where: { orgId: i.orgId, analyteId: i.analyteId, valueNumeric: { not: null }, status: { in: ["MEDICAL_VALIDATED", "RELEASED"] }, orderItem: { order: { patientId: item.order.patientId, id: { not: item.orderId } } } },
          orderBy: { enteredAt: "desc" },
        });
        dPct = deltaPercent(i.value, prior?.valueNumeric == null ? null : D(prior.valueNumeric));
        const avr = await tx.autoVerificationRule.findUnique({ where: { orgId_analyteId: { orgId: i.orgId, analyteId: i.analyteId } } });
        if (dPct != null && avr?.maxDeltaPercent != null && Math.abs(dPct) > D(avr.maxDeltaPercent)) deltaFailed = true;
      }

      // covering QC run: the latest run for this instrument/analyte (any level)
      const qc = await tx.qcRun.findFirst({ where: { instrumentId: i.instrumentId, material: { analyteId: i.analyteId } }, orderBy: { runAt: "desc" } });

      const row = await tx.result.create({
        data: {
          orgId: i.orgId, orderItemId: item.id, specimenId: sp.id, analyteId: i.analyteId, instrumentId: i.instrumentId, qcRunId: qc?.id ?? null, source: i.source,
          valueNumeric: i.value ?? null, valueText: i.valueText ?? null, unit: i.unit ?? analyte.unit, flag, referenceIntervalId: interval?.id ?? null,
          refLow: low, refHigh: high, deltaPercent: dPct, deltaCheckFailed: deltaFailed, enteredBy: i.actor, analyzerMessageId: i.analyzerMessageId,
          supersedesResultId: i.supersedes, correctionReason: i.correctionReason,
        },
      });
      await this.audit.record({ orgId: i.orgId, actorId: i.actor, action: "result.enter", entityType: "Result", entityId: row.id, meta: { source: i.source, flag, qcRunId: qc?.id ?? null } }, tx);
      if (isCriticalFlag(flag)) await this.critical.raise(tx, row, item.order);
      await this.autoVerify(tx, row);
      await this.orderStatus.refreshItem(tx, item.id);
      await this.orderStatus.refreshOrder(tx, item.orderId);
      return tx.result.findUniqueOrThrow({ where: { id: row.id } });
    }
  }

  /**
   * Auto-verification (KLQC01): analyzer results that are NORMAL, delta-clean and covered by a PASSING QC run with no open block
   * are technically validated by the system. It NEVER medically validates and NEVER releases.
   */
  private async autoVerify(tx: Prisma.TransactionClient, r: Result): Promise<void> {
    if (r.source === "MANUAL" || r.flag !== "NORMAL" || r.deltaCheckFailed || !r.qcRunId || !r.instrumentId) return;
    const rule = await tx.autoVerificationRule.findUnique({ where: { orgId_analyteId: { orgId: r.orgId, analyteId: r.analyteId } } });
    if (!rule?.enabled) return;
    const run = await tx.qcRun.findUnique({ where: { id: r.qcRunId } });
    if (run?.status !== "PASS") return;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: r.orgId } });
    if ((await qcBlockers(tx, r, tenant.qcValidityHours)).length) return;
    await tx.result.update({ where: { id: r.id }, data: { status: "TECH_VALIDATED", techValidatedBy: "system:auto-verify", techValidatedAt: new Date(), autoVerified: true } });
    await this.audit.record({ orgId: r.orgId, actorId: null, action: "result.auto_verified", entityType: "Result", entityId: r.id }, tx);
  }

  // ------------------------------------------------------ dual control
  async secondEntry(u: AuthUser, id: string, b: { value?: number; valueText?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.result.findFirst({ where: { id, orgId: u.orgId } });
      if (!r) throw new NotFoundException({ code: "RESULT_NOT_FOUND" });
      if (r.source !== "MANUAL") throw new BadRequestException({ code: "DUAL_CONTROL_MANUAL_ONLY" });
      if (r.status !== "ENTERED") throw new ConflictException({ code: "RESULT_NOT_ENTERED", status: r.status });
      if (r.secondEntryBy) throw new ConflictException({ code: "ALREADY_CONFIRMED" });
      if (r.enteredBy === u.staffId) throw new ForbiddenException({ code: "DUAL_CONTROL_SAME_USER", message: "a different person must confirm the entry" });
      const match = r.valueNumeric != null ? b.value != null && Math.abs(D(r.valueNumeric) - b.value) < 1e-9 : (b.valueText ?? "").trim() === (r.valueText ?? "").trim();
      if (!match) {
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "result.second_entry_mismatch", entityType: "Result", entityId: id });
        throw new UnprocessableEntityException({ code: "DUAL_ENTRY_MISMATCH", message: "re-keyed value does not match; verify against the source" });
      }
      const out = await tx.result.update({ where: { id }, data: { secondEntryBy: u.staffId } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "result.second_entry", entityType: "Result", entityId: id }, tx);
      return out;
    });
  }

  // -------------------------------------------------------- validation
  /** KLQC04 (technical validation). */
  async techValidate(u: AuthUser, id: string, b: { deltaAcknowledged?: boolean; note?: string } = {}) {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.mustFind(tx, u.orgId, id);
      if (r.status !== "ENTERED") throw new ConflictException({ code: "ILLEGAL_RESULT_TRANSITION", from: r.status });
      if (r.source === "MANUAL" && !r.secondEntryBy) throw new ConflictException({ code: "DUAL_CONTROL_REQUIRED" });
      if (r.deltaCheckFailed && !(b.deltaAcknowledged && (b.note ?? "").trim().length >= 5)) throw new ConflictException({ code: "DELTA_CHECK_ACK_REQUIRED", deltaPercent: r.deltaPercent == null ? null : D(r.deltaPercent) });
      await this.assertQc(tx, r);
      await tx.result.update({ where: { id }, data: { status: "TECH_VALIDATED", techValidatedBy: u.staffId, techValidatedAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "result.tech_validate", entityType: "Result", entityId: id, meta: { deltaAcknowledged: Boolean(b.deltaAcknowledged) } }, tx);
      await this.afterChange(tx, r);
      return tx.result.findUniqueOrThrow({ where: { id } });
    });
  }

  /** KLQC04 (medical validation): only an authorised signatory with a recorded licence number. */
  async medicalValidate(u: AuthUser, id: string) {
    this.assertSignatory(u);
    return this.prisma.$transaction(async (tx) => {
      const r = await this.mustFind(tx, u.orgId, id);
      if (r.status !== "TECH_VALIDATED") throw new ConflictException({ code: "TECH_VALIDATION_REQUIRED", from: r.status });
      await this.assertQc(tx, r);
      await tx.result.update({ where: { id }, data: { status: "MEDICAL_VALIDATED", medicalValidatedBy: u.staffId, medicalValidatedAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "result.medical_validate", entityType: "Result", entityId: id }, tx);
      await this.afterChange(tx, r);
      return tx.result.findUniqueOrThrow({ where: { id } });
    });
  }

  assertSignatory(u: AuthUser) {
    if (!SIGNATORY_ROLES.includes(u.role) || !u.signatoryLicenceNo) throw new ForbiddenException({ code: "NOT_AUTHORIZED_SIGNATORY", message: "authorised signatory with a recorded licence number required" });
  }

  /** Medically validates every TECH_VALIDATED result of an order; reports failures per result instead of aborting. */
  async medicalValidateOrder(u: AuthUser, orderId: string) {
    this.assertSignatory(u);
    const rs = await this.prisma.result.findMany({ where: { orgId: u.orgId, orderItem: { orderId }, status: "TECH_VALIDATED" }, select: { id: true } });
    const out: { id: string; ok: boolean; code?: string }[] = [];
    for (const r of rs) {
      try {
        await this.medicalValidate(u, r.id);
        out.push({ id: r.id, ok: true });
      } catch (e) {
        out.push({ id: r.id, ok: false, code: (e as { response?: { code?: string } }).response?.code ?? "ERROR" });
      }
    }
    return out;
  }

  private async mustFind(tx: Db, orgId: string, id: string) {
    const r = await tx.result.findFirst({ where: { id, orgId } });
    if (!r) throw new NotFoundException({ code: "RESULT_NOT_FOUND" });
    return r;
  }

  private async assertQc(tx: Db, r: Result) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: r.orgId } });
    const blockers = await qcBlockers(tx, r, tenant.qcValidityHours);
    if (blockers.length) throw new ConflictException({ code: blockers.includes("QC_BLOCK_OPEN") ? "QC_BLOCK_OPEN" : "QC_NOT_ACCEPTABLE", blockers });
  }

  private async afterChange(tx: Prisma.TransactionClient, r: Result) {
    await this.orderStatus.refreshItem(tx, r.orderItemId);
    const item = await tx.orderItem.findUniqueOrThrow({ where: { id: r.orderItemId } });
    await this.orderStatus.refreshOrder(tx, item.orderId);
  }

  // --------------------------------------------------------- correction
  /** KLQC05: a released result is never edited — a correction creates a new result row (the old one becomes CORRECTED) that needs full re-validation. */
  async correct(u: AuthUser, id: string, b: { value?: number; valueText?: string; reason: string }) {
    if (b.reason.trim().length < 5) throw new BadRequestException({ code: "CORRECTION_REASON_REQUIRED" });
    const old = await this.prisma.result.findFirst({ where: { id, orgId: u.orgId } });
    if (!old) throw new NotFoundException({ code: "RESULT_NOT_FOUND" });
    if (old.status !== "RELEASED") throw new ConflictException({ code: "ONLY_RELEASED_CAN_BE_CORRECTED", from: old.status });
    if (!old.instrumentId) throw new ConflictException({ code: "INSTRUMENT_MISSING" });
    return this.prisma.$transaction(async (tx) => {
      const sp = await tx.specimen.findUniqueOrThrow({ where: { id: old.specimenId } });
      // the correction is keyed on a specimen still in the lab; re-open it for entry if it was stored
      if (!ANALYZABLE.includes(sp.status)) {
        if (sp.status !== "STORED") throw new ConflictException({ code: "SPECIMEN_NOT_AVAILABLE_FOR_CORRECTION", status: sp.status });
        await tx.specimen.update({ where: { id: sp.id }, data: { status: "PROCESSING" } });
        await tx.custodyEvent.create({ data: { orgId: u.orgId, specimenId: sp.id, type: "PROCESSING_STARTED", actorId: u.staffId, note: "re-opened for correction" } });
      }
      const row = await this.persistIn(tx, { orgId: u.orgId, actor: u.staffId, source: "MANUAL", orderItemId: old.orderItemId, analyteId: old.analyteId, instrumentId: old.instrumentId!, value: b.value, valueText: b.valueText, unit: old.unit ?? undefined, supersedes: old.id, correctionReason: b.reason });
      await tx.result.update({ where: { id }, data: { status: "CORRECTED" } });
      await this.orderStatus.refreshItem(tx, old.orderItemId);
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: old.orderItemId } });
      await this.orderStatus.refreshOrder(tx, item.orderId);
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "result.correct", entityType: "Result", entityId: row.id, meta: { supersedes: old.id } }, tx);
      return row;
    });
  }

  // ------------------------------------------------------------- reads
  async forOrder(orgId: string, orderId: string) {
    if (!(await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId }, select: { id: true } }))) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const rs = await this.prisma.result.findMany({
      where: { orgId, orderItem: { orderId } }, include: { analyte: true, orderItem: { include: { test: { select: { code: true, nameEn: true, nameAr: true } } } }, specimen: { select: { accessionNumber: true } }, instrument: { select: { name: true } }, criticalAlerts: { select: { id: true, status: true } } },
      orderBy: [{ enteredAt: "asc" }],
    });
    return rs.map((r) => ({ ...r, valueNumeric: r.valueNumeric == null ? null : D(r.valueNumeric), refLow: r.refLow == null ? null : D(r.refLow), refHigh: r.refHigh == null ? null : D(r.refHigh), deltaPercent: r.deltaPercent == null ? null : D(r.deltaPercent) }));
  }

  /** Technologist worklist: specimens in processing with their expected analytes and entered results. */
  async worklist(orgId: string, labIds: string[], status: "PROCESSING" | "RECEIVED" = "PROCESSING") {
    const specimens = await this.prisma.specimen.findMany({
      where: { orgId, status, ...(labIds.length ? { labId: { in: labIds } } : {}) },
      include: { order: { select: { id: true, orderNumber: true, priority: true, patient: { select: { fullName: true, sex: true, dateOfBirth: true } } } } }, orderBy: { createdAt: "asc" }, take: 200,
    });
    const items = await this.prisma.orderItem.findMany({
      where: { specimenId: { in: specimens.map((s) => s.id) }, status: { not: "CANCELLED" } },
      include: { test: { include: { analytes: { include: { analyte: true }, orderBy: { position: "asc" } } } }, results: { where: CURRENT } },
    });
    return specimens.map((s) => ({ ...s, items: items.filter((i) => i.specimenId === s.id).map((i) => ({ id: i.id, status: i.status, test: { code: i.test.code, nameEn: i.test.nameEn }, analytes: i.test.analytes.map((a) => ({ id: a.analyteId, code: a.analyte.code, nameEn: a.analyte.nameEn, unit: a.analyte.unit })), results: i.results.map((r) => ({ id: r.id, analyteId: r.analyteId, status: r.status, flag: r.flag, valueNumeric: r.valueNumeric == null ? null : D(r.valueNumeric), valueText: r.valueText, secondEntryBy: r.secondEntryBy, deltaCheckFailed: r.deltaCheckFailed, autoVerified: r.autoVerified, source: r.source })) })) }));
  }

  /** Validation queue: results awaiting technical (ENTERED) or medical (TECH_VALIDATED) validation. */
  async validationQueue(orgId: string, stage: "tech" | "medical") {
    const rs = await this.prisma.result.findMany({
      where: { orgId, status: stage === "tech" ? "ENTERED" : "TECH_VALIDATED" },
      include: { analyte: { select: { code: true, nameEn: true, unit: true } }, orderItem: { include: { order: { select: { id: true, orderNumber: true, patient: { select: { fullName: true, sex: true } } } } } }, specimen: { select: { accessionNumber: true } } },
      orderBy: { enteredAt: "asc" }, take: 300,
    });
    return rs.map((r) => ({ ...r, valueNumeric: r.valueNumeric == null ? null : D(r.valueNumeric), refLow: r.refLow == null ? null : D(r.refLow), refHigh: r.refHigh == null ? null : D(r.refHigh), deltaPercent: r.deltaPercent == null ? null : D(r.deltaPercent) }));
  }

  // ------------------------------------------------- auto-verify config
  listAutoVerification(orgId: string) {
    return this.prisma.autoVerificationRule.findMany({ where: { orgId }, include: { analyte: { select: { code: true, nameEn: true } } } });
  }
  async setAutoVerification(u: AuthUser, analyteId: string, b: { enabled: boolean; maxDeltaPercent?: number | null; requireNormal?: boolean }) {
    if (!(await this.prisma.analyte.findFirst({ where: { id: analyteId, orgId: u.orgId } }))) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    const data = { enabled: b.enabled, maxDeltaPercent: b.maxDeltaPercent ?? null, requireNormal: b.requireNormal ?? true };
    const row = await this.prisma.autoVerificationRule.upsert({ where: { orgId_analyteId: { orgId: u.orgId, analyteId } }, create: { orgId: u.orgId, analyteId, ...data }, update: data });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "auto_verification.set", entityType: "AutoVerificationRule", entityId: row.id, meta: { enabled: b.enabled } });
    return row;
  }
}
