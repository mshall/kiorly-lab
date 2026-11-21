import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { ReleaseChannel } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { SIGNATORY_ROLES } from "../../auth/rbac";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { StorageAdapter } from "../../adapters/storage.adapter";
import { appConfig } from "../../config/app-config";
import { D, type Db } from "../../common/db";
import { channelConsented } from "../../common/identity";
import { OrderStatusService } from "../../common/order-status.service";
import { OutboxService } from "../../outbox/outbox.service";
import { PrismaService } from "../../prisma/prisma.service";
import { qcBlockers } from "../analysis-qc/qc-gate";
import { renderReportPdf, type ReportModel } from "./report-pdf";
import { DeliveryService } from "./delivery.service";
import { TemplatesService } from "./templates.service";

/** Contract enum (kiorex-contracts LabResultReleased.channels) for each internal release channel. */
export const CONTRACT_CHANNEL: Record<ReleaseChannel, "PATIENT_LINK" | "KIOREX_VAULT" | "KIORLY_CLINIC" | "PRINTED" | null> = {
  PRINTED: "PRINTED", PATIENT_LINK_OTP: "PATIENT_LINK", KIORLY_CLINIC_IMPORT: "KIORLY_CLINIC",
  /** Kiorly Nurse is an edition of Kiorly Clinic (ADR-031): the contract channel stays KIORLY_CLINIC. */
  KIORLY_NURSE_IMPORT: "KIORLY_CLINIC", KIOREX_VAULT: "KIOREX_VAULT",
  /** Local-only channel (doctor portal): not part of the Kiorex contract, never in the outbox event. */
  REFERRER_PORTAL: null,
};

const sha256 = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const dlSig = (linkId: string, exp: number) => createHmac("sha256", appConfig.jwtDevSecret()).update(`dl.${linkId}.${exp}`).digest("base64url");

@Injectable()
export class ReportsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StorageAdapter) private readonly storage: StorageAdapter,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(OrderStatusService) private readonly orderStatus: OrderStatusService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
    @Inject(TemplatesService) private readonly templates: TemplatesService,
    @Inject(DeliveryService) private readonly delivery: DeliveryService,
  ) {}

  // ------------------------------------------------------------ readiness
  /** Current (non-superseded) results of an order, plus the reasons a report cannot be signed yet. */
  async readiness(orgId: string, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, orgId },
      include: { items: { include: { test: { include: { analytes: true } }, results: { where: { status: { notIn: ["CORRECTED", "REJECTED"] } } } } } },
    });
    if (!order) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } });
    const blockers: { code: string; detail?: string }[] = [];
    for (const it of order.items.filter((i) => i.status !== "CANCELLED")) {
      for (const ta of it.test.analytes) {
        const r = it.results.find((x) => x.analyteId === ta.analyteId);
        if (!r) blockers.push({ code: "RESULT_MISSING", detail: `${it.test.code}/${ta.analyteId}` });
        else if (!["MEDICAL_VALIDATED", "RELEASED"].includes(r.status)) blockers.push({ code: "NOT_MEDICALLY_VALIDATED", detail: r.id });
        else if (r.status === "MEDICAL_VALIDATED") {
          for (const b of await qcBlockers(this.prisma, r, tenant.qcValidityHours)) blockers.push({ code: b, detail: r.id });
        }
      }
    }
    return { order, ready: blockers.length === 0, blockers };
  }

  // ----------------------------------------------------------------- sign
  /** Signs a new report version (KLQC04/KLQC05). Only an authorised signatory with a licence number; immutable once created. */
  async sign(u: AuthUser, orderId: string) {
    if (!SIGNATORY_ROLES.includes(u.role) || !u.signatoryLicenceNo) throw new ForbiddenException({ code: "NOT_AUTHORIZED_SIGNATORY" });
    const { order, ready, blockers } = await this.readiness(u.orgId, orderId);
    if (!ready) throw new ConflictException({ code: blockers.some((b) => b.code.startsWith("QC_")) ? "QC_BLOCKED" : "REPORT_NOT_READY", blockers });
    const prev = await this.prisma.reportVersion.findFirst({ where: { orderId, orgId: u.orgId }, orderBy: { version: "desc" } });
    let reason: string | null = null;
    if (prev) {
      // only corrections validated AFTER the current version was signed need a new version (an already-signed, not yet released amendment does not)
      const corrected = await this.prisma.result.findMany({ where: { orgId: u.orgId, orderItem: { orderId }, supersedesResultId: { not: null }, status: "MEDICAL_VALIDATED", releasedAt: null, medicalValidatedAt: { gt: prev.signedAt } }, select: { correctionReason: true } });
      if (!corrected.length) throw new ConflictException({ code: "NO_CHANGES_TO_REPORT", message: "a new version needs a corrected result" });
      reason = [...new Set(corrected.map((c) => c.correctionReason).filter(Boolean))].join("; ");
    } else if (order.status === "CANCELLED") throw new ConflictException({ code: "ORDER_CANCELLED" });

    const version = (prev?.version ?? 0) + 1;
    const model = await this.model(u, orderId, version, reason);
    const signedAt = new Date(model.signedAt);
    const pdf = await renderReportPdf(model);
    const storageKey = `reports/${u.orgId}/${orderId}/v${version}.pdf`;
    await this.storage.put(storageKey, pdf);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.reportVersion.create({
        data: { id: model.reportId, orgId: u.orgId, orderId, version, correctionReason: reason, supersedesId: prev?.id, signedBy: u.staffId, signedAt, contentHash: sha256(pdf), storageKey, sizeBytes: pdf.length },
      });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "report.sign", entityType: "ReportVersion", entityId: row.id, meta: { version, corrected: Boolean(prev) } }, tx);
      return row;
    });
  }

  private async model(u: AuthUser, orderId: string, version: number, reason: string | null): Promise<ReportModel> {
    const order = await this.prisma.labOrder.findFirstOrThrow({ where: { id: orderId, orgId: u.orgId }, include: { patient: true, specimens: true } });
    const lab = await this.prisma.lab.findUniqueOrThrow({ where: { id: order.labId } });
    const results = await this.prisma.result.findMany({
      where: { orgId: u.orgId, orderItem: { orderId }, status: { in: ["MEDICAL_VALIDATED", "RELEASED"] } },
      include: { analyte: true, orderItem: { include: { test: true } } }, orderBy: [{ orderItem: { createdAt: "asc" } }],
    });
    const collected = order.specimens.map((s) => s.collectedAt).filter(Boolean).sort()[0];
    const reportId = `rep_${randomBytes(12).toString("hex")}`;
    const template = await this.templates.resolve(u.orgId, order.labId, `${appConfig.publicBaseUrl()}/verify/${reportId}`);
    const flagShort = (f: string) => ({ NORMAL: "", LOW: "L", HIGH: "H", CRITICAL_LOW: "LL", CRITICAL_HIGH: "HH", ABNORMAL: "A" })[f] ?? f;
    return {
      reportId, template, version, labName: lab.name, licenceNo: lab.licenceNo, orderNumber: order.orderNumber ?? order.id,
      accessions: order.specimens.filter((s) => s.status !== "REJECTED" && !s.parentSpecimenId).map((s) => s.accessionNumber),
      patient: { name: order.patient.fullName, sex: order.patient.sex, dateOfBirth: order.patient.dateOfBirth?.toISOString().slice(0, 10) ?? null },
      collectedAt: collected ? collected.toISOString() : null, signedBy: u.displayName, signatoryLicenceNo: u.signatoryLicenceNo ?? "", signedAt: new Date().toISOString(), correctionReason: reason,
      lines: results.map((r) => ({
        test: r.orderItem.test.nameEn, testAr: r.orderItem.test.nameAr, analyteAr: r.analyte.nameAr, analyte: r.analyte.nameEn, value: r.valueNumeric != null ? D(r.valueNumeric).toFixed(r.analyte.precision) : (r.valueText ?? ""), unit: r.unit ?? "",
        range: r.refLow != null || r.refHigh != null ? `${r.refLow != null ? D(r.refLow) : ""} - ${r.refHigh != null ? D(r.refHigh) : ""}` : "", flag: flagShort(r.flag),
      })),
    };
  }

  // -------------------------------------------------------------- release
  /**
   * Releases a signed report version on one or more channels. safety.lab.consent_enforcement: each channel needs the order's recorded
   * consent. safety.lab.authorized_release: the version must exist (signed) and all covered results must pass the QC gate; the DB re-checks.
   */
  async release(u: AuthUser, reportId: string, channels: ReleaseChannel[]) {
    if (!channels.length) throw new BadRequestException({ code: "CHANNEL_REQUIRED" });
    const rv = await this.prisma.reportVersion.findFirst({ where: { id: reportId, orgId: u.orgId }, include: { order: { include: { patient: true } } } });
    if (!rv) throw new NotFoundException({ code: "REPORT_NOT_FOUND" });
    const latest = await this.prisma.reportVersion.findFirst({ where: { orderId: rv.orderId }, orderBy: { version: "desc" } });
    if (latest && latest.id !== rv.id) throw new ConflictException({ code: "REPORT_SUPERSEDED", latestVersion: latest.version });
    const missing = [...new Set(channels)].filter((c) => !channelConsented(rv.order.consentShareChannels, c));
    if (missing.length) throw new ConflictException({ code: "CONSENT_REQUIRED", channels: missing });
    const { blockers } = await this.readiness(u.orgId, rv.orderId);
    if (blockers.length) throw new ConflictException({ code: blockers.some((b) => b.code.startsWith("QC_")) ? "QC_BLOCKED" : "REPORT_NOT_READY", blockers });

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
    const token = randomBytes(24).toString("base64url");
    const out = await this.prisma.$transaction(async (tx) => {
      // 1) results become RELEASED against this signed version (DB trigger re-checks QC + signature)
      const toRelease = await tx.result.findMany({ where: { orgId: u.orgId, orderItem: { orderId: rv.orderId }, status: "MEDICAL_VALIDATED" } });
      const now = new Date();
      for (const r of toRelease) await tx.result.update({ where: { id: r.id }, data: { status: "RELEASED", releasedAt: now, releasedReportVersionId: rv.id } });
      await tx.orderItem.updateMany({ where: { orderId: rv.orderId, status: { in: ["VALIDATED", "RESULTED"] } }, data: { status: "RELEASED" } });
      for (const it of await tx.orderItem.findMany({ where: { orderId: rv.orderId }, select: { id: true } })) await this.orderStatus.refreshItem(tx, it.id);

      // 2) release records + secure link
      let link = await tx.reportShareLink.findFirst({ where: { reportVersionId: rv.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
      let secureLink: string;
      if (!link) {
        link = await tx.reportShareLink.create({ data: { orgId: u.orgId, reportVersionId: rv.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + appConfig.reportLinkTtlDays() * 86_400_000) } });
        secureLink = `${appConfig.publicBaseUrl()}/r/${token}`;
      } else {
        // the plaintext token is only known at creation; re-issue for additional channels
        await tx.reportShareLink.update({ where: { id: link.id }, data: { tokenHash: sha256(token) } });
        secureLink = `${appConfig.publicBaseUrl()}/r/${token}`;
      }
      const recs = [];
      for (const ch of [...new Set(channels)]) {
        const existing = await tx.releaseRecord.findFirst({ where: { reportVersionId: rv.id, channel: ch } });
        if (existing) continue;
        recs.push(await tx.releaseRecord.create({ data: { orgId: u.orgId, reportVersionId: rv.id, channel: ch, consentRef: `order:${rv.orderId}:${rv.order.consentCapturedAt?.toISOString() ?? "n/a"}`, secureLinkId: link.id, releasedBy: u.staffId } }));
      }
      const allChannels = (await tx.releaseRecord.findMany({ where: { reportVersionId: rv.id } })).map((r) => CONTRACT_CHANNEL[r.channel]).filter((c): c is NonNullable<typeof c> => c !== null);
      await this.orderStatus.refreshOrder(tx, rv.orderId);

      // 3) outbox (contract-validated, no raw values) — same transaction
      if (allChannels.length) await this.outbox.enqueue(
        {
          orgId: u.orgId, type: "LabResultReleased", aggregateType: "LabReport", aggregateId: rv.id,
          data: { reportId: rv.id, orderId: rv.orderId, labId: rv.order.labId, patientRef: rv.order.patient.externalId ?? rv.order.patient.id, reportVersion: rv.version, signedAt: rv.signedAt.toISOString(), secureLink, channels: [...new Set(allChannels)] },
          eventId: `evt_labrel_${rv.id}_${[...new Set(allChannels)].sort().join("-")}`,
        },
        tx,
      );
      if (rv.version > 1) {
        await this.outbox.enqueue({ orgId: u.orgId, type: "LabReportCorrected", aggregateType: "LabReport", aggregateId: rv.id, data: { reportId: rv.id, orderId: rv.orderId, reportVersion: rv.version }, eventId: `evt_labcorr_${rv.id}` }, tx);
      }
      for (const r of recs) await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "report.release", entityType: "ReleaseRecord", entityId: r.id, meta: { channel: r.channel, version: rv.version } }, tx);

      // 4) notifications (never raw values; templates TODO_NEEDS_HUMAN)
      const phone = rv.order.patient.phone;
      if (phone && channels.includes("PATIENT_LINK_OTP")) {
        await this.messaging.send({ orgId: u.orgId, channel: "WHATSAPP", purpose: rv.version > 1 ? "REPORT_CORRECTED" : "RESULT_READY", recipientRef: phone, templateId: rv.version > 1 ? "TODO_NEEDS_HUMAN_REPORT_CORRECTED" : "TODO_NEEDS_HUMAN_RESULT_READY", params: { link: secureLink, locale: rv.order.patient.preferredLocale, orderNumber: rv.order.orderNumber ?? rv.orderId }, relatedType: "ReportVersion", relatedId: rv.id }, tx);
      }
      if (rv.version > 1 && rv.order.referringDoctorPhone) {
        await this.messaging.send({ orgId: u.orgId, channel: "WHATSAPP", purpose: "REPORT_CORRECTED", recipientRef: rv.order.referringDoctorPhone, templateId: "TODO_NEEDS_HUMAN_REPORT_CORRECTED", params: { orderNumber: rv.order.orderNumber ?? rv.orderId }, relatedType: "ReportVersion", relatedId: rv.id }, tx);
      }
      return { reportId: rv.id, version: rv.version, channels: [...new Set(allChannels)], secureLink, newlyReleased: recs.map((r) => r.channel) };
    });
    void tenant;
    // referrer delivery preferences (consent-checked, best effort: never fails the release)
    await this.delivery.autoDeliverToReferrer(u, rv.id);
    return out;
  }

  /** Public QR verification: proves a report version exists and whether a newer version supersedes it. No patient data. */
  async verifyPublic(reportId: string) {
    const rv = await this.prisma.reportVersion.findUnique({ where: { id: reportId }, include: { order: { select: { labId: true } } } });
    if (!rv) throw new NotFoundException({ code: "REPORT_NOT_FOUND" });
    const latest = await this.prisma.reportVersion.findFirst({ where: { orderId: rv.orderId }, orderBy: { version: "desc" } });
    const lab = await this.prisma.lab.findUnique({ where: { id: rv.order.labId }, select: { name: true } });
    return { valid: true, lab: lab?.name ?? null, version: rv.version, signedAt: rv.signedAt, superseded: Boolean(latest && latest.version > rv.version), latestVersion: latest?.version ?? rv.version, contentHashPrefix: rv.contentHash.slice(0, 12) };
  }

  // ----------------------------------------------------------------- reads
  async listForOrder(orgId: string, orderId: string) {
    if (!(await this.prisma.labOrder.findFirst({ where: { id: orderId, orgId }, select: { id: true } }))) throw new NotFoundException({ code: "ORDER_NOT_FOUND" });
    return this.prisma.reportVersion.findMany({ where: { orgId, orderId }, include: { releases: { select: { channel: true, releasedAt: true } } }, orderBy: { version: "desc" } });
  }

  /**
   * Release queue. `readyToSign`: validated orders that need a (new) report version, i.e. never signed, or signed but carrying a corrected result
   * not yet covered by a version (an amendment). `readyToRelease`: validated orders whose current version is signed, has no pending amendment and
   * is not released yet (sign would answer 409 NO_CHANGES_TO_REPORT). `signedNotReleased`: every signed version without a release record.
   */
  async releaseQueue(orgId: string) {
    const validated = await this.prisma.labOrder.findMany({ where: { orgId, status: "VALIDATED" }, include: { patient: { select: { fullName: true } } }, orderBy: { createdAt: "asc" }, take: 200 });
    const ids = validated.map((o) => o.id);
    const [versions, corrected] = ids.length
      ? await Promise.all([
          this.prisma.reportVersion.findMany({ where: { orgId, orderId: { in: ids } }, select: { orderId: true, signedAt: true } }),
          this.prisma.result.findMany({ where: { orgId, orderItem: { orderId: { in: ids } }, supersedesResultId: { not: null }, status: "MEDICAL_VALIDATED", releasedAt: null }, select: { medicalValidatedAt: true, orderItem: { select: { orderId: true } } } }),
        ])
      : [[], []];
    const lastSigned = new Map<string, Date>();
    for (const v of versions) if (!lastSigned.has(v.orderId) || v.signedAt > lastSigned.get(v.orderId)!) lastSigned.set(v.orderId, v.signedAt);
    const signed = new Set(lastSigned.keys());
    // an amendment needs a NEW version only when its corrected result was validated after the current version was signed
    const amended = new Set(corrected.filter((c) => { const at = lastSigned.get(c.orderItem.orderId); return at && c.medicalValidatedAt && c.medicalValidatedAt > at; }).map((c) => c.orderItem.orderId));
    const row = (o: (typeof validated)[number]) => ({ orderId: o.id, orderNumber: o.orderNumber, patient: o.patient.fullName });
    const needsSignature = validated.filter((o) => !signed.has(o.id) || amended.has(o.id));
    const alreadySigned = validated.filter((o) => signed.has(o.id) && !amended.has(o.id));
    const unreleased = await this.prisma.reportVersion.findMany({ where: { orgId, releases: { none: {} } }, include: { order: { select: { orderNumber: true, consentShareChannels: true, patient: { select: { fullName: true } } } } }, orderBy: { createdAt: "asc" }, take: 200 });
    return {
      readyToSign: needsSignature.map(row),
      readyToRelease: alreadySigned.map(row),
      signedNotReleased: unreleased.map((r) => ({ reportId: r.id, version: r.version, orderId: r.orderId, orderNumber: r.order.orderNumber, patient: r.order.patient.fullName, consent: r.order.consentShareChannels })),
    };
  }

  async pdf(orgId: string, reportId: string): Promise<Buffer> {
    const rv = await this.prisma.reportVersion.findFirst({ where: { id: reportId, orgId } });
    if (!rv) throw new NotFoundException({ code: "REPORT_NOT_FOUND" });
    return this.storage.get(rv.storageKey);
  }

  // ---------------------------------------------- public secure link (OTP)
  private async link(token: string) {
    const link = await this.prisma.reportShareLink.findUnique({ where: { tokenHash: sha256(token) }, include: { reportVersion: { include: { order: { include: { patient: true, } } } } } });
    if (!link || link.revokedAt || link.expiresAt < new Date()) throw new NotFoundException({ code: "LINK_INVALID" });
    return link;
  }

  /** Public view: no clinical data, only that a report exists and where the OTP goes (masked). */
  async publicInfo(token: string) {
    const l = await this.link(token);
    const p = l.reportVersion.order.patient.phone;
    return { valid: true, reportVersion: l.reportVersion.version, requiresOtp: true, maskedPhone: p ? `${"*".repeat(Math.max(p.length - 3, 0))}${p.slice(-3)}` : null };
  }

  private async assertPatientLinkConsent(reportVersionId: string) {
    const rec = await this.prisma.releaseRecord.findFirst({ where: { reportVersionId, channel: "PATIENT_LINK_OTP" } });
    if (!rec) throw new ForbiddenException({ code: "CONSENT_REQUIRED", message: "report was not released on the patient link channel" });
  }

  async requestOtp(token: string) {
    const l = await this.link(token);
    await this.assertPatientLinkConsent(l.reportVersionId);
    const phone = l.reportVersion.order.patient.phone;
    if (!phone) throw new ConflictException({ code: "NO_CONTACT_ON_FILE" });
    if (l.otpExpiresAt && l.otpExpiresAt.getTime() - 9 * 60_000 > Date.now()) throw new HttpException({ code: "OTP_RECENTLY_SENT" }, 429);
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.prisma.reportShareLink.update({ where: { id: l.id }, data: { otpHash: sha256(`${l.id}:${otp}`), otpExpiresAt: new Date(Date.now() + 10 * 60_000), otpAttempts: 0 } });
    await this.messaging.send({ orgId: l.orgId, channel: "SMS", purpose: "REPORT_OTP", recipientRef: phone, templateId: "TODO_NEEDS_HUMAN_REPORT_OTP", params: { otp, locale: l.reportVersion.order.patient.preferredLocale }, relatedType: "ReportShareLink", relatedId: l.id });
    await this.audit.record({ orgId: l.orgId, actorId: null, action: "report.otp_sent", entityType: "ReportShareLink", entityId: l.id });
    return { sent: true };
  }

  async verifyOtp(token: string, otp: string) {
    const l = await this.link(token);
    await this.assertPatientLinkConsent(l.reportVersionId);
    if (!l.otpHash || !l.otpExpiresAt || l.otpExpiresAt < new Date()) throw new ConflictException({ code: "OTP_NOT_REQUESTED_OR_EXPIRED" });
    if (l.otpAttempts >= 5) {
      await this.prisma.reportShareLink.update({ where: { id: l.id }, data: { otpHash: null } });
      throw new HttpException({ code: "OTP_LOCKED" }, 429);
    }
    const ok = (() => {
      const a = Buffer.from(sha256(`${l.id}:${otp}`));
      const b = Buffer.from(l.otpHash!);
      return a.length === b.length && timingSafeEqual(a, b);
    })();
    if (!ok) {
      await this.prisma.reportShareLink.update({ where: { id: l.id }, data: { otpAttempts: { increment: 1 } } });
      throw new ForbiddenException({ code: "OTP_INVALID" });
    }
    await this.prisma.reportShareLink.update({ where: { id: l.id }, data: { verifiedAt: new Date(), otpHash: null, otpAttempts: 0 } });
    await this.audit.record({ orgId: l.orgId, actorId: null, action: "report.link_verified", entityType: "ReportShareLink", entityId: l.id });
    const exp = Date.now() + 10 * 60_000;
    return { downloadToken: `${exp}.${dlSig(l.id, exp)}`, expiresAt: new Date(exp).toISOString() };
  }

  async publicPdf(token: string, dl: string): Promise<Buffer> {
    const l = await this.link(token);
    await this.assertPatientLinkConsent(l.reportVersionId);
    const [expS, sig] = dl.split(".");
    const exp = Number(expS);
    if (!exp || exp < Date.now() || !sig || !(Buffer.from(sig).length === Buffer.from(dlSig(l.id, exp)).length && timingSafeEqual(Buffer.from(sig), Buffer.from(dlSig(l.id, exp))))) throw new ForbiddenException({ code: "DOWNLOAD_TOKEN_INVALID" });
    await this.audit.record({ orgId: l.orgId, actorId: null, action: "report.public_download", entityType: "ReportVersion", entityId: l.reportVersionId });
    return this.storage.get(l.reportVersion.storageKey);
  }

  /** HMAC-authenticated Kiorex vault / Clinic import fetch (consent: a release record for that channel must exist). */
  async integrationPdf(orgId: string, reportId: string, channel: "KIOREX_VAULT" | "KIORLY_CLINIC_IMPORT" | "KIORLY_NURSE_IMPORT", db: Db = this.prisma): Promise<Buffer> {
    const rv = await db.reportVersion.findFirst({ where: { id: reportId, orgId } });
    if (!rv) throw new NotFoundException({ code: "REPORT_NOT_FOUND" });
    if (!(await db.releaseRecord.findFirst({ where: { reportVersionId: reportId, channel } }))) throw new ForbiddenException({ code: "CONSENT_REQUIRED" });
    return this.storage.get(rv.storageKey);
  }
}
