import { Injectable } from "@nestjs/common";
import { PARTNER_WEBHOOK_PATH, signWebhook, verifyWebhook } from "@kiorex/contracts";
import { Inject } from "@nestjs/common";
import { appConfig } from "../config/app-config";
import { open } from "../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";

export interface WebhookDelivery {
  /** Tenant of the event: selects the per-partner Kiorex URL, secret and client key (IntegrationClient KIOREX_BOOKING). */
  orgId?: string;
  body: string;
  eventId: string;
  eventType: string;
}
export interface WebhookResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Kiorex webhook transport (KIOREX_MODE=mock|real). Both sign with the contract HMAC scheme (X-Kiorly-* headers).
 * Target resolution (kiorex-contracts 1.4.0): the tenant's KIOREX_BOOKING IntegrationClient gives `${kiorexBaseUrl}/api/v1/webhooks/lab`, the
 * per-partner webhook secret and the X-Kiorly-Client-Key header; env values are the single-tenant fallback.
 */
@Injectable()
export class WebhookTransport {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Mock sink: what a Kiorex receiver would have accepted (de-duplicated on eventId). Test/dev inspection only. */
  readonly received = new Map<string, { type: string; body: string }>();
  failNext = 0;

  async deliver(d: WebhookDelivery): Promise<WebhookResult> {
    const client = d.orgId ? await this.prisma.integrationClient.findFirst({ where: { orgId: d.orgId, source: "KIOREX_BOOKING", active: true }, orderBy: { createdAt: "asc" } }) : null;
    const secret = client?.webhookSecretEnc ? open(client.webhookSecretEnc) : appConfig.kiorexWebhookSecret();
    const url = client?.kiorexBaseUrl ? `${client.kiorexBaseUrl.replace(/\/+$/, "")}${PARTNER_WEBHOOK_PATH.lab}` : appConfig.kiorexWebhookUrl();
    const signed = signWebhook({ secret, body: d.body, eventType: d.eventType, eventId: d.eventId, clientKey: client?.key });
    if (appConfig.kiorexMode() === "real") {
      try {
        const res = await fetch(url, { method: "POST", headers: signed.headers, body: d.body, signal: AbortSignal.timeout(8000) });
        return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
      } catch (e) {
        return { ok: false, status: 0, error: (e as Error).message };
      }
    }
    // mock: exercise the same signing + verification path a real Kiorex receiver uses.
    if (this.failNext > 0) {
      this.failNext--;
      return { ok: false, status: 503, error: "mock receiver unavailable" };
    }
    const v = verifyWebhook({ secret, body: d.body, timestamp: signed.headers["X-Kiorly-Timestamp"], signature: signed.headers["X-Kiorly-Signature"] });
    if (!v.ok) return { ok: false, status: 401, error: v.reason };
    if (!this.received.has(d.eventId)) this.received.set(d.eventId, { type: d.eventType, body: d.body });
    return { ok: true, status: 200 };
  }
}
