import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ConsentKind, Prisma, Sex } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D, nextSequence, pad } from "../../common/db";
import { page } from "../../common/pagination";
import { PrismaService } from "../../prisma/prisma.service";
import { clusterDuplicates } from "./duplicates";
import { renderCumulativePdf } from "./cumulative-pdf";
import type { ReportTemplateView } from "../release/report-pdf";

export interface PatientPatch {
  fullName?: string; dateOfBirth?: string | null; sex?: Sex; phone?: string | null; email?: string | null; address?: string | null; city?: string | null;
  nationality?: string | null; bloodGroup?: string | null; notes?: string | null; conditions?: string[]; preferredLocale?: string; active?: boolean;
}

const VISIBLE = ["MEDICAL_VALIDATED", "RELEASED"] as const;
const CONSENT_KINDS: ConsentKind[] = ["RESULT_SHARING", "DATA_PROCESSING", "MARKETING", "RESEARCH"];

/** M1: patient registry independent of Kiorly: 360 view, result history, per-analyte trends, duplicate merge, consent history. */
@Injectable()
export class PatientRegistryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private strip<T extends { nationalIdHash?: string | null }>(r: T): Omit<T, "nationalIdHash"> {
    const { nationalIdHash: _h, ...rest } = r;
    void _h;
    return rest;
  }

  private async mustGet(orgId: string, id: string) {
    const p = await this.prisma.patientRef.findFirst({ where: { id, orgId } });
    if (!p) throw new NotFoundException({ code: "PATIENT_NOT_FOUND" });
    return p;
  }

  async update(u: AuthUser, id: string, b: PatientPatch) {
    const cur = await this.mustGet(u.orgId, id);
    if (cur.mergedIntoId) throw new ConflictException({ code: "PATIENT_MERGED", mergedIntoId: cur.mergedIntoId });
    if (b.dateOfBirth && Number.isNaN(Date.parse(b.dateOfBirth))) throw new BadRequestException({ code: "DOB_INVALID" });
    const { dateOfBirth, ...rest } = b;
    const data: Prisma.PatientRefUpdateInput = { ...rest, ...(dateOfBirth !== undefined ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null } : {}) };
    const row = await this.prisma.patientRef.update({ where: { id }, data: { ...data, ...(cur.mrn ? {} : { mrn: `MRN-${pad(await nextSequence(this.prisma, u.orgId, "mrn"), 6)}` }) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.update", entityType: "PatientRef", entityId: id, meta: { fields: Object.keys(b) } });
    return this.strip(row);
  }

  /** 360: demographics, consents, orders (newest first) with report state, counts. */
  async profile(u: AuthUser, id: string) {
    const p = await this.mustGet(u.orgId, id);
    const [orders, consents, resultCount] = await Promise.all([
      this.prisma.labOrder.findMany({
        where: { orgId: u.orgId, patientId: id }, orderBy: { createdAt: "desc" }, take: 100,
        select: { id: true, orderNumber: true, status: true, priority: true, source: true, createdAt: true, referrer: { select: { id: true, name: true } }, items: { select: { test: { select: { code: true, nameEn: true, nameAr: true } } } }, reports: { select: { version: true }, orderBy: { version: "desc" }, take: 1 } },
      }),
      this.consents(u, id),
      this.prisma.result.count({ where: { orgId: u.orgId, orderItem: { order: { patientId: id } }, status: { in: [...VISIBLE] } } }),
    ]);
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.view", entityType: "PatientRef", entityId: id });
    return { patient: this.strip(p), consents, orders, stats: { orders: orders.length, results: resultCount, firstVisit: orders.at(-1)?.createdAt ?? null, lastVisit: orders[0]?.createdAt ?? null } };
  }

  /** Validated/released results across every visit, grouped by analyte, oldest -> newest. */
  async history(u: AuthUser, id: string, q: { analyteId?: string; from?: string; to?: string }) {
    await this.mustGet(u.orgId, id);
    const rows = await this.prisma.result.findMany({
      where: {
        orgId: u.orgId, status: { in: [...VISIBLE] }, orderItem: { order: { patientId: id } }, ...(q.analyteId ? { analyteId: q.analyteId } : {}),
        ...(q.from || q.to ? { enteredAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      },
      include: { analyte: { select: { id: true, code: true, nameEn: true, nameAr: true, unit: true } }, orderItem: { select: { order: { select: { id: true, orderNumber: true, createdAt: true } } } } },
      orderBy: { enteredAt: "asc" },
    });
    const by = new Map<string, { analyte: (typeof rows)[number]["analyte"]; points: unknown[] }>();
    for (const r of rows) {
      const g = by.get(r.analyteId) ?? { analyte: r.analyte, points: [] };
      g.points.push({ resultId: r.id, at: r.enteredAt, value: r.valueNumeric == null ? null : D(r.valueNumeric), text: r.valueText, unit: r.unit, flag: r.flag, refLow: r.refLow == null ? null : D(r.refLow), refHigh: r.refHigh == null ? null : D(r.refHigh), status: r.status, orderId: r.orderItem.order.id, orderNumber: r.orderItem.order.orderNumber });
      by.set(r.analyteId, g);
    }
    return [...by.values()];
  }

  /** Cumulative/trend view: numeric series per analyte with min/max/last and change vs the previous point. */
  async trends(u: AuthUser, id: string, analyteId?: string) {
    const groups = await this.history(u, id, { analyteId });
    return groups
      .map((g) => {
        const pts = (g.points as { at: Date; value: number | null; flag: string; refLow: number | null; refHigh: number | null; orderNumber: string | null; orderId: string }[]).filter((p) => p.value != null);
        const vals = pts.map((p) => p.value as number);
        const last = vals.at(-1) ?? null;
        const prev = vals.length > 1 ? vals.at(-2)! : null;
        return {
          analyte: g.analyte, points: pts,
          stats: { count: pts.length, min: vals.length ? Math.min(...vals) : null, max: vals.length ? Math.max(...vals) : null, last, deltaPercent: last != null && prev != null && prev !== 0 ? Math.round(((last - prev) / Math.abs(prev)) * 1000) / 10 : null, abnormal: pts.filter((p) => p.flag !== "NORMAL").length },
        };
      })
      .filter((g) => g.points.length > 0)
      .sort((a, b) => b.stats.count - a.stats.count);
  }

  /** Cumulative PDF of validated/released results (per analyte table + trend chart), in the lab's template language. */
  async cumulativePdf(u: AuthUser, id: string, analyteId: string | undefined, resolveTemplate: (labId: string) => Promise<ReportTemplateView | undefined>): Promise<Buffer> {
    const p = await this.mustGet(u.orgId, id);
    const groups = await this.trends(u, id, analyteId);
    const lab = await this.prisma.lab.findFirst({ where: { orgId: u.orgId, ...(u.labIds.length ? { id: { in: u.labIds } } : {}) }, orderBy: { createdAt: "asc" } });
    const template = lab ? await resolveTemplate(lab.id) : undefined;
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.cumulative_report", entityType: "PatientRef", entityId: id });
    return renderCumulativePdf({
      labName: lab?.name ?? "Lab", patient: { name: p.fullName, sex: p.sex, dateOfBirth: p.dateOfBirth?.toISOString().slice(0, 10) ?? null, mrn: p.mrn }, generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "), template,
      groups: groups.map((g) => ({ analyte: { code: g.analyte.code, nameEn: g.analyte.nameEn, nameAr: g.analyte.nameAr, unit: g.analyte.unit }, points: g.points.map((x) => ({ at: new Date(x.at).toISOString(), value: x.value as number, flag: x.flag, refLow: x.refLow, refHigh: x.refHigh, orderNumber: x.orderNumber })) })),
    });
  }

  // ------------------------------------------------------- duplicates & merge
  async duplicates(u: AuthUser) {
    const rows = await this.prisma.patientRef.findMany({ where: { orgId: u.orgId, mergedIntoId: null, active: true }, select: { id: true, fullName: true, dateOfBirth: true, phone: true, nationalIdHash: true, mrn: true, nationalIdLast4: true, createdAt: true }, take: 5000 });
    return clusterDuplicates(rows).map((c) => ({ reasons: c.reasons, members: c.members.map((m) => this.strip(m)) }));
  }

  /** Merges `sourceId` into `targetId`: orders and consents move, empty target fields are filled from the source, the source is hidden (kept for audit). */
  async merge(u: AuthUser, sourceId: string, targetId: string) {
    if (sourceId === targetId) throw new BadRequestException({ code: "MERGE_SAME_PATIENT" });
    return this.prisma.$transaction(async (tx) => {
      const [src, dst] = await Promise.all([tx.patientRef.findFirst({ where: { id: sourceId, orgId: u.orgId } }), tx.patientRef.findFirst({ where: { id: targetId, orgId: u.orgId } })]);
      if (!src || !dst) throw new NotFoundException({ code: "PATIENT_NOT_FOUND" });
      if (src.mergedIntoId || dst.mergedIntoId) throw new ConflictException({ code: "PATIENT_ALREADY_MERGED" });
      if (src.nationalIdHash && dst.nationalIdHash && src.nationalIdHash !== dst.nationalIdHash) throw new ConflictException({ code: "MERGE_NATIONAL_ID_CONFLICT", message: "different national ids: not the same person" });
      const moved = await tx.labOrder.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } });
      await tx.patientConsent.updateMany({ where: { patientId: sourceId }, data: { patientId: targetId } });
      const fill: Prisma.PatientRefUpdateInput = {};
      for (const k of ["phone", "email", "address", "city", "nationality", "bloodGroup", "dateOfBirth", "nationalIdHash", "nationalIdLast4", "externalId"] as const) if ((dst[k] == null || dst[k] === "") && src[k] != null) (fill as Record<string, unknown>)[k] = src[k];
      if (dst.sex === "UNKNOWN" && src.sex !== "UNKNOWN") fill.sex = src.sex;
      fill.conditions = [...new Set([...dst.conditions, ...src.conditions])];
      await tx.patientRef.update({ where: { id: targetId }, data: fill });
      await tx.patientRef.update({ where: { id: sourceId }, data: { active: false, mergedIntoId: targetId, mergedAt: new Date(), externalId: null } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.merge", entityType: "PatientRef", entityId: targetId, meta: { sourceId, ordersMoved: moved.count } }, tx);
      return { targetId, sourceId, ordersMoved: moved.count };
    });
  }

  // ---------------------------------------------------------------- consents
  async consents(u: AuthUser, id: string) {
    await this.mustGet(u.orgId, id);
    const history = await this.prisma.patientConsent.findMany({ where: { orgId: u.orgId, patientId: id }, orderBy: { capturedAt: "desc" } });
    const current = Object.fromEntries(CONSENT_KINDS.map((k) => { const h = history.find((x) => x.kind === k); return [k, h ? { granted: h.granted, version: h.version, capturedAt: h.capturedAt } : null]; }));
    return { current, history };
  }

  async addConsent(u: AuthUser, id: string, b: { kind: ConsentKind; granted: boolean; version?: string; channel?: string; note?: string }) {
    await this.mustGet(u.orgId, id);
    const row = await this.prisma.patientConsent.create({ data: { orgId: u.orgId, patientId: id, kind: b.kind, granted: b.granted, version: b.version ?? "v0", channel: b.channel ?? "DESK", note: b.note, capturedBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.consent", entityType: "PatientRef", entityId: id, meta: { kind: b.kind, granted: b.granted } });
    return row;
  }

  async list(u: AuthUser, q: { search?: string; limit?: string; offset?: string; includeMerged?: string }) {
    const rows = await this.prisma.patientRef.findMany({
      where: { orgId: u.orgId, ...(q.includeMerged === "true" ? {} : { mergedIntoId: null }), ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }, { mrn: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }, { nationalIdLast4: q.search }] } : {}) },
      orderBy: { createdAt: "desc" }, ...page(q), include: { _count: { select: { orders: true } } },
    });
    return rows.map((r) => this.strip(r));
  }
}
