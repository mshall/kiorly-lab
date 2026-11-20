import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CapaKind, DocCategory, MaintKind, NcArea, NcSeverity, NcStatus, Prisma } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, nextSequence, pad } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { DOC_NEXT, NCR_NEXT, addDays, eqaStatus, eqaZ, lotState, qcStats } from "./quality-math";

const dec = (v: unknown) => (v == null ? null : Number(String(v)));

/** M5: QC lots + statistics, calibration, EQA/proficiency, maintenance, NCR/CAPA, document control (SOP library), quality dashboard. */
@Injectable()
export class QualityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ================================================================= QC lots
  async lots(u: AuthUser) {
    const mats = await this.prisma.qcMaterialLevel.findMany({ where: { orgId: u.orgId }, include: { analyte: { select: { code: true, nameEn: true } }, _count: { select: { runs: true } } }, orderBy: [{ analyteId: "asc" }, { level: "asc" }] });
    const last = await this.prisma.qcRun.groupBy({ by: ["materialId"], where: { orgId: u.orgId }, _max: { runAt: true } });
    return mats.map((m) => ({ id: m.id, analyte: m.analyte, level: m.level, lot: m.materialLot, manufacturer: m.manufacturer, status: m.status, openedAt: m.openedAt, expiresAt: m.expiresAt, state: lotState(m.expiresAt), targetMean: D(m.targetMean), targetSd: D(m.targetSd), runCount: m._count.runs, lastRunAt: last.find((l) => l.materialId === m.id)?._max.runAt ?? null }));
  }

  async updateLot(u: AuthUser, id: string, b: { manufacturer?: string; openedAt?: string; expiresAt?: string; status?: "ACTIVE" | "RETIRED" }) {
    const m = await this.prisma.qcMaterialLevel.findFirst({ where: { id, orgId: u.orgId } });
    if (!m) throw new NotFoundException({ code: "QC_MATERIAL_NOT_FOUND" });
    const row = await this.prisma.qcMaterialLevel.update({ where: { id }, data: { manufacturer: b.manufacturer, status: b.status, ...(b.openedAt ? { openedAt: new Date(b.openedAt) } : {}), ...(b.expiresAt ? { expiresAt: new Date(b.expiresAt) } : {}) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: b.status === "RETIRED" ? "qc.lot_retired" : "qc.lot_update", entityType: "QcMaterialLevel", entityId: id, meta: { fields: Object.keys(b) } });
    return row;
  }

  /** Running statistics of a control (cumulative mean/SD/CV and bias against the assigned target) for the last N runs. */
  async statistics(u: AuthUser, q: { materialId: string; instrumentId?: string; limit?: number }) {
    const m = await this.prisma.qcMaterialLevel.findFirst({ where: { id: q.materialId, orgId: u.orgId }, include: { analyte: { select: { code: true, unit: true } } } });
    if (!m) throw new NotFoundException({ code: "QC_MATERIAL_NOT_FOUND" });
    const runs = await this.prisma.qcRun.findMany({ where: { orgId: u.orgId, materialId: q.materialId, ...(q.instrumentId ? { instrumentId: q.instrumentId } : {}) }, orderBy: { runAt: "desc" }, take: Math.min(q.limit ?? 100, 1000) });
    const st = qcStats(runs.map((r) => D(r.value)));
    const tMean = D(m.targetMean);
    const tSd = D(m.targetSd);
    const rules: Record<string, number> = {};
    for (const r of runs) for (const v of r.violatedRules) rules[v] = (rules[v] ?? 0) + 1;
    return { analyte: m.analyte, level: m.level, lot: m.materialLot, target: { mean: tMean, sd: tSd, cv: Math.round((tSd / tMean) * 10000) / 100 }, observed: st, biasPercent: st.mean == null ? null : Math.round(((st.mean - tMean) / tMean) * 10000) / 100, failures: runs.filter((r) => r.status === "FAIL").length, warnings: runs.filter((r) => r.status === "WARNING").length, rules };
  }

  // ============================================================= calibration
  async calibrate(u: AuthUser, b: { instrumentId: string; analyteId?: string; calibratorLot: string; calibratorExpiry?: string; status: "PASS" | "FAIL"; slope?: number; intercept?: number; nextDueDays?: number; note?: string }) {
    if (!(await this.prisma.instrument.findFirst({ where: { id: b.instrumentId, orgId: u.orgId } }))) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    if (b.status === "FAIL" && !(b.note ?? "").trim()) throw new BadRequestException({ code: "NOTE_REQUIRED", message: "document the action taken after a failed calibration" });
    const now = new Date();
    const row = await this.prisma.calibrationRecord.create({ data: { orgId: u.orgId, instrumentId: b.instrumentId, analyteId: b.analyteId, calibratorLot: b.calibratorLot, calibratorExpiry: b.calibratorExpiry ? new Date(b.calibratorExpiry) : null, status: b.status, slope: b.slope, intercept: b.intercept, performedBy: u.staffId, performedAt: now, nextDueAt: b.nextDueDays ? addDays(now, b.nextDueDays) : null, note: b.note } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "calibration.record", entityType: "CalibrationRecord", entityId: row.id, meta: { status: b.status } });
    if (b.status === "FAIL") await this.raiseNcr(u, { title: "Calibration failed", description: `Calibration with lot ${b.calibratorLot} failed. ${b.note ?? ""}`, area: "EQUIPMENT", severity: "MAJOR", source: "INSTRUMENT", relatedType: "Instrument", relatedId: b.instrumentId });
    return { ...row, slope: dec(row.slope), intercept: dec(row.intercept) };
  }

  async calibrations(u: AuthUser, q: { instrumentId?: string; dueBefore?: string }) {
    const rows = await this.prisma.calibrationRecord.findMany({ where: { orgId: u.orgId, ...(q.instrumentId ? { instrumentId: q.instrumentId } : {}), ...(q.dueBefore ? { nextDueAt: { lte: new Date(q.dueBefore) } } : {}) }, orderBy: { performedAt: "desc" }, take: 200 });
    return rows.map((r) => ({ ...r, slope: dec(r.slope), intercept: dec(r.intercept) }));
  }

  // ===================================================================== EQA
  async recordEqa(u: AuthUser, b: { scheme: string; cycle: string; sampleCode: string; analyteId: string; instrumentId?: string; reportedValue: number; assignedValue: number; groupSd: number; note?: string }) {
    if (!(b.groupSd > 0)) throw new BadRequestException({ code: "GROUP_SD_INVALID" });
    if (!(await this.prisma.analyte.findFirst({ where: { id: b.analyteId, orgId: u.orgId } }))) throw new NotFoundException({ code: "ANALYTE_NOT_FOUND" });
    const z = eqaZ(b.reportedValue, b.assignedValue, b.groupSd);
    const status = eqaStatus(z);
    const row = await this.prisma.eqaEvent.create({ data: { orgId: u.orgId, scheme: b.scheme, cycle: b.cycle, sampleCode: b.sampleCode, analyteId: b.analyteId, instrumentId: b.instrumentId, reportedValue: b.reportedValue, assignedValue: b.assignedValue, groupSd: b.groupSd, zScore: z, status, note: b.note, enteredBy: u.staffId } });
    let ncrId: string | null = null;
    if (status === "UNACCEPTABLE") {
      const n = await this.raiseNcr(u, { title: `EQA unacceptable: ${b.scheme} ${b.cycle} ${b.sampleCode}`, description: `z-score ${z} against peer group (reported ${b.reportedValue}, assigned ${b.assignedValue}).`, area: "ANALYTICAL", severity: "MAJOR", source: "EQA", relatedType: "EqaEvent", relatedId: row.id });
      ncrId = n.id;
      await this.prisma.eqaEvent.update({ where: { id: row.id }, data: { ncrId } });
    }
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "eqa.record", entityType: "EqaEvent", entityId: row.id, meta: { status } });
    return { ...row, ncrId, reportedValue: D(row.reportedValue), assignedValue: D(row.assignedValue), groupSd: D(row.groupSd), zScore: D(row.zScore) };
  }

  async eqa(u: AuthUser, q: { analyteId?: string; scheme?: string }) {
    const rows = await this.prisma.eqaEvent.findMany({ where: { orgId: u.orgId, ...(q.analyteId ? { analyteId: q.analyteId } : {}), ...(q.scheme ? { scheme: q.scheme } : {}) }, orderBy: { submittedAt: "desc" }, take: 300 });
    const analytes = await this.prisma.analyte.findMany({ where: { id: { in: rows.map((r) => r.analyteId) } }, select: { id: true, code: true } });
    return rows.map((r) => ({ ...r, analyte: analytes.find((a) => a.id === r.analyteId)?.code ?? null, reportedValue: D(r.reportedValue), assignedValue: D(r.assignedValue), groupSd: D(r.groupSd), zScore: D(r.zScore) }));
  }

  // =========================================================== maintenance
  async createSchedule(u: AuthUser, b: { instrumentId: string; task: string; frequencyDays: number; firstDueAt?: string }) {
    if (!(await this.prisma.instrument.findFirst({ where: { id: b.instrumentId, orgId: u.orgId } }))) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
    const row = await this.prisma.maintenanceSchedule.create({ data: { orgId: u.orgId, instrumentId: b.instrumentId, task: b.task, frequencyDays: b.frequencyDays, nextDueAt: b.firstDueAt ? new Date(b.firstDueAt) : addDays(new Date(), b.frequencyDays) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "maintenance.schedule", entityType: "MaintenanceSchedule", entityId: row.id });
    return row;
  }

  async schedules(u: AuthUser, q: { instrumentId?: string; overdue?: string }) {
    const rows = await this.prisma.maintenanceSchedule.findMany({ where: { orgId: u.orgId, active: true, ...(q.instrumentId ? { instrumentId: q.instrumentId } : {}), ...(q.overdue === "true" ? { nextDueAt: { lt: new Date() } } : {}) }, orderBy: { nextDueAt: "asc" } });
    const inst = await this.prisma.instrument.findMany({ where: { id: { in: rows.map((r) => r.instrumentId) } }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, instrument: inst.find((i) => i.id === r.instrumentId)?.name ?? null, overdue: r.nextDueAt < new Date() }));
  }

  /** Logs maintenance; logging against a schedule resets its due date (now + frequency). */
  async logMaintenance(u: AuthUser, b: { instrumentId: string; scheduleId?: string; kind: MaintKind; notes?: string; downtimeMinutes?: number; partsReplaced?: string }) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.instrument.findFirst({ where: { id: b.instrumentId, orgId: u.orgId } }))) throw new NotFoundException({ code: "INSTRUMENT_NOT_FOUND" });
      const now = new Date();
      if (b.scheduleId) {
        const s = await tx.maintenanceSchedule.findFirst({ where: { id: b.scheduleId, orgId: u.orgId, instrumentId: b.instrumentId } });
        if (!s) throw new NotFoundException({ code: "SCHEDULE_NOT_FOUND" });
        await tx.maintenanceSchedule.update({ where: { id: s.id }, data: { lastDoneAt: now, nextDueAt: addDays(now, s.frequencyDays) } });
      }
      const row = await tx.maintenanceLog.create({ data: { orgId: u.orgId, instrumentId: b.instrumentId, scheduleId: b.scheduleId, kind: b.kind, performedBy: u.staffId, performedAt: now, notes: b.notes, downtimeMinutes: b.downtimeMinutes ?? 0, partsReplaced: b.partsReplaced } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "maintenance.log", entityType: "MaintenanceLog", entityId: row.id, meta: { kind: b.kind } }, tx);
      return row;
    });
  }

  maintenanceLogs(u: AuthUser, instrumentId?: string) {
    return this.prisma.maintenanceLog.findMany({ where: { orgId: u.orgId, ...(instrumentId ? { instrumentId } : {}) }, orderBy: { performedAt: "desc" }, take: 200 });
  }

  // ============================================================== NCR / CAPA
  async raiseNcr(u: Pick<AuthUser, "orgId" | "staffId">, b: { title: string; description: string; area?: NcArea; severity?: NcSeverity; source?: string; relatedType?: string; relatedId?: string }, db: Prisma.TransactionClient | PrismaLike = this.prisma) {
    const year = new Date().getUTCFullYear();
    const number = `NCR-${year}-${pad(await nextSequence(db as never, u.orgId, `ncr:${year}`), 6)}`;
    const row = await db.ncr.create({ data: { orgId: u.orgId, number, title: b.title, description: b.description, area: b.area ?? "OTHER", severity: b.severity ?? "MINOR", source: b.source ?? "MANUAL", relatedType: b.relatedType, relatedId: b.relatedId, raisedBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "ncr.raise", entityType: "Ncr", entityId: row.id, meta: { source: row.source, severity: row.severity } }, db as never);
    return row;
  }

  async ncrs(u: AuthUser, q: { status?: string; severity?: string }) {
    const rows = await this.prisma.ncr.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as NcStatus } : {}), ...(q.severity ? { severity: q.severity as NcSeverity } : {}) }, include: { _count: { select: { actions: true } } }, orderBy: { createdAt: "desc" }, take: 300 });
    return rows.map((r) => ({ ...r, actionCount: r._count.actions }));
  }

  async ncr(u: AuthUser, id: string) {
    const r = await this.prisma.ncr.findFirst({ where: { id, orgId: u.orgId }, include: { actions: { orderBy: { createdAt: "asc" } } } });
    if (!r) throw new NotFoundException({ code: "NCR_NOT_FOUND" });
    return r;
  }

  async advanceNcr(u: AuthUser, id: string, b: { to: NcStatus; rootCause?: string; containment?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const n = await tx.ncr.findFirst({ where: { id, orgId: u.orgId }, include: { actions: true } });
      if (!n) throw new NotFoundException({ code: "NCR_NOT_FOUND" });
      if (!NCR_NEXT[n.status]!.includes(b.to)) throw new ConflictException({ code: "NCR_ILLEGAL_TRANSITION", from: n.status, to: b.to });
      const rootCause = b.rootCause ?? n.rootCause;
      if (b.to === "ACTION" && !(rootCause ?? "").trim()) throw new ConflictException({ code: "ROOT_CAUSE_REQUIRED" });
      if (b.to === "VERIFIED" && (!n.actions.length || n.actions.some((a) => a.status === "OPEN"))) throw new ConflictException({ code: "CAPA_INCOMPLETE", message: "every action must be completed before verification" });
      if (b.to === "CLOSED" && n.actions.some((a) => a.status !== "VERIFIED")) throw new ConflictException({ code: "CAPA_NOT_VERIFIED", message: "every action's effectiveness must be verified before closure" });
      const row = await tx.ncr.update({ where: { id }, data: { status: b.to, rootCause, containment: b.containment ?? n.containment, ...(b.to === "CLOSED" ? { closedBy: u.staffId, closedAt: new Date() } : {}) } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "ncr.advance", entityType: "Ncr", entityId: id, meta: { from: n.status, to: b.to } }, tx);
      return row;
    });
  }

  async addCapa(u: AuthUser, ncrId: string, b: { kind?: CapaKind; description: string; ownerId?: string; dueAt?: string }) {
    const n = await this.prisma.ncr.findFirst({ where: { id: ncrId, orgId: u.orgId } });
    if (!n) throw new NotFoundException({ code: "NCR_NOT_FOUND" });
    if (n.status === "CLOSED") throw new ConflictException({ code: "NCR_CLOSED" });
    const row = await this.prisma.capaAction.create({ data: { orgId: u.orgId, ncrId, kind: b.kind ?? "CORRECTIVE", description: b.description, ownerId: b.ownerId, dueAt: b.dueAt ? new Date(b.dueAt) : null } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "capa.add", entityType: "CapaAction", entityId: row.id });
    return row;
  }

  async completeCapa(u: AuthUser, id: string) {
    const a = await this.prisma.capaAction.findFirst({ where: { id, orgId: u.orgId } });
    if (!a) throw new NotFoundException({ code: "CAPA_NOT_FOUND" });
    if (a.status !== "OPEN") throw new ConflictException({ code: "CAPA_NOT_OPEN", status: a.status });
    const row = await this.prisma.capaAction.update({ where: { id }, data: { status: "DONE", completedAt: new Date() } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "capa.done", entityType: "CapaAction", entityId: id });
    return row;
  }

  async verifyCapa(u: AuthUser, id: string, effectiveness: string) {
    const a = await this.prisma.capaAction.findFirst({ where: { id, orgId: u.orgId } });
    if (!a) throw new NotFoundException({ code: "CAPA_NOT_FOUND" });
    if (a.status !== "DONE") throw new ConflictException({ code: "CAPA_NOT_DONE", status: a.status });
    if (a.ownerId && a.ownerId === u.staffId) throw new ForbiddenException({ code: "VERIFIER_MUST_DIFFER", message: "the action owner cannot verify their own action" });
    const row = await this.prisma.capaAction.update({ where: { id }, data: { status: "VERIFIED", effectiveness, verifiedBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "capa.verify", entityType: "CapaAction", entityId: id });
    return row;
  }

  async capaActions(u: AuthUser, q: { status?: string; overdue?: string }) {
    return this.prisma.capaAction.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as never } : {}), ...(q.overdue === "true" ? { status: "OPEN", dueAt: { lt: new Date() } } : {}) }, orderBy: { dueAt: "asc" }, take: 300 });
  }

  // ======================================================== document control
  async createDocument(u: AuthUser, b: { code: string; title: string; category?: DocCategory; section?: string; body: string; reviewMonths?: number }) {
    const code = b.code.trim().toUpperCase();
    if (await this.prisma.qualityDocument.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "DOCUMENT_CODE_EXISTS" });
    const doc = await this.prisma.qualityDocument.create({ data: { orgId: u.orgId, code, title: b.title, category: b.category ?? "SOP", section: b.section, ownerId: u.staffId, versions: { create: { orgId: u.orgId, version: 1, body: b.body, authoredBy: u.staffId, changeNote: "initial draft" } } } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "document.create", entityType: "QualityDocument", entityId: doc.id });
    return this.document(u, doc.id);
  }

  async documents(u: AuthUser, q: { search?: string; category?: string }) {
    const docs = await this.prisma.qualityDocument.findMany({ where: { orgId: u.orgId, active: true, ...(q.category ? { category: q.category as DocCategory } : {}), ...(q.search ? { OR: [{ code: { contains: q.search, mode: "insensitive" } }, { title: { contains: q.search, mode: "insensitive" } }] } : {}) }, include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, approvedAt: true, reviewDueAt: true } } }, orderBy: { code: "asc" } });
    return docs.map((d) => { const eff = d.versions.find((v) => v.status === "APPROVED"); return { id: d.id, code: d.code, title: d.title, category: d.category, section: d.section, latestVersion: d.versions[0]?.version ?? null, latestStatus: d.versions[0]?.status ?? null, effectiveVersion: eff?.version ?? null, reviewDueAt: eff?.reviewDueAt ?? null, reviewOverdue: Boolean(eff?.reviewDueAt && eff.reviewDueAt < new Date()) }; });
  }

  async document(u: AuthUser, id: string) {
    const d = await this.prisma.qualityDocument.findFirst({ where: { id, orgId: u.orgId }, include: { versions: { orderBy: { version: "desc" }, include: { _count: { select: { acks: true } } } } } });
    if (!d) throw new NotFoundException({ code: "DOCUMENT_NOT_FOUND" });
    return d;
  }

  /** New draft revision (copies the latest body). Only one open draft at a time. */
  async reviseDocument(u: AuthUser, id: string, b: { body?: string; changeNote: string }) {
    const d = await this.document(u, id);
    if (d.versions.some((v) => v.status === "DRAFT" || v.status === "IN_REVIEW")) throw new ConflictException({ code: "DRAFT_EXISTS" });
    const latest = d.versions[0]!;
    const row = await this.prisma.qualityDocumentVersion.create({ data: { orgId: u.orgId, documentId: id, version: latest.version + 1, body: b.body ?? latest.body, authoredBy: u.staffId, changeNote: b.changeNote } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "document.revise", entityType: "QualityDocumentVersion", entityId: row.id });
    return row;
  }

  async editDraft(u: AuthUser, id: string, versionId: string, body: string) {
    const v = await this.prisma.qualityDocumentVersion.findFirst({ where: { id: versionId, documentId: id, orgId: u.orgId } });
    if (!v) throw new NotFoundException({ code: "VERSION_NOT_FOUND" });
    if (v.status !== "DRAFT") throw new ConflictException({ code: "VERSION_NOT_DRAFT", status: v.status });
    return this.prisma.qualityDocumentVersion.update({ where: { id: versionId }, data: { body } });
  }

  /** Version workflow: DRAFT -> IN_REVIEW -> APPROVED (by someone other than the author) -> SUPERSEDED by the next approval. */
  async transitionVersion(u: AuthUser, id: string, versionId: string, to: "IN_REVIEW" | "APPROVED" | "DRAFT", b: { reviewMonths?: number } = {}) {
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.qualityDocumentVersion.findFirst({ where: { id: versionId, documentId: id, orgId: u.orgId } });
      if (!v) throw new NotFoundException({ code: "VERSION_NOT_FOUND" });
      if (!DOC_NEXT[v.status]!.includes(to)) throw new ConflictException({ code: "VERSION_ILLEGAL_TRANSITION", from: v.status, to });
      if (to === "APPROVED") {
        if (v.authoredBy === u.staffId) throw new ForbiddenException({ code: "APPROVER_MUST_DIFFER", message: "a document cannot be approved by its author" });
        await tx.qualityDocumentVersion.updateMany({ where: { documentId: id, status: "APPROVED" }, data: { status: "SUPERSEDED" } });
        const now = new Date();
        await tx.qualityDocumentVersion.update({ where: { id: versionId }, data: { status: "APPROVED", approvedBy: u.staffId, approvedAt: now, effectiveFrom: now, reviewDueAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (b.reviewMonths ?? 12), now.getUTCDate())) } });
      } else await tx.qualityDocumentVersion.update({ where: { id: versionId }, data: { status: to } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: `document.${to.toLowerCase()}`, entityType: "QualityDocumentVersion", entityId: versionId }, tx);
      return tx.qualityDocumentVersion.findUniqueOrThrow({ where: { id: versionId } });
    });
  }

  /** Read-and-understood acknowledgement (only the effective version). */
  async acknowledge(u: AuthUser, id: string, versionId: string) {
    const v = await this.prisma.qualityDocumentVersion.findFirst({ where: { id: versionId, documentId: id, orgId: u.orgId } });
    if (!v) throw new NotFoundException({ code: "VERSION_NOT_FOUND" });
    if (v.status !== "APPROVED") throw new ConflictException({ code: "VERSION_NOT_EFFECTIVE", status: v.status });
    await this.prisma.documentAck.upsert({ where: { versionId_staffId: { versionId, staffId: u.staffId } }, create: { versionId, orgId: u.orgId, staffId: u.staffId }, update: {} });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "document.ack", entityType: "QualityDocumentVersion", entityId: versionId });
    return { acknowledged: true };
  }

  /** Effective documents the caller has not acknowledged yet. */
  async pendingAcks(u: AuthUser) {
    const eff = await this.prisma.qualityDocumentVersion.findMany({ where: { orgId: u.orgId, status: "APPROVED", acks: { none: { staffId: u.staffId } } }, include: { document: { select: { id: true, code: true, title: true } } } });
    return eff.map((v) => ({ documentId: v.document.id, code: v.document.code, title: v.document.title, versionId: v.id, version: v.version }));
  }

  // ================================================================ summary
  async summary(u: AuthUser) {
    const now = new Date();
    const [lots, overdueMaint, ncrOpen, capaOverdue, docs, eqaBad, calDue] = await Promise.all([
      this.prisma.qcMaterialLevel.findMany({ where: { orgId: u.orgId, status: "ACTIVE" }, select: { expiresAt: true } }),
      this.prisma.maintenanceSchedule.count({ where: { orgId: u.orgId, active: true, nextDueAt: { lt: now } } }),
      this.prisma.ncr.count({ where: { orgId: u.orgId, status: { not: "CLOSED" } } }),
      this.prisma.capaAction.count({ where: { orgId: u.orgId, status: "OPEN", dueAt: { lt: now } } }),
      this.prisma.qualityDocumentVersion.count({ where: { orgId: u.orgId, status: "APPROVED", reviewDueAt: { lt: now } } }),
      this.prisma.eqaEvent.count({ where: { orgId: u.orgId, status: "UNACCEPTABLE", submittedAt: { gte: addDays(now, -90) } } }),
      this.prisma.calibrationRecord.count({ where: { orgId: u.orgId, nextDueAt: { lt: now } } }),
    ]);
    return {
      lotsExpired: lots.filter((l) => lotState(l.expiresAt, now) === "EXPIRED").length, lotsExpiringSoon: lots.filter((l) => lotState(l.expiresAt, now) === "EXPIRING_SOON").length,
      maintenanceOverdue: overdueMaint, ncrOpen, capaOverdue, documentsReviewOverdue: docs, eqaUnacceptable90d: eqaBad, calibrationsDue: calDue,
    };
  }
}
type PrismaLike = import("../../prisma/prisma.service").PrismaService;
