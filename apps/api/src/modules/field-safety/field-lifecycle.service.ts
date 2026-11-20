import { ConflictException, HttpException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { HomeCollection, Prisma } from "@prisma/client";
import { type FieldVisit, type VisitEvent, applyEvent } from "@kiorly/field-visit";
import type { AuthUser } from "../../auth/auth.types";
import { PrismaService } from "../../prisma/prisma.service";
import { STATE_TO_STATUS, toFieldVisit } from "./field-visit-map";

export type Geo = { lat: number; lng: number; districtId?: string };

/**
 * KLORD04: persists the @kiorly/field-visit lifecycle (REQUESTED -> CONFIRMED -> ON_MY_WAY -> ARRIVED -> FINISHED, plus
 * ABORTED_UNSAFE / NO_SHOW / CANCELLED) on HomeCollection. SAFETY PATH (ADR-025): no feature flags, no entitlement checks.
 */
@Injectable()
export class FieldLifecycleService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Row lock so a safety tick and a collector's action never interleave. Returns the fresh row. */
  async lock(tx: Prisma.TransactionClient, orgId: string, id: string): Promise<HomeCollection> {
    await tx.$queryRaw`SELECT "id" FROM "HomeCollection" WHERE "id" = ${id} FOR UPDATE`;
    const hc = await tx.homeCollection.findFirst({ where: { id, orgId } });
    if (!hc) throw new NotFoundException({ code: "HOME_COLLECTION_NOT_FOUND" });
    return hc;
  }

  /** The collector in the field must be the assigned phlebotomist: nobody else departs, arrives, answers a prompt or presses SOS for them. */
  assertAssignedCollector(u: Pick<AuthUser, "staffId">, hc: Pick<HomeCollection, "phlebotomistId">) {
    if (!hc.phlebotomistId) throw new ConflictException({ code: "NOT_ASSIGNED", message: "assign a phlebotomist first" });
    if (hc.phlebotomistId !== u.staffId) throw new ConflictException({ code: "NOT_YOUR_COLLECTION" });
  }

  /** Applies a package event; returns the Prisma update data (status, history, timestamps) or throws the mapped HTTP error. */
  step(hc: HomeCollection, event: VisitEvent, now: Date): { data: Prisma.HomeCollectionUncheckedUpdateInput; visit: FieldVisit } {
    const res = applyEvent(toFieldVisit(hc), event, now.getTime());
    if (!res.ok) {
      switch (res.code) {
        case "GEOSTAMP_REQUIRED": throw new HttpException({ code: "GEOSTAMP_REQUIRED", message: "arrival needs a location stamp (check-in)" }, 422);
        case "REASON_REQUIRED": throw new HttpException({ code: "REASON_REQUIRED" }, 422);
        case "NO_SHOW_NOT_ALLOWED": throw new ConflictException({ code: "NO_SHOW_NOT_ALLOWED", message: "an unsafe abort is never a no-show (BR61)" });
        default: throw new ConflictException({ code: "ILLEGAL_HOME_COLLECTION_TRANSITION", from: hc.status, event: event.type });
      }
    }
    const v = res.visit;
    return {
      visit: v,
      data: {
        status: STATE_TO_STATUS[v.state],
        history: v.history as unknown as Prisma.InputJsonValue,
        ...(v.endedAtMs ? { endedAt: new Date(v.endedAtMs) } : {}),
        ...(event.type === "DEPART" ? { onMyWayAt: now, safetyState: {} } : {}),
        ...(event.type === "ARRIVE" ? { arrivedAt: now } : {}),
        ...(v.abortReason ? { abortReason: v.abortReason } : {}),
      },
    };
  }
}
