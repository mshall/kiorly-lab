import { Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BILLING_CHARGE, billingChargeFromEnv } from "./billing.port";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";

/** SUB-01: idempotent pass every 6 hours (safe to run many times a day, concurrently). Off in tests and when JOBS_ENABLED=false. */
@Injectable()
export class SubscriptionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SubscriptionScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  constructor(@Inject(SubscriptionService) private readonly subs: SubscriptionService) {}
  onModuleInit() {
    if (process.env.JOBS_ENABLED === "false" || process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.subs.runDaily().catch((e) => this.log.warn(String(e))), 6 * 60 * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
}

@Module({
  controllers: [SubscriptionController],
  providers: [{ provide: BILLING_CHARGE, useFactory: () => billingChargeFromEnv() }, SubscriptionService, SubscriptionScheduler],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
