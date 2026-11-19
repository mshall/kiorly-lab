import { Module } from "@nestjs/common";
import { AnalysisQcModule } from "../analysis-qc/analysis-qc.module";
import { AnalyzerIngestService } from "./analyzer-ingest.service";
import { AnalyzerSimulatorService, MockAnalyzerTransport } from "./analyzer-simulator.service";
import { AnalyzersController } from "./analyzers.controller";

/** KLQC01 analyzer connectivity (flag lab.analyzer_interfaces). */
@Module({ imports: [AnalysisQcModule], controllers: [AnalyzersController], providers: [AnalyzerIngestService, AnalyzerSimulatorService, MockAnalyzerTransport], exports: [AnalyzerIngestService, AnalyzerSimulatorService] })
export class AnalyzersModule {}
