import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module";
import { MobileAlertsModule } from "../mobile-alerts/mobile-alerts.module";
import { MobileEntitlementService } from "./mobile-entitlement.service";
import { MobileController } from "./mobile.controller";
import { MobileGuard } from "./mobile.guard";
import { MobileUpgradeService } from "./mobile-upgrade.service";
import { MobileService } from "./mobile.service";

/** Kiorly Team (staff mobile app) backend: bootstrap, entitlement `mobile_staff_app`, device-bound tokens, mock push inbox, scan/search/summary. */
@Module({ imports: [InventoryModule, MobileAlertsModule], controllers: [MobileController], providers: [MobileService, MobileUpgradeService, MobileEntitlementService, MobileGuard], exports: [MobileEntitlementService, MobileGuard, MobileService] })
export class MobileModule {}
