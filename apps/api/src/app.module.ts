import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AdaptersModule } from "./adapters/adapters.module";
import { AuditInterceptor } from "./audit/audit.interceptor";
import { AuditModule } from "./audit/audit.module";
import { AuthGuard } from "./auth/auth.guard";
import { AuthModule } from "./auth/auth.module";
import { CoreModule } from "./common/core.module";
import { ZodInterceptor } from "./common/zod";
import { FeatureFlagsModule } from "./feature-flags/feature-flags.module";
import { RequiresFlagGuard } from "./feature-flags/requires-flag.guard";
import { HealthModule } from "./health/health.module";
import { IntegrationModule } from "./integration/integration.module";
import { EntitlementGuard } from "./kernel-adapter/entitlement.guard";
import { KernelModule } from "./kernel-adapter/kernel.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AnalysisQcModule } from "./modules/analysis-qc/analysis-qc.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { AnalyzersModule } from "./modules/analyzers/analyzers.module";
import { BusinessModule } from "./modules/business/business.module";
import { ProvidersModule } from "./providers/providers.module";
import { CatalogueModule } from "./modules/catalogue/catalogue.module";
import { CriticalModule } from "./modules/critical/critical.module";
import { FieldSafetyModule } from "./modules/field-safety/field-safety.module";
import { HistopathologyModule } from "./modules/histopathology/histopathology.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { MicrobiologyModule } from "./modules/microbiology/microbiology.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { PreanalyticsModule } from "./modules/preanalytics/preanalytics.module";
import { QualityModule } from "./modules/quality/quality.module";
import { ReceptionModule } from "./modules/reception/reception.module";
import { RegistryModule } from "./modules/registry/registry.module";
import { ReleaseModule } from "./modules/release/release.module";
import { SpecimensModule } from "./modules/specimens/specimens.module";
import { MobileGuard } from "./modules/mobile/mobile.guard";
import { MobileModule } from "./modules/mobile/mobile.module";
import { MobileAlertsModule } from "./modules/mobile-alerts/mobile-alerts.module";
import { OutboxModule } from "./outbox/outbox.module";
import { PrismaModule } from "./prisma/prisma.module";

@Module({
  imports: [
    PrismaModule, AuthModule, AuditModule, OutboxModule, AdaptersModule, KernelModule, CoreModule, FeatureFlagsModule, HealthModule,
    AdminModule, CatalogueModule, OrdersModule, SpecimensModule, AnalysisQcModule, AnalyzersModule, CriticalModule, FieldSafetyModule, ReleaseModule, BusinessModule, ProvidersModule, RegistryModule, ReceptionModule, PreanalyticsModule, MicrobiologyModule, HistopathologyModule, QualityModule, InventoryModule, AnalyticsModule, MobileAlertsModule, MobileModule, IntegrationModule,
  ],
  providers: [
    // order matters: authenticate first, then flag, then plan entitlement
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RequiresFlagGuard },
    { provide: APP_GUARD, useClass: EntitlementGuard },
    // Kiorly Work: device binding (401 DEVICE_REVOKED) + mobile_staff_app entitlement (403 FEATURE_DISABLED)
    { provide: APP_GUARD, useClass: MobileGuard },
    { provide: APP_INTERCEPTOR, useClass: ZodInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
