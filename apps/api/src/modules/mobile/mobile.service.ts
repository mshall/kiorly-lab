import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type { StaffRole } from "../../generated/prisma/client";
import type { AuthUser, AuthedRequest } from "../../auth/auth.types";
import { ROLE_PERMISSIONS, hasPermission, type Permission } from "../../auth/rbac";
import { AuditService } from "../../audit/audit.service";
import { MobilePushService } from "../../adapters/mobile-push.adapter";
import { PrismaService } from "../../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { MOBILE_ENTITLEMENT_KEY, MobileEntitlementService } from "./mobile-entitlement.service";
import { SCAN_REQUIRED, nextSpecimenStatus, type SpecimenAction } from "../specimens/specimen-state";
import { MobileAlertsService } from "../mobile-alerts/mobile-alerts.service";
import { sha256 } from "./mobile.guard";
import { modulesForRole } from "./mobile-modules";
import { MobileUpgradeService } from "./mobile-upgrade.service";

const ACTION_PERM: Record<SpecimenAction, Permission> = { collect: "specimens.collect", transport: "specimens.collect", receive: "specimens.receive", process: "specimens.process", store: "specimens.process", dispose: "specimens.process", reject: "specimens.reject", retrieve: "specimens.process" };
const ACTIONS = Object.keys(ACTION_PERM) as SpecimenAction[];
const startOfDay = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

@Injectable()
export class MobileService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MobileEntitlementService) private readonly ent: MobileEntitlementService,
    @Inject(MobilePushService) private readonly push: MobilePushService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(MobileAlertsService) private readonly alerts: MobileAlertsService,
    @Inject(MobileUpgradeService) private readonly upgrade: MobileUpgradeService,
  ) {}

  // ------------------------------------------------------------------ bootstrap
  modulesFor(role: StaffRole, signatoryLicenceNo?: string | null) { return modulesForRole(role, signatoryLicenceNo); }

  async bootstrap(u: AuthUser, req: Pick<AuthedRequest, "headers">) {
    const [tenant, staff] = await Promise.all([this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } }), this.prisma.staffUser.findUniqueOrThrow({ where: { id: u.staffId } })]);
    const e = this.ent.evaluate({ orgId: u.orgId, edition: tenant.edition, marketCode: tenant.marketCode });
    const h = req.headers["x-kiorly-device"];
    const devId = Array.isArray(h) ? h[0] : h;
    const dev = devId ? await this.prisma.mobileDevice.findFirst({ where: { orgId: u.orgId, staffId: u.staffId, OR: [{ id: devId }, { deviceId: devId }] } }) : null;
    const labs = await this.prisma.lab.findMany({ where: { orgId: u.orgId, ...(u.labIds.length ? { id: { in: u.labIds } } : {}) }, select: { id: true, name: true, code: true } });
    return {
      apiVersion: 1 as const,
      product: "lab" as const,
      serverTime: new Date().toISOString(),
      user: { id: staff.id, name: staff.displayName, email: staff.email, role: staff.role, roles: [staff.role], locale: tenant.defaultLocale, signatory: Boolean(staff.signatoryLicenceNo) },
      org: { id: tenant.id, name: tenant.name, slug: tenant.slug, plan: this.ent.plan(tenant.edition), rawPlan: tenant.edition, marketCode: tenant.marketCode, currency: tenant.currency, integrationMode: tenant.integrationMode },
      labs,
      entitlement: { key: MOBILE_ENTITLEMENT_KEY, enabled: e.enabled, requiredPlan: e.requiredPlan, reason: e.reason },
      safetyAlertsOnly: !e.enabled,
      modules: e.enabled ? this.modulesFor(staff.role, staff.signatoryLicenceNo) : [],
      /** Basic orgs only: what this role would get on PRO (locked tiles), my latest upgrade request, open requests for the owner. */
      upgrade: e.enabled ? null : await this.upgrade.bootstrapBlock(u, this.modulesFor(staff.role, staff.signatoryLicenceNo).filter((m) => m.enabled).map((m) => m.key)),
      permissions: e.enabled ? ROLE_PERMISSIONS[staff.role] : [],
      device: dev ? { id: dev.id, status: dev.status } : null,
    };
  }

  // -------------------------------------------------------------------- devices
  async registerDevice(u: AuthUser, b: { deviceId: string; platform: string; name: string; appVersion?: string; pushToken?: string }) {
    const deviceToken = randomBytes(32).toString("base64url");
    const data = { platform: b.platform, name: b.name, appVersion: b.appVersion ?? null, tokenHash: sha256(deviceToken), status: "ACTIVE" as const, revokedAt: null, revokedBy: null, lastSeenAt: new Date(), ...(b.pushToken ? { pushToken: b.pushToken, pushProvider: "mock" } : {}) };
    const row = await this.prisma.mobileDevice.upsert({ where: { staffId_deviceId: { staffId: u.staffId, deviceId: b.deviceId } }, create: { orgId: u.orgId, staffId: u.staffId, deviceId: b.deviceId, ...data }, update: data });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "mobile.device_registered", entityType: "MobileDevice", entityId: row.id, meta: { platform: b.platform } });
    return { id: row.id, deviceId: row.deviceId, deviceToken, status: row.status };
  }

  async listDevices(u: AuthUser) {
    const all = hasPermission(u.role, "staff.manage");
    const rows = await this.prisma.mobileDevice.findMany({ where: { orgId: u.orgId, ...(all ? {} : { staffId: u.staffId }) }, orderBy: { createdAt: "desc" } });
    const names = new Map((await this.prisma.staffUser.findMany({ where: { id: { in: rows.map((r) => r.staffId) } }, select: { id: true, displayName: true } })).map((s) => [s.id, s.displayName]));
    return { items: rows.map((r) => ({ id: r.id, deviceId: r.deviceId, platform: r.platform, name: r.name, appVersion: r.appVersion, status: r.status, hasPushToken: Boolean(r.pushToken), lastSeenAt: r.lastSeenAt, createdAt: r.createdAt, revokedAt: r.revokedAt, staff: { id: r.staffId, name: names.get(r.staffId) ?? null }, mine: r.staffId === u.staffId })) };
  }

  async revokeDevice(u: AuthUser, id: string) {
    const d = await this.prisma.mobileDevice.findFirst({ where: { id, orgId: u.orgId } });
    if (!d) throw new NotFoundException({ code: "DEVICE_NOT_FOUND" });
    if (d.staffId !== u.staffId && !hasPermission(u.role, "staff.manage")) throw new ForbiddenException({ code: "FORBIDDEN", required: ["staff.manage"] });
    if (d.status === "ACTIVE") {
      await this.prisma.mobileDevice.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date(), revokedBy: u.staffId, pushToken: null } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "mobile.device_revoked", entityType: "MobileDevice", entityId: id, meta: { remote: d.staffId !== u.staffId } });
    }
    return { id, status: "REVOKED" as const };
  }

  async setPushToken(u: AuthUser, id: string, b: { token: string; provider: "expo" | "mock" }) {
    const d = await this.prisma.mobileDevice.findFirst({ where: { id, orgId: u.orgId, staffId: u.staffId } });
    if (!d) throw new NotFoundException({ code: "DEVICE_NOT_FOUND" });
    if (d.status !== "ACTIVE") throw new ConflictException({ code: "DEVICE_REVOKED" });
    await this.prisma.mobileDevice.update({ where: { id }, data: { pushToken: b.token, pushProvider: b.provider } });
    return { id, hasPushToken: true, provider: b.provider };
  }

  // ---------------------------------------------------------------------- inbox
  async inbox(u: AuthUser, q: { limit?: string; cursor?: string }) {
    const limit = Math.min(Math.max(Number(q.limit) || 30, 1), 100);
    const rows = await this.prisma.mobilePush.findMany({ where: { orgId: u.orgId, staffId: u.staffId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}) });
    const page = rows.slice(0, limit);
    const unread = await this.prisma.mobilePush.count({ where: { orgId: u.orgId, staffId: u.staffId, readAt: null } });
    return { items: page.map((r) => ({ id: r.id, kind: r.kind, title: r.title, titleAr: r.titleAr, body: r.body, bodyAr: r.bodyAr, data: r.data, createdAt: r.createdAt, readAt: r.readAt })), nextCursor: rows.length > limit ? page[page.length - 1].id : null, unread };
  }
  async markRead(u: AuthUser, id: string) {
    const r = await this.prisma.mobilePush.updateMany({ where: { id, orgId: u.orgId, staffId: u.staffId, readAt: null }, data: { readAt: new Date() } });
    if (!r.count && !(await this.prisma.mobilePush.findFirst({ where: { id, orgId: u.orgId, staffId: u.staffId } }))) throw new NotFoundException({ code: "MESSAGE_NOT_FOUND" });
    return { id, read: true };
  }
  async markAllRead(u: AuthUser) {
    const r = await this.prisma.mobilePush.updateMany({ where: { orgId: u.orgId, staffId: u.staffId, readAt: null }, data: { readAt: new Date() } });
    return { updated: r.count };
  }
  async pushTest(u: AuthUser) {
    const m = await this.push.send({ orgId: u.orgId, staffId: u.staffId, templateId: "TEST", data: { test: true } });
    const devices = await this.prisma.mobileDevice.count({ where: { orgId: u.orgId, staffId: u.staffId, status: "ACTIVE", pushToken: { not: null } } });
    return { id: m.id, provider: m.provider, status: m.status, devices };
  }

  // -------------------------------------------------------------------- summary
  /** Home-screen counters; every figure is permission-scoped (null when the role may not see it). */
  async summary(u: AuthUser) {
    const p = (perm: Permission) => hasPermission(u.role, perm);
    const org = u.orgId, labScope = u.labIds.length ? { labId: { in: u.labIds } } : {};
    const [ordersToday, awaitingCollection, inLab, pendingTech, pendingMedical, openCritical, openQc, tatItems, stock, unread, alerts] = await Promise.all([
      p("orders.read") ? this.prisma.labOrder.count({ where: { orgId: org, ...labScope, createdAt: { gte: startOfDay() }, status: { not: "CANCELLED" } } }) : null,
      p("specimens.read") ? this.prisma.specimen.count({ where: { orgId: org, ...labScope, status: "PENDING_COLLECTION" } }) : null,
      p("results.read") ? this.prisma.specimen.count({ where: { orgId: org, ...labScope, status: { in: ["RECEIVED", "PROCESSING"] } } }) : null,
      p("results.read") ? this.prisma.result.count({ where: { orgId: org, status: "ENTERED" } }) : null,
      p("results.read") ? this.prisma.result.count({ where: { orgId: org, status: "TECH_VALIDATED" } }) : null,
      p("critical.read") ? this.prisma.criticalAlert.count({ where: { orgId: org, status: { in: ["OPEN", "ESCALATED"] } } }) : null,
      p("qc.read") ? this.prisma.qcBlock.count({ where: { orgId: org, status: "OPEN" } }) : null,
      p("dashboard.read") ? this.prisma.slaAlert.count({ where: { orgId: org, raisedAt: { gte: new Date(Date.now() - 86_400_000) } } }) : null,
      p("inventory.read") ? this.inventory.summary(u) : null,
      this.prisma.mobilePush.count({ where: { orgId: org, staffId: u.staffId, readAt: null } }),
      this.alerts.list(u, "open"),
    ]);
    return { serverTime: new Date().toISOString(), ordersToday, awaitingCollection, inLab, pendingTechValidation: pendingTech, pendingMedicalValidation: pendingMedical, openCriticalValues: openCritical, openQcBlocks: openQc, tatBreaches24h: tatItems, reagents: stock ? { lowStock: stock.lowStock, expiringLots: stock.expiringLots } : null, unreadInbox: unread, openAlerts: alerts.open };
  }

  /** Worklist progress per section for the technologist/pathologist (counts only, no PHI). */
  async worklistProgress(u: AuthUser) {
    const items = await this.prisma.orderItem.findMany({ where: { order: { orgId: u.orgId, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, status: { not: "CANCELLED" } }, select: { status: true, test: { select: { section: true } } }, take: 5000 });
    const out: Record<string, { total: number; pending: number; inProgress: number; resulted: number; validated: number; released: number }> = {};
    for (const i of items) {
      const s = (out[i.test.section] ??= { total: 0, pending: 0, inProgress: 0, resulted: 0, validated: 0, released: 0 });
      s.total++;
      if (i.status === "PENDING") s.pending++;
      else if (i.status === "IN_PROGRESS") s.inProgress++;
      else if (i.status === "RESULTED") s.resulted++;
      else if (i.status === "VALIDATED") s.validated++;
      else if (i.status === "RELEASED") s.released++;
    }
    return { windowDays: 7, sections: Object.entries(out).map(([section, v]) => ({ section, ...v, percentDone: v.total ? Math.round(((v.validated + v.released) / v.total) * 100) : 0 })) };
  }

  // ----------------------------------------------------------------------- scan
  /** Resolve a scanned code (specimen barcode, accession number or order number) with the actions the caller may take next. */
  async scan(u: AuthUser, codeRaw: string) {
    const code = codeRaw.trim();
    if (!code) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    const labScope = u.labIds.length ? { labId: { in: u.labIds } } : {};
    const s = await this.prisma.specimen.findFirst({ where: { orgId: u.orgId, ...labScope, OR: [{ barcode: code }, { accessionNumber: code }] }, include: { order: { include: { patient: { select: { fullName: true, sex: true, dateOfBirth: true } }, items: { where: { specimenId: { not: null } }, select: { specimenId: true, test: { select: { code: true } } } } } } } });
    if (s) {
      const custody = await this.prisma.custodyEvent.findMany({ where: { specimenId: s.id }, orderBy: { occurredAt: "desc" }, take: 5 });
      const nextActions = ACTIONS.filter((a) => nextSpecimenStatus(s.status, a)).map((a) => ({ action: a, to: nextSpecimenStatus(s.status, a), requiresScan: SCAN_REQUIRED.includes(a), allowed: hasPermission(u.role, ACTION_PERM[a]) }));
      return {
        type: "SPECIMEN" as const, matchedBy: s.barcode === code ? "barcode" : "accession",
        specimen: { id: s.id, accessionNumber: s.accessionNumber, barcode: s.barcode, specimenType: s.specimenType, container: s.container, status: s.status, collectedAt: s.collectedAt, rejectionReason: s.rejectionReason },
        order: { id: s.order.id, orderNumber: s.order.orderNumber, priority: s.order.priority, status: s.order.status, patient: s.order.patient },
        tests: s.order.items.filter((i) => i.specimenId === s.id).map((i) => i.test.code), custody, nextActions,
      };
    }
    const o = await this.prisma.labOrder.findFirst({ where: { orgId: u.orgId, ...labScope, orderNumber: code }, include: { patient: { select: { fullName: true, sex: true, dateOfBirth: true } }, specimens: { select: { id: true, accessionNumber: true, barcode: true, specimenType: true, status: true } } } });
    if (!o) throw new NotFoundException({ code: "SPECIMEN_NOT_FOUND" });
    return { type: "ORDER" as const, matchedBy: "orderNumber", order: { id: o.id, orderNumber: o.orderNumber, priority: o.priority, status: o.status, patient: o.patient }, specimens: o.specimens };
  }

  // --------------------------------------------------------------------- search
  async search(u: AuthUser, qRaw: string) {
    const q = qRaw.trim();
    if (q.length < 2) return { query: q, patients: [], orders: [], specimens: [] };
    const labScope = u.labIds.length ? { labId: { in: u.labIds } } : {};
    const [patients, orders, specimens] = await Promise.all([
      hasPermission(u.role, "patients.read") ? this.prisma.patientRef.findMany({ where: { orgId: u.orgId, mergedIntoId: null, OR: [{ fullName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { mrn: { contains: q, mode: "insensitive" } }] }, select: { id: true, fullName: true, sex: true, dateOfBirth: true, mrn: true }, take: 8 }) : [],
      hasPermission(u.role, "orders.read") ? this.prisma.labOrder.findMany({ where: { orgId: u.orgId, ...labScope, OR: [{ orderNumber: { contains: q, mode: "insensitive" } }, { patient: { fullName: { contains: q, mode: "insensitive" } } }] }, select: { id: true, orderNumber: true, status: true, priority: true, createdAt: true, patient: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 8 }) : [],
      hasPermission(u.role, "specimens.read") ? this.prisma.specimen.findMany({ where: { orgId: u.orgId, ...labScope, OR: [{ accessionNumber: { contains: q, mode: "insensitive" } }, { barcode: { contains: q, mode: "insensitive" } }] }, select: { id: true, accessionNumber: true, barcode: true, status: true, specimenType: true, orderId: true }, take: 8 }) : [],
    ]);
    return { query: q, patients, orders, specimens };
  }

  // -------------------------------------------------------------------- reagents
  async reagentsLowStock(u: AuthUser) {
    const rows = await this.inventory.stock(u, {});
    const flagged = rows.filter((r) => r.low || r.expiringLots > 0 || r.expiredQty > 0);
    return {
      lowStock: flagged.filter((r) => r.low).map((r) => ({ id: r.id, code: r.code, name: r.name, nameAr: r.nameAr, unit: r.unit, onHand: r.onHand, reorderLevel: r.reorderLevel, reorderQty: r.reorderQty, supplier: r.supplier })),
      expiring: flagged.filter((r) => r.expiringLots > 0 || r.expiredQty > 0).map((r) => ({ id: r.id, code: r.code, name: r.name, nameAr: r.nameAr, unit: r.unit, onHand: r.onHand, expiringLots: r.expiringLots, expiredQty: r.expiredQty, nextExpiry: r.nextExpiry })),
    };
  }
}
