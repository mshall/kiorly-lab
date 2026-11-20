import { Module } from "@nestjs/common";
import { FieldLifecycleService } from "./field-lifecycle.service";
import { FieldSafetyController } from "./field-safety.controller";
import { FieldSafetyService } from "./field-safety.service";

/** KLORD04 safety path: lifecycle persistence, safety timer, SOS and unsafe-abort for phlebotomists (never flags). */
@Module({ controllers: [FieldSafetyController], providers: [FieldLifecycleService, FieldSafetyService], exports: [FieldLifecycleService, FieldSafetyService] })
export class FieldSafetyModule {}
