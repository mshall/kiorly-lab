import { Module } from "@nestjs/common";
import { AnalysisQcModule } from "../analysis-qc/analysis-qc.module";
import { HistopathologyController } from "./histopathology.controller";
import { HistopathologyService } from "./histopathology.service";

/** M4 histopathology / cytology bounded context. */
@Module({ imports: [AnalysisQcModule], controllers: [HistopathologyController], providers: [HistopathologyService] })
export class HistopathologyModule {}
