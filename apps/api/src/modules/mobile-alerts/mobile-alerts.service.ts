import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../../auth/auth.types";
import { hasPermission, type Permission } from "../../auth/rbac";
import { AuditService } from "../../audit/audit.service";
import { PrismaService } from "../../prisma/prisma.service";
import { CriticalService } from "../critical/critical.service";

/** SAFETY PATH (ADR-025): never references feature flags or the mobile_staff_app entitlement. Every plan gets read + acknowledge. */
export type AlertKind = "CRITICAL_VALUE" | "TAT_BREACH_CRITICAL" | "QC_FAILURE" | "HOME_COLLECTION_SAFETY";
export interface MobileAlert {
  id: string;
  kind: AlertKind;
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  title: string;
  titleAr: string;
  body: string;
  bodyAr: string;
  subject: { type: string; id: string; label: string } | null;
  raisedAt: string;
  dueAt: string | null;
  ackedAt: string | null;
  ackedBy: string | null;
  ackedByName: string | null;
  ackNote: string | null;
  escalationLevel?: number;
}

const WINDOW_MS = 14 * 86_400_000;
const READ_PERM: Record<AlertKind, Permission> = { CRITICAL_VALUE: "critical.read", TAT_BREACH_CRITICAL: "dashboard.read", QC_FAILURE: "qc.read", HOME_COLLECTION_SAFETY: "collection.manage" };
const ACK_PERM: Record<AlertKind, Permission> = { CRITICAL_VALUE: "critical.ack", TAT_BREACH_CRITICAL: "dashboard.read", QC_FAILURE: "qc.read", HOME_COLLECTION_SAFETY: "collection.manage" };
const SAFETY_KIND_AR: Record<string, string> = { NO_ANSWER: "لا إجابة على فحص السلامة", SOS: "زر الطوارئ SOS", UNSAFE_ABORT: "إنهاء الزيارة لعدم الأمان" };
const SAFETY_KIND_EN: Record<string, string> = { NO_ANSWER: "No answer to safety check", SOS: "SOS pressed", UNSAFE_ABORT: "Visit aborted as unsafe" };

@Injectable()
export class MobileAlertsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CriticalService) private readonly critical: CriticalService,
  ) {}

  private can(u: AuthUser, kind: AlertKind) {
    return hasPermission(u.role, READ_PERM[kind]);
  }

  async list(u: AuthUser, status: "open" | "all" = "open"): Promise<{ items: MobileAlert[]; open: number }> {
    const since = new Date(Date.now() - WINDOW_MS);
    const items: MobileAlert[] = [];
    const orgId = u.orgId;
    const names = new Map((await this.prisma.staffUser.findMany({ where: { orgId }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
    const acks = new Map((await this.prisma.mobileAlertAck.findMany({ where: { orgId, ackedAt: { gte: since } } })).map((a) => [a.alertKey, a]));

    if (this.can(u, "CRITICAL_VALUE")) {
      const rows = await this.prisma.criticalAlert.findMany({
        where: { orgId, ...(status === "open" ? { status: { in: ["OPEN", "ESCALATED"] } } : { notifiedAt: { gte: since } }) },
        include: { result: { select: { flag: true, analyte: { select: { code: true, nameEn: true, nameAr: true } } } } }, orderBy: { notifiedAt: "desc" }, take: 100,
      });
      const orderIds = rows.map((r) => r.orderId).filter(Boolean) as string[];
      const orders = new Map((await this.prisma.labOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } })).map((o) => [o.id, o.orderNumber ?? o.id]));
      for (const a of rows) {
        const acked = a.status === "ACKNOWLEDGED" || a.status === "CLOSED";
        const label = (a.orderId && orders.get(a.orderId)) || a.resultId;
        const dir = a.result.flag === "CRITICAL_LOW" ? "low" : "high";
        const dirAr = a.result.flag === "CRITICAL_LOW" ? "منخفضة" : "مرتفعة";
        items.push({
          id: `crit_${a.id}`, kind: "CRITICAL_VALUE", severity: "CRITICAL",
          title: a.status === "ESCALATED" ? `Escalated critical ${a.result.analyte.code}` : `Critical ${a.result.analyte.code} (${dir})`,
          titleAr: a.status === "ESCALATED" ? `تصعيد نتيجة حرجة ${a.result.analyte.code}` : `نتيجة حرجة ${a.result.analyte.code} (${dirAr})`,
          body: `Order ${label}: ${a.result.analyte.nameEn} is critical ${dir}. Acknowledge and call the clinician.`,
          bodyAr: `الطلب ${label}: ${a.result.analyte.nameAr ?? a.result.analyte.nameEn} حرجة ${dirAr}. أقرّ بالاستلام واتصل بالطبيب.`,
          subject: { type: "ORDER", id: a.orderId ?? a.resultId, label: String(label) }, raisedAt: a.notifiedAt.toISOString(), dueAt: a.ackDeadlineAt.toISOString(),
          ackedAt: a.acknowledgedAt?.toISOString() ?? null, ackedBy: a.acknowledgedBy, ackedByName: a.acknowledgedBy ? names.get(a.acknowledgedBy) ?? null : null, ackNote: acked ? acks.get(`crit_${a.id}`)?.note ?? null : null, escalationLevel: a.escalationLevel,
        });
      }
    }

    if (this.can(u, "TAT_BREACH_CRITICAL")) {
      const rows = await this.prisma.slaAlert.findMany({ where: { orgId, raisedAt: { gte: since }, orderItem: { order: { priority: { not: "ROUTINE" } }, status: { notIn: ["RELEASED", "CANCELLED"] } } }, include: { orderItem: { include: { test: { select: { code: true, nameEn: true } }, order: { select: { id: true, orderNumber: true, priority: true } } } } }, orderBy: { raisedAt: "desc" }, take: 100 });
      for (const s of rows) {
        const key = `tat_${s.id}`, ack = acks.get(key), o = s.orderItem.order;
        items.push({
          id: key, kind: "TAT_BREACH_CRITICAL", severity: o.priority === "STAT" ? "CRITICAL" : "HIGH",
          title: `${o.priority} turnaround breached`, titleAr: `تجاوز زمن النتيجة (${o.priority})`,
          body: `Order ${o.orderNumber ?? o.id} (${s.orderItem.test.code}) is past its target time.`, bodyAr: `الطلب ${o.orderNumber ?? o.id} (${s.orderItem.test.code}) تجاوز الزمن المستهدف.`,
          subject: { type: "ORDER", id: o.id, label: o.orderNumber ?? o.id }, raisedAt: s.raisedAt.toISOString(), dueAt: null,
          ackedAt: ack?.ackedAt.toISOString() ?? null, ackedBy: ack?.ackedBy ?? null, ackedByName: ack ? names.get(ack.ackedBy) ?? null : null, ackNote: ack?.note ?? null,
        });
      }
    }

    if (this.can(u, "QC_FAILURE")) {
      const rows = await this.prisma.qcBlock.findMany({ where: { orgId, ...(status === "open" ? { status: "OPEN" } : { openedAt: { gte: since } }) }, include: { instrument: { select: { name: true } } }, orderBy: { openedAt: "desc" }, take: 100 });
      const analytes = new Map((await this.prisma.analyte.findMany({ where: { id: { in: rows.map((r) => r.analyteId) } }, select: { id: true, code: true } })).map((a) => [a.id, a.code]));
      for (const b of rows) {
        const key = `qc_${b.id}`, ack = acks.get(key), code = analytes.get(b.analyteId) ?? "?";
        items.push({
          id: key, kind: "QC_FAILURE", severity: "HIGH",
          title: `QC failure ${code} (${b.rule})`, titleAr: `فشل ضبط الجودة ${code} (${b.rule})`,
          body: `${b.instrument.name}: ${code} is blocked until a passing QC run clears it.`, bodyAr: `${b.instrument.name}: ${code} موقوف حتى ينجح تشغيل ضبط الجودة.`,
          subject: { type: "INSTRUMENT", id: b.instrumentId, label: b.instrument.name }, raisedAt: b.openedAt.toISOString(), dueAt: null,
          ackedAt: ack?.ackedAt.toISOString() ?? null, ackedBy: ack?.ackedBy ?? null, ackedByName: ack ? names.get(ack.ackedBy) ?? null : null, ackNote: ack?.note ?? null,
        });
      }
    }

    if (this.can(u, "HOME_COLLECTION_SAFETY")) {
      const rows = await this.prisma.safetyAlert.findMany({ where: { orgId, raisedAt: { gte: since } }, orderBy: { raisedAt: "desc" }, take: 100 });
      for (const s of rows) {
        const key = `safety_${s.id}`, ack = acks.get(key);
        items.push({
          id: key, kind: "HOME_COLLECTION_SAFETY", severity: s.kind === "NO_ANSWER" ? "HIGH" : "CRITICAL",
          title: SAFETY_KIND_EN[s.kind], titleAr: SAFETY_KIND_AR[s.kind],
          body: "Home-collection safety alert. Contact the collector and the safety contact now.", bodyAr: "تنبيه سلامة لزيارة سحب منزلية. تواصل مع أخصائي السحب وجهة اتصال السلامة الآن.",
          subject: { type: "HOME_COLLECTION", id: s.homeCollectionId, label: s.homeCollectionId }, raisedAt: s.raisedAt.toISOString(), dueAt: s.dueAt.toISOString(),
          ackedAt: ack?.ackedAt.toISOString() ?? null, ackedBy: ack?.ackedBy ?? null, ackedByName: ack ? names.get(ack.ackedBy) ?? null : null, ackNote: ack?.note ?? null,
        });
      }
    }

    items.sort((a, b) => Number(Boolean(a.ackedAt)) - Number(Boolean(b.ackedAt)) || b.raisedAt.localeCompare(a.raisedAt));
    const visible = status === "open" ? items.filter((i) => !i.ackedAt) : items;
    return { items: visible, open: items.filter((i) => !i.ackedAt).length };
  }

  /** Idempotent: acknowledging an already-acknowledged alert returns it unchanged. */
  async ack(u: AuthUser, id: string, note?: string): Promise<MobileAlert> {
    const m = /^(crit|tat|qc|safety)_(.+)$/.exec(id);
    if (!m) throw new NotFoundException({ code: "ALERT_NOT_FOUND" });
    const [, prefix, raw] = m;
    const kind: AlertKind = prefix === "crit" ? "CRITICAL_VALUE" : prefix === "tat" ? "TAT_BREACH_CRITICAL" : prefix === "qc" ? "QC_FAILURE" : "HOME_COLLECTION_SAFETY";
    if (!hasPermission(u.role, ACK_PERM[kind])) throw new ForbiddenException({ code: "FORBIDDEN", required: [ACK_PERM[kind]] });
    if (kind === "CRITICAL_VALUE") {
      const a = await this.prisma.criticalAlert.findFirst({ where: { id: raw, orgId: u.orgId } });
      if (!a) throw new NotFoundException({ code: "ALERT_NOT_FOUND" });
      if (a.status !== "ACKNOWLEDGED" && a.status !== "CLOSED") {
        await this.critical.acknowledge(u, raw, note).catch(async (e: { status?: number }) => { if (e?.status !== 409) throw e; });
        await this.prisma.mobileAlertAck.upsert({ where: { orgId_alertKey: { orgId: u.orgId, alertKey: id } }, create: { orgId: u.orgId, alertKey: id, ackedBy: u.staffId, note: note ?? null }, update: {} });
      }
    } else {
      const exists =
        kind === "TAT_BREACH_CRITICAL" ? await this.prisma.slaAlert.findFirst({ where: { id: raw, orgId: u.orgId } })
        : kind === "QC_FAILURE" ? await this.prisma.qcBlock.findFirst({ where: { id: raw, orgId: u.orgId } })
        : await this.prisma.safetyAlert.findFirst({ where: { id: raw, orgId: u.orgId } });
      if (!exists) throw new NotFoundException({ code: "ALERT_NOT_FOUND" });
      const existing = await this.prisma.mobileAlertAck.findUnique({ where: { orgId_alertKey: { orgId: u.orgId, alertKey: id } } });
      if (!existing) {
        await this.prisma.mobileAlertAck.create({ data: { orgId: u.orgId, alertKey: id, ackedBy: u.staffId, note: note ?? null } });
        await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "mobile.alert_acknowledged", entityType: "MobileAlert", entityId: id, meta: { kind, hasNote: Boolean(note) } });
      }
    }
    const all = await this.list(u, "all");
    const found = all.items.find((i) => i.id === id);
    if (!found) throw new NotFoundException({ code: "ALERT_NOT_FOUND" });
    return found;
  }
}
