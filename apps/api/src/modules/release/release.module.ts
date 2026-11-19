import { Module } from "@nestjs/common";
import { ReleaseController } from "./release.controller";
import { ReportsService } from "./reports.service";

/** KLCRIT02/03 + KLQC04/05 bounded context: signed report versions, consent-checked release, secure links. SAFETY PATH: never flag-gated. */
@Module({ controllers: [ReleaseController], providers: [ReportsService], exports: [ReportsService] })
export class ReleaseModule {}
