import { Global, Module } from "@nestjs/common";
import { IdempotencyService } from "./idempotency";
import { OrderStatusService } from "./order-status.service";

@Global()
@Module({ providers: [OrderStatusService, IdempotencyService], exports: [OrderStatusService, IdempotencyService] })
export class CoreModule {}
