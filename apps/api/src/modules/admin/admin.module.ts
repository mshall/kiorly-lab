import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { StarterCatalogueService } from "./starter-catalogue.service";

/** Auth session endpoints, onboarding, staff/RBAC, labs, settings, audit viewer, dev inbox, integration clients. */
@Module({ controllers: [AdminController], providers: [AdminService, StarterCatalogueService], exports: [StarterCatalogueService] })
export class AdminModule {}
