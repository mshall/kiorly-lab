import { Module } from "@nestjs/common";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { BillingService } from "./billing.service";
import { BusinessController } from "./business.controller";
import { ExportsService } from "./exports.service";
import { InsightsService } from "./insights.service";

/** KLBIZ bounded context: price lists, B2B, invoices (VAT lines only), payments (mock PSP), cash close, TAT, exports. */
@Module({ imports: [CatalogueModule], controllers: [BusinessController], providers: [BillingService, InsightsService, ExportsService], exports: [BillingService, InsightsService] })
export class BusinessModule {}
