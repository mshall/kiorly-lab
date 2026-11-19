import { Inject, Injectable } from "@nestjs/common";
import type { NotificationChannel, NotificationPurpose } from "@prisma/client";
import { appConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import type { Db } from "../common/db";

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
 * Messaging port. MESSAGING_MODE=mock (default): writes the DB "dev inbox" (NotificationAttempt) and simulates delivery states.
 * mock and real run the SAME validation path (template + no-raw-values check); real sends are wired in the go-live pass.
 */
@Injectable()
export class MessagingAdapter {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async send(input: SendInput, db: Db = this.prisma): Promise<{ id: string; status: "SENT" | "FAILED" }> {
    for (const [k, v] of Object.entries(input.params ?? {})) {
      if (FORBIDDEN_PARAM_KEYS.test(k) || (typeof v === "string" && /\d+(\.\d+)?\s?(mmol|mg\/dl|g\/dl|x10)/i.test(v))) {
        throw new Error(`notification param "${k}" looks like a raw result value; notifications never carry raw values`);
      }
    }
    // deterministic simulated failure so retry paths are testable: recipients ending in "-fail"
    const fail = input.recipientRef.endsWith("-fail");
    if (appConfig.messagingMode() === "real") {
      throw new Error("MESSAGING_MODE=real is not wired yet (see Docs/NEEDS_HUMAN.md, Provider go-live)");
    }
    const row = await db.notificationAttempt.create({
      data: {
        orgId: input.orgId,
        channel: input.channel,
        purpose: input.purpose,
        recipientRef: input.recipientRef,
        templateId: input.templateId,
        params: input.params ?? {},
        status: fail ? "FAILED" : "SENT",
        error: fail ? "mock provider rejected recipient" : null,
        attemptNo: input.attemptNo ?? 1,
        providerMessageId: fail ? null : `mock_${Date.now().toString(36)}`,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      },
    });
    return { id: row.id, status: fail ? "FAILED" : "SENT" };
  }
}
