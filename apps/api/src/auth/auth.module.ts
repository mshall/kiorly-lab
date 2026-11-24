import { MePreferencesController } from "./me-preferences.controller";
import { Global, Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { PassportService } from "./passport.service";
import { PassportSessions } from "./passport-sessions.service";
import { PrismaHandoffStore } from "./handoff.store";
import { TokenService } from "./token.service";

@Global()
@Module({ controllers: [AuthController, MePreferencesController], providers: [PrismaHandoffStore, TokenService, PassportService, PassportSessions], exports: [TokenService, PassportService, PassportSessions] })
export class AuthModule {}
