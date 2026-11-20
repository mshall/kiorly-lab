import { Module } from "@nestjs/common";
import { DeliveryService } from "./delivery.service";
import { ReleaseController } from "./release.controller";
import { ReportsService } from "./reports.service";
import { TemplatesService } from "./templates.service";

/** KLCRIT02/03 + KLQC04/05 bounded context: signed report versions, consent-checked release, secure links, templates, delivery. SAFETY PATH: never flag-gated. */
@Module({ controllers: [ReleaseController], providers: [ReportsService, TemplatesService, DeliveryService], exports: [ReportsService, TemplatesService, DeliveryService] })
export class ReleaseModule {}
