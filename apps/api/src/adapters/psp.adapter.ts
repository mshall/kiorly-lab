import { Injectable } from "@nestjs/common";
import { ProviderError, type FetchLike } from "../providers/http";
import { paymentProvider } from "../providers/payment-provider";
import type { PayLinkRequest, PayLinkResult, RefundRequest, RefundResult } from "../providers/provider-types";

export interface ChargeRequest {
  amount: number;
  currency: string;
  /** Opaque card token from the (mock) hosted fields. Raw card numbers are never accepted. */
  cardToken: string;
  idempotencyKey: string;
  reference?: string;
}
export interface ChargeResult {
  ok: boolean;
  pspRef?: string;
  error?: string;
}

/**
 * PSP port. PAYMENT_MODE=mock|real (legacy PSP_MODE is the default). mock = deterministic fake (token "tok_decline" declines, amounts ending .13 decline);
 * real = generic HTTP PSP driven by PAYMENT_API_URL / PAYMENT_API_KEY (src/providers/mapping/payment.mapping.ts is the only vendor-specific file).
 * Payment status after a pay-by-link arrives through the signed webhook (POST /webhooks/providers/payment).
 */
@Injectable()
export class PspAdapter {
  /** Test seam for the real HTTP provider. */
  static fetchImpl?: FetchLike;
  private provider() { return paymentProvider(process.env, PspAdapter.fetchImpl); }

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (/^\d{12,19}$/.test(req.cardToken)) return { ok: false, error: "raw card numbers are not accepted; use a token" };
    try {
      const r = await this.provider().charge({ amount: req.amount.toFixed(2), currency: req.currency, method: "CARD", reference: req.reference ?? req.idempotencyKey, idempotencyKey: req.idempotencyKey, cardToken: req.cardToken });
      if (r.status === "CAPTURED") return { ok: true, pspRef: r.providerRef };
      return { ok: false, error: r.status === "PENDING" ? "payment_pending" : r.declineReason ?? "card_declined" };
    } catch (e) {
      if (e instanceof ProviderError) return { ok: false, error: `psp_${e.code.toLowerCase()}` };
      throw e;
    }
  }

  createPayLink(r: PayLinkRequest): Promise<PayLinkResult> { return this.provider().createPayLink(r); }
  refund(r: RefundRequest): Promise<RefundResult> { return this.provider().refund(r); }
}
