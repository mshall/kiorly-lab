import { ConflictException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { HomeCollection, Prisma, SafetyAlert as SafetyAlertRow } from "@prisma/client";
import { type SafetyAlert, type SafetyState, EGYPT_EMERGENCY_NUMBERS, answerSafetyPrompt, buildSafetyAlert, buildSos, deliverSafetyAlert, evaluateSafety } from "@kiorly/field-visit";
import { MessagingAdapter } from "../../adapters/messaging.adapter";
import { AuditService } from "../../audit/audit.service";
import type { AuthUser } from "../../auth/auth.types";
import { appConfig } from "../../config/app-config";
import { PrismaService } from "../../prisma/prisma.service";
import { FIELD_STATUSES, toFieldVisit } from "./field-visit-map";
import { type Geo, FieldLifecycleService } from "./field-lifecycle.service";
import { labSafetyDispatchers } from "./lab-safety-dispatchers";

/** Category-only reasons for "Leave visit - unsafe" (no free text, no PHI; mirrors kiorex-contracts HOME_VISIT_ABORTED_UNSAFE). */
export const UNSAFE_REASONS = ["THREAT_OR_AGGRESSION", "UNSAFE_ENVIRONMENT", "ANIMAL", "OTHER"] as const;
export type UnsafeReason = (typeof UNSAFE_REASONS)[number];

const TICK_MS = 10_000; // the package SLA budget assumes a tick <= 15 s

/**
 * HVSAF01/02 + BR61 for phlebotomists (KLORD04). SAFETY PATH, never a flag (ADR-025): no feature flag, no entitlement, no tenant switch,
 * no env switch (the timer runs in every environment except NODE_ENV=test, where `tick(now)` is driven explicitly).
 * Protocol constants (30 min prompt, 10 min answer window, 60 s delivery SLA, 123 / 122) live in @kiorly/field-visit.
 */
@Injectable()
export class FieldSafetyService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FieldSafetyService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MessagingAdapter) private readonly messaging: MessagingAdapter,
    @Inject(FieldLifecycleService) private readonly lifecycle: FieldLifecycleService,
  ) {}

  onModuleInit() {
    if (appConfig.isTest()) return;
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(`safety tick failed: ${(e as Error).message}`)), TICK_MS);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The organisation safety contact is mandatory before a collector leaves (fails closed). */
  async requireContact(orgId: string): Promise<{ name: string | null; phone: string }> {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId }, select: { safetyContactName: true, safetyContactPhone: true } });
    if (!t.safetyContactPhone) throw new ConflictException({ code: "SAFETY_CONTACT_REQUIRED", message: "set the organisation safety contact (Settings) before home collections can start" });
    return { name: t.safetyContactName, phone: t.safetyContactPhone };
  }

  // ------------------------------------------------------------ timer
  /** Sweeps every collector in the field. Idempotent: each prompt/alert fires once; undelivered alerts are retried each tick. */
  async tick(nowMs = Date.now()): Promise<{ prompts: number; alerts: number; retried: number }> {
    const t0 = Date.now();
    const clock = () => nowMs + (Date.now() - t0);
    const rows = await this.prisma.homeCollection.findMany({ where: { status: { in: [...FIELD_STATUSES] } }, select: { id: true, orgId: true } });
    let prompts = 0;
    let alerts = 0;
    const fresh = new Set<string>();
    for (const r of rows) {
      try {
        const out = await this.evaluateOne(r.orgId, r.id, nowMs, clock);
        prompts += out.prompts;
        alerts += out.alerts.length;
        for (const id of out.alerts) fresh.add(id);
      } catch (e) {
        this.log.error(`safety evaluation failed for ${r.id}: ${(e as Error).message}`);
      }
    }
    const retried = await this.retryUndelivered(clock, fresh);
    return { prompts, alerts, retried };
  }

  private async evaluateOne(orgId: string, id: string, nowMs: number, clock: () => number) {
    const created: { row: SafetyAlertRow; hc: HomeCollection }[] = [];
    let prompts = 0;
    let promptTo: string | null = null;
    await this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, orgId, id);
      if (!FIELD_STATUSES.includes(hc.status)) return;
      const ev = evaluateSafety(toFieldVisit(hc), (hc.safetyState ?? {}) as SafetyState, nowMs);
      if (!ev.actions.length) return;
      await tx.homeCollection.update({ where: { id }, data: { safetyState: ev.state as unknown as Prisma.InputJsonValue } });
      for (const a of ev.actions) {
        if (a.type === "PROMPT_CLINICIAN") {
          prompts++;
          promptTo = hc.phlebotomistId;
          await this.audit.record({ orgId, actorId: null, action: "safety.prompt", entityType: "HomeCollection", entityId: id }, tx);
        } else {
          const last = [...toFieldVisit(hc).history].reverse().find((h) => h.geostamp)?.geostamp;
          const row = await tx.safetyAlert.create({ data: { orgId, homeCollectionId: id, kind: "NO_ANSWER", dueAt: new Date(a.dueAtMs), lastGeostamp: (last ?? undefined) as Prisma.InputJsonValue | undefined } });
          await this.audit.record({ orgId, actorId: null, action: "safety.alert", entityType: "SafetyAlert", entityId: row.id, meta: { kind: "NO_ANSWER" } }, tx);
          created.push({ row, hc });
        }
      }
    });
    if (prompts && promptTo) {
      await this.messaging.send({ orgId, channel: "PUSH", purpose: "SAFETY_ALERT", recipientRef: promptTo, templateId: "TODO_NEEDS_HUMAN_SAFETY_PROMPT", params: { kind: "PROMPT", collection: id }, relatedType: "HomeCollection", relatedId: id }).catch(() => undefined);
    }
    for (const c of created) await this.deliver(c.row, undefined, clock);
    return { prompts, alerts: created.map((c) => c.row.id) };
  }

  /** Delivers a persisted alert row through the dispatchers and records the outcome (an undelivered alert is an incident: retried every tick). */
  private async deliver(row: SafetyAlertRow, liveLocation: { lat: number; lng: number } | undefined, clock: () => number): Promise<boolean> {
    const hc = await this.prisma.homeCollection.findUniqueOrThrow({ where: { id: row.homeCollectionId } });
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: row.orgId }, select: { safetyContactPhone: true } });
    let result: Awaited<ReturnType<typeof deliverSafetyAlert>>;
    if (!tenant.safetyContactPhone) {
      result = { delivered: false, attempts: [{ channel: "NONE", ok: false, error: "SAFETY_CONTACT_REQUIRED" }], latencyMs: Math.max(0, clock() - row.dueAt.getTime()), withinSla: false };
    } else {
      const alert: SafetyAlert = {
        ...buildSafetyAlert({ kind: row.kind, visit: { id: hc.id, history: toFieldVisit(hc).history }, contactId: `${row.orgId}:safety-contact`, nowMs: row.raisedAt.getTime(), liveLocation }),
        emergencyNumbers: { ...EGYPT_EMERGENCY_NUMBERS },
      };
      result = await deliverSafetyAlert(alert, labSafetyDispatchers(this.messaging, row.orgId, tenant.safetyContactPhone, clock), row.dueAt.getTime(), clock);
    }
    const prev = (Array.isArray(row.attempts) ? row.attempts : []) as unknown[];
    await this.prisma.safetyAlert.update({
      where: { id: row.id },
      data: {
        delivered: result.delivered, deliveredAt: result.delivered ? new Date() : null, latencyMs: Math.min(Math.round(result.latencyMs), 2_147_483_647), withinSla: result.withinSla,
        attempts: [...prev, ...result.attempts] as unknown as Prisma.InputJsonValue,
      },
    });
    if (!result.delivered) this.log.error(`SAFETY INCIDENT: alert ${row.id} (${row.kind}) not delivered`);
    return result.delivered;
  }

  private async retryUndelivered(clock: () => number, skip: ReadonlySet<string>): Promise<number> {
    const pending = await this.prisma.safetyAlert.findMany({ where: { delivered: false, id: { notIn: [...skip] } }, orderBy: { raisedAt: "asc" }, take: 50 });
    let ok = 0;
    for (const row of pending) if (await this.deliver(row, undefined, clock).catch(() => false)) ok++;
    return ok;
  }

  // ------------------------------------------------- collector actions
  /** "I'm OK": answers the prompt; the timer re-arms for another period (the collector is still on site). */
  async answer(u: AuthUser, id: string, nowMs = Date.now()) {
    return this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, u.orgId, id);
      this.lifecycle.assertAssignedCollector(u, hc);
      if (!FIELD_STATUSES.includes(hc.status)) throw new ConflictException({ code: "NOT_IN_FIELD", from: hc.status });
      const state = answerSafetyPrompt((hc.safetyState ?? {}) as SafetyState, nowMs);
      await tx.homeCollection.update({ where: { id }, data: { safetyState: state as unknown as Prisma.InputJsonValue } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "safety.answer", entityType: "HomeCollection", entityId: id }, tx);
      return { id, answeredAt: new Date(nowMs).toISOString() };
    });
  }

  /** HVSAF02: one-tap SOS. Live location goes to the safety contact (delivered, never stored); the app shows 123 / 122. */
  async sos(u: AuthUser, id: string, live: { lat: number; lng: number }) {
    await this.requireContact(u.orgId);
    const row = await this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, u.orgId, id);
      this.lifecycle.assertAssignedCollector(u, hc);
      if (!FIELD_STATUSES.includes(hc.status)) throw new ConflictException({ code: "NOT_IN_FIELD", from: hc.status });
      const last = [...toFieldVisit(hc).history].reverse().find((h) => h.geostamp)?.geostamp;
      const r = await tx.safetyAlert.create({ data: { orgId: u.orgId, homeCollectionId: id, kind: "SOS", dueAt: new Date(), lastGeostamp: (last ?? undefined) as Prisma.InputJsonValue | undefined } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "safety.sos", entityType: "SafetyAlert", entityId: r.id }, tx);
      return r;
    });
    const hc = await this.prisma.homeCollection.findUniqueOrThrow({ where: { id } });
    const { show } = buildSos({ visit: { id, history: toFieldVisit(hc).history }, contactId: `${u.orgId}:safety-contact`, nowMs: Date.now(), liveLocation: live });
    const t0 = Date.now();
    const delivered = await this.deliver(row, live, () => Date.now() + (Date.now() - t0));
    return { alertId: row.id, delivered, show };
  }

  /** BR61 "Leave visit - unsafe": ends the visit, never a no-show, alerts the safety contact, holds nothing against the patient or the collector. */
  async abortUnsafe(u: AuthUser, id: string, reason: UnsafeReason, geostamp?: Geo) {
    await this.requireContact(u.orgId);
    const row = await this.prisma.$transaction(async (tx) => {
      const hc = await this.lifecycle.lock(tx, u.orgId, id);
      this.lifecycle.assertAssignedCollector(u, hc);
      const { data } = this.lifecycle.step(hc, { type: "ABORT_UNSAFE", reason, geostamp }, new Date());
      await tx.homeCollection.update({ where: { id }, data: { ...data, failureReason: null } });
      const r = await tx.safetyAlert.create({ data: { orgId: u.orgId, homeCollectionId: id, kind: "UNSAFE_ABORT", dueAt: new Date() } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "home_collection.unsafe_abort", entityType: "HomeCollection", entityId: id, meta: { reason } }, tx);
      return r;
    });
    const t0 = Date.now();
    const delivered = await this.deliver(row, undefined, () => Date.now() + (Date.now() - t0));
    return { id, status: "ABORTED_UNSAFE", noShow: false, alertId: row.id, delivered };
  }

  alerts(orgId: string, q: { limit?: string } = {}) {
    return this.prisma.safetyAlert.findMany({ where: { orgId }, orderBy: { raisedAt: "desc" }, take: Math.min(Number(q.limit ?? 100) || 100, 500) });
  }
}

