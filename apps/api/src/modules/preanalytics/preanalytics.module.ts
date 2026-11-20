import { Module } from "@nestjs/common";
import { SpecimensModule } from "../specimens/specimens.module";
import { ManifestsService } from "./manifests.service";
import { PreanalyticsController } from "./preanalytics.controller";
import { RecollectionsService } from "./recollections.service";
import { StorageService } from "./storage.service";

/** M3 KLSPC: storage/retention/disposal, recollection requests, transport manifests and courier tracking. SAFETY PATH. */
@Module({ imports: [SpecimensModule], controllers: [PreanalyticsController], providers: [StorageService, ManifestsService, RecollectionsService] })
export class PreanalyticsModule {}
