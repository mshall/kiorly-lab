import { Module } from "@nestjs/common";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { CriticalController } from "./critical.controller";
import { CriticalService } from "./critical.service";

/** KLCRIT01 bounded context. SAFETY PATH: never flag-gated (ADR-025). */
@Module({ imports: [CatalogueModule], controllers: [CriticalController], providers: [CriticalService], exports: [CriticalService] })
export class CriticalModule {}
