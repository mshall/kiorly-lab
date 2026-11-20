import { Module } from "@nestjs/common";
import { BusinessModule } from "../business/business.module";
import { AnalyticsController } from "./analytics.controller";
import { ReportsService } from "./reports.service";

/** M9 analytics: workload, TAT, positivity, revenue per test/referrer/branch/payer, quality and inventory statistics. */
@Module({ imports: [BusinessModule], controllers: [AnalyticsController], providers: [ReportsService] })
export class AnalyticsModule {}
