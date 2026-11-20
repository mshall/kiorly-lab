import type { SafetyAlert, SafetyAlertDispatcher } from "@kiorly/field-visit";
import type { MessagingAdapter } from "../../adapters/messaging.adapter";

/**
 * Alert channels for the organisation safety contact (HVSAF01/02). SMS first, WhatsApp as fallback; both go through the
 * messaging port (MODE=mock|real, mock writes the dev inbox). Params carry ids, coarse position and emergency numbers only.
 * Template ids are placeholders until the approved AR/EN wording exists (NH-LB-035).
 */
class MessagingDispatcher implements SafetyAlertDispatcher {
  constructor(
    readonly channel: "SMS" | "WHATSAPP",
    private readonly messaging: MessagingAdapter,
    private readonly orgId: string,
    private readonly phone: string,
  ) {}

  async dispatch(alert: SafetyAlert) {
    const params: Record<string, string | number> = { kind: alert.kind, collection: alert.visitId, ambulance: alert.emergencyNumbers.ambulance, police: alert.emergencyNumbers.police };
    if (alert.lastGeostamp) params.lastKnown = `${alert.lastGeostamp.lat},${alert.lastGeostamp.lng}`;
    if (alert.liveLocation) params.live = `${alert.liveLocation.lat},${alert.liveLocation.lng}`;
    const r = await this.messaging.send({ orgId: this.orgId, channel: this.channel, purpose: "SAFETY_ALERT", recipientRef: this.phone, templateId: "TODO_NEEDS_HUMAN_SAFETY_ALERT", params, relatedType: "HomeCollection", relatedId: alert.visitId });
    if (r.status !== "SENT") throw new Error(`${this.channel} delivery failed`);
    return { deliveredAtMs: Date.now(), channel: this.channel };
  }
}

export function labSafetyDispatchers(messaging: MessagingAdapter, orgId: string, contactPhone: string): SafetyAlertDispatcher[] {
  return [new MessagingDispatcher("SMS", messaging, orgId, contactPhone), new MessagingDispatcher("WHATSAPP", messaging, orgId, contactPhone)];
}
