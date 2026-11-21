import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Optional } from "@nestjs/common";
import type { NotificationChannel, NotificationPurpose } from "../generated/prisma/client";
import { appConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import type { Db } from "../common/db";
import { MobilePushService } from "./mobile-push.adapter";
import { renderMessage } from "./message-templates";
import { ProviderError, type FetchLike } from "../providers/http";
import { messageProvider } from "../providers/messaging-provider";
import { providerConfig, providerMode } from "../providers/provider-env";
import type { MessageChannelKind } from "../providers/provider-types";

export interface SendInput {
  orgId: string;
  channel: NotificationChannel;
  purpose: NotificationPurpose;
  /** Opaque recipient (phone/email/staff id). Never logged. */
  recipientRef: string;
  /** Template id. Placeholders are marked TODO_NEEDS_HUMAN until approved (NH-LB-018). */
  templateId: string;
  /** Parameters for the template. MUST NOT contain raw result values or clinical data. */
  params?: Record<string, string | number>;
  relatedType?: string;
  relatedId?: string;
  attemptNo?: number;
}

/** Substrings that must never travel in a notification (KLCRIT03). */
const FORBIDDEN_PARAM_KEYS = /value|result|analyte|diagnosis|mmol|mg\/dl|g\/dl/i;

/**
 * Messaging port. Each of SMS / EMAIL / WHATSAPP has its own provider (src/providers) and its own switch: SMS_MODE / EMAIL_MODE / WHATSAPP_MODE
 * (legacy MESSAGING_MODE is the default for all three). PUSH stays on the mobile push service; VOICE has no provider yet (mock inbox only).
 * mock and real run the SAME path: validation (no raw values) -> template render -> NotificationAttempt row (QUEUED) -> provider.send
 * (idempotency key = row id) -> SENT / FAILED with the mapped error. Delivery receipts update the row via the signed webhook
 * (POST /webhooks/providers/:kind). Inside a caller's transaction a real send is deferred until after commit (never hold a tx open on the network).
 */
@Injectable()
export class MessagingAdapter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(MessagingAdapter.name);
  private sweeper?: NodeJS.Timeout;
  /** Test seam: inject a fetch for the real HTTP providers. */
  static fetchImpl?: FetchLike;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(MobilePushService) private readonly mobilePush?: MobilePushService,
  ) {}

  onModuleInit() {
    if (appConfig.timersEnabled() && (["SMS", "EMAIL", "WHATSAPP"] as const).some((k) => providerMode(k) === "real")) {
      this.sweeper = setInterval(() => void this.dispatchQueued().catch(() => undefined), 30_000);
      this.sweeper.unref();
    }
  }
  onModuleDestroy() { if (this.sweeper) clearInterval(this.sweeper); }

  async send(input: SendInput, db: Db = this.prisma): Promise<{ id: string; status: "SENT" | "FAILED" }> {
    for (const [k, v] of Object.entries(input.params ?? {})) {
      if (FORBIDDEN_PARAM_KEYS.test(k) || (typeof v === "string" && /\d+(\.\d+)?\s?(mmol|mg\/dl|g\/dl|x10)/i.test(v))) {
        throw new Error(`notification param "${k}" looks like a raw result value; notifications never carry raw values`);
      }
    }
    const kind = input.channel === "SMS" || input.channel === "EMAIL" || input.channel === "WHATSAPP" ? input.channel : null;
    // PUSH / VOICE: in-app inbox only (mock row). A deterministic failure keeps retry paths testable: recipients ending in "-fail".
    if (!kind) {
      const fail = input.recipientRef.endsWith("-fail");
      const row = await db.notificationAttempt.create({ data: { ...this.rowData(input), status: fail ? "FAILED" : "SENT", error: fail ? "mock provider rejected recipient" : null, providerMessageId: fail ? null : `mock_${Date.now().toString(36)}` } });
      if (input.channel === "PUSH" && !fail) await this.mobilePush?.mirror({ orgId: input.orgId, recipientRef: input.recipientRef, purpose: input.purpose, params: input.params, relatedType: input.relatedType, relatedId: input.relatedId }, db);
      return { id: row.id, status: fail ? "FAILED" : "SENT" };
    }
    const row = await db.notificationAttempt.create({ data: { ...this.rowData(input), status: "QUEUED" } });
    const real = providerMode(kind) === "real";
    if (real && db !== (this.prisma as unknown)) {
      const t = setTimeout(() => void this.dispatchQueued().catch(() => undefined), 400);
      t.unref();
      return { id: row.id, status: "SENT" };
    }
    const status = await this.dispatch(row.id, db);
    return { id: row.id, status };
  }

  private rowData(input: SendInput) {
    return { orgId: input.orgId, channel: input.channel, purpose: input.purpose, recipientRef: input.recipientRef, templateId: input.templateId, params: input.params ?? {}, attemptNo: input.attemptNo ?? 1, relatedType: input.relatedType, relatedId: input.relatedId };
  }

  /** Sends one QUEUED row through its channel provider and records the outcome. Never throws. */
  async dispatch(id: string, db: Db = this.prisma): Promise<"SENT" | "FAILED"> {
    const row = await db.notificationAttempt.findUnique({ where: { id } });
    if (!row || row.status !== "QUEUED") return row?.status === "FAILED" ? "FAILED" : "SENT";
    const kind = row.channel as MessageChannelKind;
    const params = (row.params ?? {}) as Record<string, string | number>;
    const locale = params.locale === "ar" ? "ar" : "en";
    const body = renderMessage(row.templateId, params, locale);
    try {
      const provider = messageProvider(kind, process.env, MessagingAdapter.fetchImpl);
      const cfg = providerConfig(kind);
      const r = await provider.send({ channel: kind, to: row.recipientRef, from: cfg.senderId, templateId: row.templateId, locale, subject: body.subject, text: body.text, params, reference: row.id, idempotencyKey: row.id });
      await db.notificationAttempt.updateMany({ where: { id, status: "QUEUED" }, data: { status: "SENT", providerMessageId: r.providerMessageId, error: null } });
      return "SENT";
    } catch (e) {
      const code = e instanceof ProviderError ? e.code : "UNEXPECTED";
      const msg = e instanceof ProviderError ? e.message : "unexpected provider failure";
      this.log.warn(`${kind} send failed (${code}) for notification ${id}`);
      await db.notificationAttempt.updateMany({ where: { id, status: "QUEUED" }, data: { status: "FAILED", error: `${code}: ${msg}`.slice(0, 200) } });
      return "FAILED";
    }
  }

  /** Background sweep: dispatches QUEUED provider rows (deferred in-tx sends, or rows left by a crashed process). */
  async dispatchQueued(limit = 50): Promise<number> {
    const rows = await this.prisma.notificationAttempt.findMany({ where: { status: "QUEUED", channel: { in: ["SMS", "EMAIL", "WHATSAPP"] }, createdAt: { lt: new Date(Date.now() - 300) } }, orderBy: { createdAt: "asc" }, take: limit, select: { id: true } });
    for (const r of rows) await this.dispatch(r.id);
    return rows.length;
  }
}
