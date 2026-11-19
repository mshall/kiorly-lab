import { Module } from "@nestjs/common";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { CriticalModule } from "../critical/critical.module";
import { AnalysisQcController } from "./analysis-qc.controller";
import { QcService } from "./qc.service";
import { ResultsService } from "./results.service";

/** KLQC bounded context: instruments, QC (Westgard), results, validation. SAFETY PATH: never flag-gated (ADR-025). */
@Module({ imports: [CatalogueModule, CriticalModule], controllers: [AnalysisQcController], providers: [QcService, ResultsService], exports: [QcService, ResultsService] })
export class AnalysisQcModule {}
