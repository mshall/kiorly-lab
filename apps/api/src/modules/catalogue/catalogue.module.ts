import { Module } from "@nestjs/common";
import { CatalogueController } from "./catalogue.controller";
import { CatalogueImportService } from "./catalogue-import.service";
import { CatalogueService } from "./catalogue.service";

@Module({ controllers: [CatalogueController], providers: [CatalogueService, CatalogueImportService], exports: [CatalogueService] })
export class CatalogueModule {}
