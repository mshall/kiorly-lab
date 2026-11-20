import { Module } from "@nestjs/common";
import { OrdersModule } from "../orders/orders.module";
import { SpecimensModule } from "../specimens/specimens.module";
import { AppointmentsService } from "./appointments.service";
import { OrderEditService } from "./order-edit.service";
import { QueueService } from "./queue.service";
import { ReceptionController } from "./reception.controller";

/** M2 KLORD reception: appointments, queue/token board, audited order edits, ICD hints. */
@Module({ imports: [OrdersModule, SpecimensModule], controllers: [ReceptionController], providers: [AppointmentsService, QueueService, OrderEditService], exports: [QueueService] })
export class ReceptionModule {}
