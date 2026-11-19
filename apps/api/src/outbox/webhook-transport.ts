import { Injectable } from "@nestjs/common";
import { signWebhook, verifyWebhook } from "@kiorex/contracts";
import { appConfig } from "../config/app-config";

export interface WebhookDelivery {
  body: string;
  eventId: string;
  eventType: string;
}
export interface WebhookResult {
  ok: boolean;
  status: number;
  error?: string;
}

/** Kiorex webhook transport (KIOREX_MODE=mock|real). Both sign with the contract HMAC scheme (X-Kiorly-* headers). */
@Injectable()
export class WebhookTransport {
  /** Mock sink: what a Kiorex receiver would have accepted (de-duplicated on eventId). Test/dev inspection only. */
  readonly received = new Map<string, { type: string; body: string }>();
  failNext = 0;

  async deliver(d: WebhookDelivery): Promise<WebhookResult> {
    const secret = appConfig.kiorexWebhookSecret();
    const signed = signWebhook({ secret, body: d.body, eventType: d.eventType, eventId: d.eventId });
    if (appConfig.kiorexMode() === "real") {
      try {
        const res = await fetch(appConfig.kiorexWebhookUrl(), { method: "POST", headers: signed.headers, body: d.body });
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
