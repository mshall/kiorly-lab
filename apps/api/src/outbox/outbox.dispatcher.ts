import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { appConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import { WebhookTransport } from "./webhook-transport";

const MAX_ATTEMPTS = 10;

/** At-least-once delivery with exponential backoff. Receivers de-duplicate on eventId. */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(OutboxDispatcher.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WebhookTransport) readonly transport: WebhookTransport,
  ) {}

  onModuleInit() {
    if (appConfig.timersEnabled()) {
      this.timer = setInterval(() => void this.dispatchDue().catch((e) => this.log.warn(`outbox sweep failed: ${(e as Error).message}`)), 10_000);
      this.timer.unref();
    }
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchDue(now = new Date(), limit = 50): Promise<{ sent: number; failed: number }> {
    const rows = await this.prisma.outboxEvent.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: now } }, orderBy: { occurredAt: "asc" }, take: limit });
    let sent = 0;
    let failed = 0;
    for (const r of rows) {
      const res = await this.transport.deliver({ orgId: r.orgId, body: JSON.stringify(r.payload), eventId: r.id, eventType: r.type });
      if (res.ok) {
        await this.prisma.outboxEvent.update({ where: { id: r.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
        sent++;
      } else {
        const attempts = r.attempts + 1;
        await this.prisma.outboxEvent.update({
          where: { id: r.id },
          data: {
            attempts,
            lastError: res.error ?? `HTTP ${res.status}`,
            status: attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING",
            nextAttemptAt: new Date(now.getTime() + Math.min(2 ** attempts * 5_000, 15 * 60_000)),
          },
        });
        failed++;
      }
    }
    return { sent, failed };
  }
}
