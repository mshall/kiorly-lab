import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { appConfig } from "../config/app-config";

export interface ChargeRequest {
  amount: number;
  currency: string;
  /** Opaque card token from the (mock) hosted fields. Raw card numbers are never accepted. */
  cardToken: string;
  idempotencyKey: string;
}
export interface ChargeResult {
  ok: boolean;
  pspRef?: string;
  error?: string;
}

/** PSP port (Paymob/Fawry/InstaPay later). PSP_MODE=mock: deterministic fake — token "tok_decline" declines, everything else succeeds. */
@Injectable()
export class PspAdapter {
  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (/^\d{12,19}$/.test(req.cardToken)) return { ok: false, error: "raw card numbers are not accepted; use a token" };
    if (appConfig.pspMode() === "real") throw new Error("PSP_MODE=real is not wired yet (Docs/NEEDS_HUMAN.md, Provider go-live)");
    if (req.cardToken === "tok_decline") return { ok: false, error: "card_declined" };
    return { ok: true, pspRef: "mockpsp_" + createHash("sha256").update(req.idempotencyKey).digest("hex").slice(0, 16) };
  }
}
