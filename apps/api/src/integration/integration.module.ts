import { Module } from "@nestjs/common";
import { OrdersModule } from "../modules/orders/orders.module";
import { ReleaseModule } from "../modules/release/release.module";
import { FlagWebhookController } from "./flag-webhook.controller";
import { IntegrationAuthService } from "./integration-auth.service";
import { IntegrationCatalogueService } from "./integration-catalogue.service";
import { IntegrationController } from "./integration.controller";

@Module({ imports: [OrdersModule, ReleaseModule], controllers: [IntegrationController, FlagWebhookController], providers: [IntegrationAuthService, IntegrationCatalogueService] })
export class IntegrationModule {}
