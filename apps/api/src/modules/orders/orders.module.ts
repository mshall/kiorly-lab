import { Module } from "@nestjs/common";
import { SpecimensModule } from "../specimens/specimens.module";
import { HomeCollectionService } from "./home-collection.service";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
import { PatientsService } from "./patients.service";

/** KLORD bounded context: orders, patients, consent, home collection. */
@Module({ imports: [SpecimensModule], controllers: [OrdersController], providers: [OrdersService, PatientsService, HomeCollectionService], exports: [OrdersService, PatientsService] })
export class OrdersModule {}
