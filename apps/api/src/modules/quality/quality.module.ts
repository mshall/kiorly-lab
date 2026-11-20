import { Module } from "@nestjs/common";
import { QualityController } from "./quality.controller";
import { QualityService } from "./quality.service";

/** M5 KLQM quality management: QC lots/statistics, calibration, EQA, maintenance, NCR/CAPA, document control. */
@Module({ controllers: [QualityController], providers: [QualityService], exports: [QualityService] })
export class QualityModule {}
