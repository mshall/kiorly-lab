import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma, type HistoStatus } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ResultsService } from "../analysis-qc/results.service";

export const HISTO_FLOW: HistoStatus[] = ["RECEIVED", "GROSSING", "PROCESSING", "REPORTING", "SIGNED_OUT"];

/** Next allowed status in the histopathology workflow (pure). */
export const nextHistoStatus = (s: HistoStatus): HistoStatus | null => HISTO_FLOW[HISTO_FLOW.indexOf(s) + 1] ?? null;

/** Plain-text report: the structured sections the pathologist signed (pure). */
export function histoReportText(c: { kind: string; site?: string | null; grossDescription?: string | null; microscopicDescription?: string | null; diagnosis: string; morphologyCode?: string | null; synoptic?: Record<string, string> | null }): string {
  const parts = [`DIAGNOSIS: ${c.diagnosis}${c.morphologyCode ? ` [${c.morphologyCode}]` : ""}`];
  if (c.site) parts.push(`SITE: ${c.site}`);
  if (c.grossDescription) parts.push(`GROSS: ${c.grossDescription}`);
  if (c.microscopicDescription) parts.push(`MICROSCOPIC: ${c.microscopicDescription}`);
  for (const [k, v] of Object.entries(c.synoptic ?? {})) parts.push(`${k.toUpperCase()}: ${v}`);
  return parts.join("\n");
}

/** M4 histopathology / cytology: grossing -> processing -> reporting -> pathologist sign-out (structured result) + append-only addenda. */
@Injectable()
export class HistopathologyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ResultsService) private readonly results: ResultsService,
  ) {}

  async open(u: AuthUser, b: { orderItemId: string; site?: string; clinicalHistory?: string }) {
    const item = await this.prisma.orderItem.findFirst({ where: { id: b.orderItemId, order: { orgId: u.orgId } }, include: { test: true, order: true } });
    if (!item) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
    if (item.test.section !== "HISTOPATHOLOGY" && item.test.section !== "CYTOLOGY") throw new UnprocessableEntityException({ code: "NOT_A_HISTOLOGY_TEST", section: item.test.section });
    if (!item.specimenId) throw new ConflictException({ code: "NO_SPECIMEN" });
    const sp = await this.prisma.specimen.findUniqueOrThrow({ where: { id: item.specimenId } });
    if (!["RECEIVED", "PROCESSING"].includes(sp.status)) throw new ConflictException({ code: "SPECIMEN_NOT_RECEIVED", status: sp.status });
    if (await this.prisma.histoCase.findUnique({ where: { orderItemId: item.id } })) throw new ConflictException({ code: "CASE_EXISTS" });
    const row = await this.prisma.histoCase.create({ data: { orgId: u.orgId, orderItemId: item.id, specimenId: sp.id, kind: item.test.section === "CYTOLOGY" ? "CYTOLOGY" : "HISTOPATHOLOGY", site: b.site, clinicalHistory: b.clinicalHistory ?? item.order.clinicalInfo, createdBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "histo.open", entityType: "HistoCase", entityId: row.id });
    return this.get(u.orgId, row.id);
  }

  async list(u: AuthUser, q: { status?: string; kind?: string }) {
    const rows = await this.prisma.histoCase.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as HistoStatus } : {}), ...(q.kind ? { kind: q.kind as "HISTOPATHOLOGY" | "CYTOLOGY" } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
    const items = await this.prisma.orderItem.findMany({ where: { id: { in: rows.map((r) => r.orderItemId) } }, select: { id: true, order: { select: { id: true, orderNumber: true, priority: true, patient: { select: { fullName: true } } } }, test: { select: { code: true, nameEn: true } } } });
    return rows.map((r) => ({ ...r, item: items.find((i) => i.id === r.orderItemId) ?? null }));
  }

  async get(orgId: string, id: string) {
    const c = await this.prisma.histoCase.findFirst({ where: { id, orgId }, include: { addenda: { orderBy: { addedAt: "asc" } } } });
    if (!c) throw new NotFoundException({ code: "CASE_NOT_FOUND" });
    const item = await this.prisma.orderItem.findUnique({ where: { id: c.orderItemId }, select: { id: true, test: { select: { code: true, nameEn: true } }, order: { select: { id: true, orderNumber: true, clinicalInfo: true, icdCodes: true, patient: { select: { fullName: true, sex: true, dateOfBirth: true } } } } } });
    return { ...c, item };
  }

  async update(u: AuthUser, id: string, b: { site?: string; clinicalHistory?: string; grossDescription?: string; microscopicDescription?: string; diagnosis?: string; morphologyCode?: string; synoptic?: Record<string, string>; blocks?: number; slides?: number }) {
    const c = await this.prisma.histoCase.findFirst({ where: { id, orgId: u.orgId } });
    if (!c) throw new NotFoundException({ code: "CASE_NOT_FOUND" });
    if (c.status === "SIGNED_OUT") throw new ConflictException({ code: "CASE_SIGNED", message: "signed-out reports are changed by addendum or by correcting the released result" });
    const { synoptic, ...rest } = b;
    await this.prisma.histoCase.update({ where: { id }, data: { ...rest, ...(synoptic ? { synoptic: synoptic as Prisma.InputJsonValue } : {}) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "histo.update", entityType: "HistoCase", entityId: id, meta: { fields: Object.keys(b) } });
    return this.get(u.orgId, id);
  }

  /** Moves the case to its next workflow step (RECEIVED -> GROSSING -> PROCESSING -> REPORTING). Sign-out is a separate, privileged action. */
  async advance(u: AuthUser, id: string) {
    const c = await this.prisma.histoCase.findFirst({ where: { id, orgId: u.orgId } });
    if (!c) throw new NotFoundException({ code: "CASE_NOT_FOUND" });
    const next = nextHistoStatus(c.status);
    if (!next || next === "SIGNED_OUT") throw new ConflictException({ code: "ILLEGAL_CASE_TRANSITION", from: c.status });
    if (c.status === "GROSSING" && !c.grossDescription) throw new ConflictException({ code: "GROSS_DESCRIPTION_REQUIRED" });
    await this.prisma.histoCase.update({ where: { id }, data: { status: next } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "histo.advance", entityType: "HistoCase", entityId: id, meta: { from: c.status, to: next } });
    return this.get(u.orgId, id);
  }

  async signOut(u: AuthUser, id: string, b: { instrumentId: string }) {
    this.results.assertSignatory(u);
    const c = await this.get(u.orgId, id);
    if (c.status !== "REPORTING") throw new ConflictException({ code: "CASE_NOT_READY", status: c.status });
    if (!c.diagnosis?.trim()) throw new BadRequestException({ code: "DIAGNOSIS_REQUIRED" });
    const item = await this.prisma.orderItem.findUniqueOrThrow({ where: { id: c.orderItemId }, include: { test: { include: { analytes: { orderBy: { position: "asc" } } } } } });
    const analyteId = item.test.analytes[0]?.analyteId;
    if (!analyteId) throw new ConflictException({ code: "TEST_HAS_NO_ANALYTE" });
    const text = histoReportText({ kind: c.kind, site: c.site, grossDescription: c.grossDescription, microscopicDescription: c.microscopicDescription, diagnosis: c.diagnosis, morphologyCode: c.morphologyCode, synoptic: c.synoptic as Record<string, string> | null });
    return this.prisma.$transaction(async (tx) => {
      const r = await this.results.enterStructured(u, tx, { orderItemId: c.orderItemId, instrumentId: b.instrumentId, analyteId, valueText: text, flag: "ABNORMAL" });
      await this.results.signOutStructured(u, tx, r.id);
      await tx.histoCase.update({ where: { id }, data: { status: "SIGNED_OUT", pathologistId: u.staffId, signedOutAt: new Date(), resultId: r.id } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "histo.sign_out", entityType: "HistoCase", entityId: id, meta: { resultId: r.id } }, tx);
      return { caseId: id, resultId: r.id, text };
    });
  }

  async addAddendum(u: AuthUser, id: string, text: string) {
    this.results.assertSignatory(u);
    const c = await this.prisma.histoCase.findFirst({ where: { id, orgId: u.orgId } });
    if (!c) throw new NotFoundException({ code: "CASE_NOT_FOUND" });
    if (c.status !== "SIGNED_OUT") throw new ConflictException({ code: "CASE_NOT_SIGNED" });
    await this.prisma.histoAddendum.create({ data: { orgId: u.orgId, caseId: id, text, addedBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "histo.addendum", entityType: "HistoCase", entityId: id });
    return this.get(u.orgId, id);
  }
}
