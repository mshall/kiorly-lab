import { Module } from "@nestjs/common";
import { BusinessModule } from "../modules/business/business.module";
import { DevProvidersController } from "./dev-providers.controller";
import { ProviderEventsService } from "./provider-events.service";
import { ProviderWebhooksController } from "./provider-webhooks.controller";

/** Provider callbacks (signed webhooks) + dev-only simulator. Messaging/PSP ports live in src/adapters (AdaptersModule). */
@Module({ imports: [BusinessModule], controllers: [ProviderWebhooksController, DevProvidersController], providers: [ProviderEventsService], exports: [ProviderEventsService] })
export class ProvidersModule {}
