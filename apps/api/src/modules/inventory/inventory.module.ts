import { Module } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { InventoryService } from "./inventory.service";

/** M6 KLINV inventory: reagents/consumables, lots + expiry, FEFO consumption per test run, suppliers, POs, GRN, stock counts, cost per test. */
@Module({ controllers: [InventoryController], providers: [InventoryService], exports: [InventoryService] })
export class InventoryModule {}
