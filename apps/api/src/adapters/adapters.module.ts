import { Global, Module } from "@nestjs/common";
import { MobilePushService } from "./mobile-push.adapter";
import { MessagingAdapter } from "./messaging.adapter";
import { PspAdapter } from "./psp.adapter";
import { StorageAdapter } from "./storage.adapter";

@Global()
@Module({ providers: [MobilePushService, MessagingAdapter, StorageAdapter, PspAdapter], exports: [MobilePushService, MessagingAdapter, StorageAdapter, PspAdapter] })
export class AdaptersModule {}
