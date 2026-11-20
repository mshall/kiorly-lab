import { Inject, Injectable } from "@nestjs/common";
import type { CustodyEventType } from "../../generated/prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import type { Db } from "../../common/db";

/** KLSPC03: the ONLY writer of CustodyEvent rows. Table is append-only at the DB (trigger forbids UPDATE/DELETE). */
@Injectable()
export class CustodyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  append(db: Db, e: { orgId: string; specimenId: string; type: CustodyEventType; actorId: string; location?: string; temperatureC?: number; note?: string; at?: Date }) {
    return db.custodyEvent.create({
      data: { orgId: e.orgId, specimenId: e.specimenId, type: e.type, actorId: e.actorId, location: e.location, temperatureC: e.temperatureC, note: e.note, occurredAt: e.at ?? new Date() },
    });
  }

  list(orgId: string, specimenId: string) {
    return this.prisma.custodyEvent.findMany({ where: { orgId, specimenId }, orderBy: { occurredAt: "asc" } });
  }
}
