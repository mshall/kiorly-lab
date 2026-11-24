import { Module } from "@nestjs/common";
import { OrdersModule } from "../modules/orders/orders.module";
import { ReleaseModule } from "../modules/release/release.module";
import { FlagWebhookController } from "./flag-webhook.controller";
import { IntegrationAuthService } from "./integration-auth.service";
import { IntegrationCatalogueService } from "./integration-catalogue.service";
import { IntegrationController } from "./integration.controller";
import { KiorexConnectController } from "./kiorex-connect.controller";
import { KiorexConnectService } from "./kiorex-connect.service";
import { KiorexFrontDoorController } from "./kiorex-front-door.controller";
import { KiorexFrontDoorService } from "./kiorex-front-door.service";

@Module({ imports: [OrdersModule, ReleaseModule], controllers: [IntegrationController, FlagWebhookController, KiorexConnectController, KiorexFrontDoorController], providers: [IntegrationAuthService, IntegrationCatalogueService, KiorexConnectService, KiorexFrontDoorService] })
export class IntegrationModule {}
