import { Module } from "@nestjs/common";
import { ReleaseModule } from "../release/release.module";
import { PatientRegistryService } from "./patient-registry.service";
import { ReferrersService } from "./referrers.service";
import { RegistryController } from "./registry.controller";

/** M1 KLPAT: standalone patient registry, referrers directory, commission/credit accounts, doctor portal. */
@Module({ imports: [ReleaseModule], controllers: [RegistryController], providers: [PatientRegistryService, ReferrersService], exports: [PatientRegistryService, ReferrersService] })
export class RegistryModule {}
