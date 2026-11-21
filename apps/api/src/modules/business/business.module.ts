import { Module } from "@nestjs/common";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { RegistryModule } from "../registry/registry.module";
import { PayLinksService } from "./paylinks.service";
import { BillingService } from "./billing.service";
import { BusinessController } from "./business.controller";
import { FinanceService } from "./finance.service";
import { ExportsService } from "./exports.service";
import { InsightsService } from "./insights.service";

/** KLBIZ bounded context: price lists, B2B, invoices (VAT lines only), payments (mock PSP), cash close, TAT, exports. */
@Module({ imports: [CatalogueModule, RegistryModule], controllers: [BusinessController], providers: [BillingService, PayLinksService, InsightsService, ExportsService, FinanceService], exports: [BillingService, PayLinksService, InsightsService, FinanceService] })
export class BusinessModule {}
