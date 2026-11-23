import { Module } from "@nestjs/common";
import { CriticalModule } from "../critical/critical.module";
import { MobileAlertsController } from "./mobile-alerts.controller";
import { MobileAlertsService } from "./mobile-alerts.service";

/** Kiorly safety-alert inbox. SAFETY PATH: never flag-gated and never entitlement-gated (ADR-025). */
@Module({ imports: [CriticalModule], controllers: [MobileAlertsController], providers: [MobileAlertsService], exports: [MobileAlertsService] })
export class MobileAlertsModule {}
