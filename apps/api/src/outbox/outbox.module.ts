import { Global, Module } from "@nestjs/common";
import { OutboxDispatcher } from "./outbox.dispatcher";
import { OutboxService } from "./outbox.service";
import { WebhookTransport } from "./webhook-transport";

@Global()
@Module({ providers: [OutboxService, OutboxDispatcher, WebhookTransport], exports: [OutboxService, OutboxDispatcher, WebhookTransport] })
export class OutboxModule {}
