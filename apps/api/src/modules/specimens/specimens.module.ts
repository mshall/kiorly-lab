import { Module } from "@nestjs/common";
import { CustodyService } from "./custody.service";
import { SpecimensController } from "./specimens.controller";
import { SpecimensService } from "./specimens.service";

/** KLSPC bounded context. SAFETY PATH: never flag-gated (ADR-025). */
@Module({ controllers: [SpecimensController], providers: [SpecimensService, CustodyService], exports: [SpecimensService, CustodyService] })
export class SpecimensModule {}
