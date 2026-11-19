import { Global, Module } from "@nestjs/common";
import { MessagingAdapter } from "./messaging.adapter";
import { PspAdapter } from "./psp.adapter";
import { StorageAdapter } from "./storage.adapter";

@Global()
@Module({ providers: [MessagingAdapter, StorageAdapter, PspAdapter], exports: [MessagingAdapter, StorageAdapter, PspAdapter] })
export class AdaptersModule {}
