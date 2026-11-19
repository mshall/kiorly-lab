import { Global, Module } from "@nestjs/common";
import { EntitlementGuard } from "./entitlement.guard";
import { LocalEntitlements, LocalLedger, LocalPriceBook } from "./local-kernel";
import { KERNEL_ENTITLEMENTS, KERNEL_LEDGER, KERNEL_PRICE_BOOK } from "./ports";

/** Swap these three providers for @kiorly/commerce-kernel when it is published (NH-LB-022). */
@Global()
@Module({
  providers: [
    { provide: KERNEL_ENTITLEMENTS, useClass: LocalEntitlements },
    { provide: KERNEL_PRICE_BOOK, useClass: LocalPriceBook },
    { provide: KERNEL_LEDGER, useClass: LocalLedger },
    EntitlementGuard,
  ],
  exports: [KERNEL_ENTITLEMENTS, KERNEL_PRICE_BOOK, KERNEL_LEDGER, EntitlementGuard],
})
export class KernelModule {}
