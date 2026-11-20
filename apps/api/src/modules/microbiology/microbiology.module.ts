import { Module } from "@nestjs/common";
import { AnalysisQcModule } from "../analysis-qc/analysis-qc.module";
import { MicrobiologyController } from "./microbiology.controller";
import { MicrobiologyService } from "./microbiology.service";

/** M4 microbiology bounded context (culture & sensitivity). */
@Module({ imports: [AnalysisQcModule], controllers: [MicrobiologyController], providers: [MicrobiologyService], exports: [MicrobiologyService] })
export class MicrobiologyModule {}
