import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import type { NotificationChannel } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { appConfig } from "../../config/app-config";
import { channelConsented } from "../../common/identity";
import { PrismaService } from "../../prisma/prisma.service";

const DELIVERABLE: NotificationChannel[] = ["EMAIL", "WHATSAPP", "SMS"];
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** a***@x.com / +2010****111 */
export function maskRecipient(r: string): string {
  if (r.includes("@")) { const [a, d] = r.split("@"); return `${a![0]}***@${d}`; }
  return r.length <= 7 ? "***" : `${r.slice(0, 5)}****${r.slice(-3)}`;
}

export interface DeliverInput { recipient: "PATIENT" | "REFERRER"; channels: NotificationChannel[] }

/** M7: delivery of a released report's secure link by (mock) email / WhatsApp / SMS to the patient or the referring doctor. Consent-checked; never carries result values. */
@Injectable()
export class DeliveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
  ) {}

  /** New share link (plaintext token is only known now). Valid for the configured TTL. */
  private async issueLink(orgId: string, reportVersionId: string): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    await this.prisma.reportShareLink.create({ data: { orgId, reportVersionId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + appConfig.reportLinkTtlDays() * 86_400_000) } });
    return `${appConfig.publicBaseUrl()}/r/${token}`;
  }

  async deliver(u: Pick<AuthUser, "orgId" | "staffId">, reportId: string, b: DeliverInput, trigger: "MANUAL" | "AUTO" = "MANUAL") {
    const rv = await this.prisma.reportVersion.findFirst({ where: { id: reportId, orgId: u.orgId }, include: { order: { include: { patient: true, referrer: true } }, releases: { select: { id: true } } } });
    if (!rv) throw new NotFoundException({ code: "REPORT_NOT_FOUND" });
    const latest = await this.prisma.reportVersion.findFirst({ where: { orderId: rv.orderId }, orderBy: { version: "desc" } });
    if (latest && latest.id !== rv.id) throw new ConflictException({ code: "REPORT_SUPERSEDED", latestVersion: latest.version });
    if (!rv.releases.length) throw new ConflictException({ code: "REPORT_NOT_RELEASED", message: "release the report before delivering it" });
    const o = rv.order;
    // consent: patient delivery rides on the secure-link consent; a doctor receives the link only with the doctor-portal consent
    const needed = b.recipient === "PATIENT" ? "PATIENT_LINK_OTP" : "REFERRER_PORTAL";
    if (!channelConsented(o.consentShareChannels, needed)) throw new ConflictException({ code: "CONSENT_REQUIRED", channels: [needed] });
    const contact = b.recipient === "PATIENT" ? { email: o.patient.email, phone: o.patient.phone, locale: o.patient.preferredLocale } : { email: o.referrer?.email ?? null, phone: o.referrer?.phone ?? null, locale: o.referrer?.preferredLocale ?? "ar" };
    if (b.recipient === "REFERRER" && !o.referrer) throw new UnprocessableEntityException({ code: "NO_REFERRER" });
    const link = await this.issueLink(u.orgId, rv.id);
    const out: { id: string; channel: NotificationChannel; status: "SENT" | "FAILED"; recipient: string }[] = [];
    for (const ch of [...new Set(b.channels)]) {
      if (!DELIVERABLE.includes(ch)) throw new UnprocessableEntityException({ code: "CHANNEL_NOT_DELIVERABLE", channel: ch });
      const to = ch === "EMAIL" ? contact.email : contact.phone;
      if (!to) { const row = await this.prisma.reportDelivery.create({ data: { orgId: u.orgId, reportVersionId: rv.id, orderId: rv.orderId, recipientType: b.recipient, channel: ch, recipientMasked: "(none)", status: "FAILED", error: ch === "EMAIL" ? "NO_EMAIL" : "NO_PHONE", trigger, createdBy: u.staffId } }); out.push({ id: row.id, channel: ch, status: "FAILED", recipient: "(none)" }); continue; }
      // TODO_NEEDS_HUMAN (NH-LB-018): approved email/WhatsApp/SMS templates (EN + AR). Params carry the secure link only, never result values.
      let status: "SENT" | "FAILED" = "SENT";
      let notificationId: string | undefined;
      let error: string | undefined;
      try {
        const r = await this.messaging.send({ orgId: u.orgId, channel: ch, purpose: rv.version > 1 ? "REPORT_CORRECTED" : "RESULT_READY", recipientRef: to, templateId: "TODO_NEEDS_HUMAN_REPORT_DELIVERY", params: { orderNumber: o.orderNumber ?? o.id, locale: contact.locale, link }, relatedType: "ReportVersion", relatedId: rv.id });
        status = r.status;
        notificationId = r.id;
        if (r.status === "FAILED") error = "PROVIDER_REJECTED";
      } catch (e) { status = "FAILED"; error = (e as Error).message.slice(0, 160); }
      const row = await this.prisma.reportDelivery.create({ data: { orgId: u.orgId, reportVersionId: rv.id, orderId: rv.orderId, recipientType: b.recipient, channel: ch, recipientMasked: maskRecipient(to), status, notificationId, error, trigger, createdBy: u.staffId } });
      out.push({ id: row.id, channel: ch, status, recipient: row.recipientMasked });
    }
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "report.deliver", entityType: "ReportVersion", entityId: rv.id, meta: { recipient: b.recipient, channels: b.channels, trigger, sent: out.filter((x) => x.status === "SENT").length } });
    return out;
  }

  list(u: AuthUser, reportId: string) { return this.prisma.reportDelivery.findMany({ where: { orgId: u.orgId, reportVersionId: reportId }, orderBy: { createdAt: "desc" } }); }

  /** Re-sends a FAILED delivery (new attempt row; a fresh link). */
  async retry(u: AuthUser, id: string) {
    const d = await this.prisma.reportDelivery.findFirst({ where: { id, orgId: u.orgId } });
    if (!d) throw new NotFoundException({ code: "DELIVERY_NOT_FOUND" });
    if (d.status !== "FAILED") throw new ConflictException({ code: "DELIVERY_NOT_FAILED" });
    const out = await this.deliver(u, d.reportVersionId, { recipient: d.recipientType as "PATIENT" | "REFERRER", channels: [d.channel] }, d.trigger as "MANUAL" | "AUTO");
    await this.prisma.reportDelivery.updateMany({ where: { id: out[0]!.id }, data: { attempt: d.attempt + 1 } });
    return out;
  }

  /** On release: the referrer's delivery preferences are honoured automatically (needs the doctor-portal consent). Failures never fail the release. */
  async autoDeliverToReferrer(u: Pick<AuthUser, "orgId" | "staffId">, reportId: string) {
    try {
      const rv = await this.prisma.reportVersion.findFirst({ where: { id: reportId, orgId: u.orgId }, include: { order: { include: { referrer: true } } } });
      const r = rv?.order.referrer;
      if (!rv || !r || !r.active || !r.deliverOnRelease || !r.deliveryChannels.length) return [];
      if (!channelConsented(rv.order.consentShareChannels, "REFERRER_PORTAL")) return [];
      return await this.deliver(u, reportId, { recipient: "REFERRER", channels: r.deliveryChannels }, "AUTO");
    } catch {
      return [];
    }
  }
}
