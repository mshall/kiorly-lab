import { BadRequestException, Body, ConflictException, Controller, Get, Inject, NotFoundException, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { CurrentUser, Perm } from "../auth/decorators";
import type { AuthUser } from "../auth/auth.types";
import { MessagingAdapter } from "../adapters/messaging.adapter";
import { renderMessage } from "../adapters/message-templates";
import { PayLinksService } from "../modules/business/paylinks.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProviderEventsService } from "./provider-events.service";
import { MOCK_WEBHOOK_SECRET, PROVIDER_KINDS, WEBHOOK_KINDS, devToolsEnabled, providerConfig, providerMode, webhookSecretFor, type ProviderKind } from "./provider-env";
import type { CanonicalEventType } from "./provider-types";
import { signWebhook } from "./webhook-signature";

const EVENT_TYPES: CanonicalEventType[] = ["message.sent", "message.delivered", "message.read", "message.failed", "payment.succeeded", "payment.failed", "payment.expired", "refund.succeeded", "refund.failed"];
const on = () => { if (!devToolsEnabled()) throw new NotFoundException(); };

/**
 * DEV ONLY (404 in production or with PROVIDER_DEV_TOOLS=false). See the mock "sent messages", simulate provider webhooks (signed with the
 * kind's webhook secret and ingested through the SAME verify/dedupe/apply path as the public endpoint) and run every demo flow end to end.
 */
@ApiTags("dev-providers")
@ApiBearerAuth()
@Controller("dev/providers")
export class DevProvidersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
    @Inject(PayLinksService) private readonly payLinks: PayLinksService,
    @Inject(ProviderEventsService) private readonly events: ProviderEventsService,
  ) {}

  /** Modes and which credentials are set (booleans only, never values). */
  @Get("status") @Perm("settings.manage")
  status() {
    on();
    return PROVIDER_KINDS.map((k) => { const c = providerConfig(k); return { kind: k, mode: providerMode(k), apiUrlSet: !!c.apiUrl, apiKeySet: !!c.apiKey, webhookSecretSet: !!c.webhookSecret, senderIdSet: !!c.senderId }; });
  }

  /** Everything "sent" by the (mock or real) messaging providers, with the rendered body, newest first. */
  @Get("messages") @Perm("settings.manage")
  async messages(@CurrentUser() u: AuthUser, @Query() q: { channel?: string; limit?: string }) {
    on();
    const rows = await this.prisma.notificationAttempt.findMany({ where: { orgId: u.orgId, ...(q.channel ? { channel: q.channel as never } : {}) }, orderBy: { createdAt: "desc" }, take: Math.min(Number(q.limit) || 50, 200) });
    return rows.map((r) => { const p = (r.params ?? {}) as Record<string, string | number>; return { ...r, rendered: renderMessage(r.templateId, p, p.locale === "ar" ? "ar" : "en") }; });
  }

  @Get("pay-links") @Perm("settings.manage")
  payLinkList(@CurrentUser() u: AuthUser) { on(); return this.payLinks.list(u.orgId); }

  /** Simulate a provider callback. Mock mode only. Body: { kind, type, providerRef, error?, amount?, eventId? }. */
  @Post("simulate/webhook") @Perm("settings.manage")
  async simulate(@Body() b: { kind: string; type: CanonicalEventType; providerRef: string; error?: string; amount?: string; eventId?: string }) {
    on();
    return this.simulateEvent(b.kind, b.type, b.providerRef, { error: b.error, amount: b.amount, eventId: b.eventId });
  }

  private async simulateEvent(kindIn: string, type: CanonicalEventType, providerRef: string, x: { error?: string; amount?: string; eventId?: string } = {}) {
    const kind = String(kindIn).toUpperCase() as ProviderKind;
    if (!WEBHOOK_KINDS.includes(kind)) throw new BadRequestException({ code: "UNKNOWN_KIND", kinds: WEBHOOK_KINDS });
    if (!EVENT_TYPES.includes(type) || !providerRef) throw new BadRequestException({ code: "BAD_EVENT", types: EVENT_TYPES });
    if (providerMode(kind) !== "mock") throw new ConflictException({ code: "SIMULATION_ONLY_IN_MOCK_MODE", message: `${kind}_MODE is real; the provider sends real callbacks` });
    const body = JSON.stringify({ id: x.eventId ?? `evt_sim_${randomUUID()}`, type, createdAt: new Date().toISOString(), data: { id: providerRef, ...(x.error ? { error: x.error } : {}), ...(x.amount ? { amount: x.amount } : {}) } });
    const result = await this.events.ingest(kind, body, signWebhook(webhookSecretFor(kind) ?? MOCK_WEBHOOK_SECRET, body));
    return { simulated: type, providerRef, ...result };
  }

  /**
   * Runs every demo flow in mock mode: result-ready (WhatsApp + email), critical alert SMS, invoice email, then delivery receipts for each;
   * then (unless { payments: false }) pay-by-link success -> receipt -> refund, and a failing link, on the first payable invoice.
   */
  @Post("demo/run") @Perm("settings.manage")
  async demo(@CurrentUser() u: AuthUser, @Body() b: { payments?: boolean } = {}) {
    on();
    const sends: { flow: string; channel: "SMS" | "EMAIL" | "WHATSAPP"; purpose: "RESULT_READY" | "CRITICAL_ALERT" | "BILLING"; to: string; templateId: string; params: Record<string, string | number> }[] = [
      { flow: "result-ready (WhatsApp)", channel: "WHATSAPP", purpose: "RESULT_READY", to: "+201000000001", templateId: "TODO_NEEDS_HUMAN_RESULT_READY", params: { orderNumber: "DEMO-0001", link: "http://localhost:5193/r/demo-token", locale: "en" } },
      { flow: "result-ready (email)", channel: "EMAIL", purpose: "RESULT_READY", to: "patient.demo@example.test", templateId: "TODO_NEEDS_HUMAN_RESULT_READY", params: { orderNumber: "DEMO-0001", link: "http://localhost:5193/r/demo-token", locale: "en" } },
      { flow: "critical alert (SMS)", channel: "SMS", purpose: "CRITICAL_ALERT", to: "+201000000002", templateId: "TODO_NEEDS_HUMAN_CRITICAL_ALERT", params: { orderNumber: "DEMO-0002", alertId: "demo", level: 1, locale: "en" } },
      { flow: "invoice email", channel: "EMAIL", purpose: "BILLING", to: "patient.demo@example.test", templateId: "TODO_NEEDS_HUMAN_INVOICE_EMAIL", params: { invoiceNumber: "INV-DEMO-1", total: "450.00", outstanding: "450.00", currency: "EGP", locale: "en" } },
    ];
    const messages: unknown[] = [];
    for (const s of sends) {
      const r = await this.messaging.send({ orgId: u.orgId, channel: s.channel, purpose: s.purpose, recipientRef: s.to, templateId: s.templateId, params: s.params, relatedType: "DemoFlow", relatedId: s.flow });
      const row = await this.prisma.notificationAttempt.findUniqueOrThrow({ where: { id: r.id } });
      let receipt: unknown = null;
      if (row.providerMessageId && row.status !== "FAILED" && providerMode(s.channel) === "mock") receipt = await this.simulateEvent(s.channel, "message.delivered", row.providerMessageId);
      messages.push({ flow: s.flow, notificationId: r.id, status: r.status, providerMessageId: row.providerMessageId, receipt });
    }
    const payments: Record<string, unknown> = {};
    if (b.payments !== false && providerMode("PAYMENT") === "mock") {
      const inv = await this.prisma.invoice.findFirst({ where: { orgId: u.orgId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { createdAt: "desc" } });
      if (!inv) payments.note = "no payable invoice in this organisation: create an invoice, then re-run";
      else {
        const ok = await this.payLinks.create(u, inv.id, { amount: 1, sendVia: undefined }, `demo-ok-${randomUUID()}`);
        payments.success = { linkId: ok.link.id, payUrl: ok.link.payUrl, paid: await this.simulateEvent("PAYMENT", "payment.succeeded", ok.link.providerRef!, { amount: "1.00" }) };
        payments.refund = await this.payLinks.refund(u, ok.link.id, { reason: "demo refund" });
        const bad = await this.payLinks.create(u, inv.id, { amount: 1 }, `demo-fail-${randomUUID()}`);
        payments.failure = { linkId: bad.link.id, result: await this.simulateEvent("PAYMENT", "payment.failed", bad.link.providerRef!, { error: "card_declined" }) };
        payments.invoice = inv.number;
      }
    }
    return { messages, payments };
  }
}
