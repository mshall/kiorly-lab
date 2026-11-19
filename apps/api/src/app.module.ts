import { Module } from "@nestjs/common";
import { FeatureFlagsModule } from "./feature-flags/feature-flags.module";
import { HealthModule } from "./health/health.module";
import { PrismaModule } from "./prisma/prisma.module";
import { OrdersModule } from "./modules/orders/orders.module";
import { SpecimensModule } from "./modules/specimens/specimens.module";
import { AnalysisQcModule } from "./modules/analysis-qc/analysis-qc.module";
import { ReleaseModule } from "./modules/release/release.module";
import { BusinessModule } from "./modules/business/business.module";

@Module({
  imports: [
    PrismaModule,
    FeatureFlagsModule,
    HealthModule,
    OrdersModule,
    SpecimensModule,
    AnalysisQcModule,
    ReleaseModule,
    BusinessModule,
  ],
})
export class AppModule {}
