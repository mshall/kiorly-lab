import { Module } from "@nestjs/common";
import { FieldSafetyModule } from "../field-safety/field-safety.module";
import { SpecimensModule } from "../specimens/specimens.module";
import { HomeCollectionService } from "./home-collection.service";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { PatientsService } from "./patients.service";

/** KLORD bounded context: orders, patients, consent, home collection. */
@Module({ imports: [SpecimensModule, FieldSafetyModule], controllers: [OrdersController], providers: [OrdersService, PatientsService, HomeCollectionService], exports: [OrdersService, PatientsService] })
export class OrdersModule {}
