import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { validateEvent } from "@kiorex/contracts";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import type { Db } from "../common/db";

/** Event types this product emits. LabResultReleased and the provider-link registry events (ReferralLinkCreated, ReferralLinkRevoked, 1.12.0 `product` LAB, GRW-P4-B1) are published contracts (kiorex-contracts); the rest are local drafts (see Docs/NEEDS_HUMAN NH-LB-025). */
export const LOCAL_EVENT_TYPES = ["LabOrderCreated", "LabOrderStatusChanged", "LabCriticalEscalated", "LabReportCorrected", "LabInvoiceIssued", "LabPaymentRecorded"] as const;
export const CONTRACT_EVENT_TYPES = ["LabResultReleased", "ReferralLinkCreated", "ReferralLinkRevoked"] as const;

export interface EnqueueInput {
  orgId: string;
  type: (typeof CONTRACT_EVENT_TYPES)[number] | (typeof LOCAL_EVENT_TYPES)[number];
  aggregateType: string;
  aggregateId: string;
  data: Record<string, unknown>;
  /** Deterministic id => replayed enqueues collapse (idempotent). */
  eventId?: string;
}

/**
 * Transactional outbox (ADR-006/KX-09): rows are written in the SAME transaction as the state change.
 * Contract events are validated against @kiorex/contracts schemas BEFORE being stored, so an invalid event aborts the transaction.
 * Payloads never contain raw result values (KLCRIT03) — enforced by the LabResultReleased schema (`values`/`results` forbidden).
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  static buildEnvelope(id: string, e: EnqueueInput, occurredAt: Date) {
    return { eventId: id, type: e.type, aggregateType: e.aggregateType, aggregateId: e.aggregateId, target: "KIOREX", occurredAt: occurredAt.toISOString(), data: e.data };
  }

  async enqueue(e: EnqueueInput, db: Db = this.prisma): Promise<string> {
    const occurredAt = new Date();
    const id = e.eventId ?? `evt_${randomUUID().replace(/-/g, "")}`;
    const envelope = OutboxService.buildEnvelope(id, e, occurredAt);
    if ((CONTRACT_EVENT_TYPES as readonly string[]).includes(e.type)) {
      const v = validateEvent(e.type, envelope);
      if (!v.valid) throw new BadRequestException({ code: "EVENT_CONTRACT_VIOLATION", errors: v.errors });
    } else {
      for (const k of ["eventId", "type", "aggregateType", "aggregateId", "occurredAt", "data"] as const) {
        if (!envelope[k]) throw new BadRequestException({ code: "EVENT_ENVELOPE_INVALID", field: k });
      }
    }
    // standalone tenants talk to no external service: the event is validated (same code path) but never stored
    const mode = await db.tenant.findUnique({ where: { id: e.orgId }, select: { integrationMode: true } });
    if (mode?.integrationMode === "STANDALONE") return id;
    const existing = await db.outboxEvent.findUnique({ where: { id } });
    if (existing) return existing.id;
    await db.outboxEvent.create({
      data: { id, orgId: e.orgId, type: e.type, aggregateType: e.aggregateType, aggregateId: e.aggregateId, payload: envelope as unknown as Prisma.InputJsonValue, occurredAt },
    });
    return id;
  }
}
