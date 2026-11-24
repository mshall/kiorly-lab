import { ConflictException, BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { kiorexHost } from "./kiorex-connect.core";
import { KiorexConnectService } from "./kiorex-connect.service";
import { cleanTalkToUs, frontDoorState, leadHeaders, leadSigningSecret, LeadInputError, newLeadNonce, type TalkToUsInput } from "./kiorex-front-door.core";

const ENTITY = "KiorexFrontDoor"; const MARK = "kiorex_front_door.mark";
type Mark = "started" | "interest" | "lead";
const err = (E: new (b: object) => Error, code: string, message: string, extra: object = {}) => new E({ code, message, ...extra });
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };

/** Front door of "Connect to Kiorex" for labs (ADR-040). Flags are append-only AuditLog marks (ids only, no PHI): no schema change. Dashboard numbers come from real Kiorex-sourced lab orders. */
@Injectable()
export class KiorexFrontDoorService {
  private readonly log = new Logger("kiorex-front-door");
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService, @Inject(KiorexConnectService) private readonly connect: KiorexConnectService) {}

  private async marks(orgId: string): Promise<Partial<Record<Mark, string>>> {
    const rows = await this.prisma.auditLog.findMany({ where: { orgId, entityType: ENTITY, action: MARK }, orderBy: { at: "asc" }, select: { meta: true, at: true } });
    const out: Partial<Record<Mark, string>> = {};
    for (const r of rows) { const k = (r.meta as { mark?: Mark } | null)?.mark; if (k) out[k] = r.at.toISOString(); }
    return out;
  }
  private mark(orgId: string, actorId: string | null, mark: Mark) { return this.audit.record({ orgId, actorId, action: MARK, entityType: ENTITY, entityId: orgId, meta: { mark } }); }

  async get(orgId: string) {
    const c = await this.connect.get(orgId); const m = await this.marks(orgId);
    const state = frontDoorState({ legacy: c.legacy, status: c.status, started: !!m.started || !!c.terms });
    let month: { orders: number; resulted: number; cancelled: number } | null = null; let recent: Array<{ id: string; createdAt: Date; status: string; lab: string; collection: string }> = []; let labs: Array<{ id: string; name: string }> = [];
    if (state === "LIVE" || state === "ATTENTION") {
      const where = { orgId, source: "KIOREX_BOOKING" as const };
      const rows = await this.prisma.labOrder.findMany({ where: { ...where, createdAt: { gte: monthStart() } }, select: { status: true } });
      month = { orders: rows.length, resulted: rows.filter((r) => ["VALIDATED", "RELEASED"].includes(r.status)).length, cancelled: rows.filter((r) => r.status === "CANCELLED").length };
      labs = await this.prisma.lab.findMany({ where: { orgId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
      const lname = new Map(labs.map((l) => [l.id, l.name]));
      const last = await this.prisma.labOrder.findMany({ where, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, createdAt: true, status: true, labId: true, collectionType: true } });
      recent = last.map((o) => ({ id: o.id, createdAt: o.createdAt, status: o.status, lab: lname.get(o.labId) ?? "", collection: o.collectionType }));
    }
    return { state, status: c.status, legacy: c.legacy, started: !!m.started || !!c.terms, interestedAt: m.interest ?? null, leadAt: m.lead ?? null, month, recent, labs, connect: c };
  }

  async interest(orgId: string) {
    const c = await this.connect.get(orgId, { pull: false }); const m = await this.marks(orgId);
    if (c.legacy || c.status !== "STANDALONE" || m.interest) return { sent: false };
    const ok = await this.sendFunnel(orgId, "INTERESTED"); if (ok) await this.mark(orgId, null, "interest");
    return { sent: ok };
  }

  async start(u: AuthUser) {
    const c = await this.connect.get(u.orgId, { pull: false });
    if (c.legacy) throw err(ConflictException, "ALREADY_CONNECTED", "This lab is already connected");
    if (c.status === "STANDALONE" && !(await this.marks(u.orgId)).started) { await this.mark(u.orgId, u.staffId, "started"); void this.sendFunnel(u.orgId, "STARTED"); }
    return this.get(u.orgId);
  }

  async talk(u: AuthUser, input: TalkToUsInput) {
    const c = await this.connect.get(u.orgId, { pull: false }); if (c.legacy) throw err(ConflictException, "ALREADY_CONNECTED", "This lab is already connected");
    let clean; try { clean = cleanTalkToUs(input ?? {}); } catch (e) { if (e instanceof LeadInputError) throw err(BadRequestException, e.code, "Check the form", { field: e.field }); throw e; }
    const secret = leadSigningSecret(); const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } });
    if (!secret) throw err(ConflictException, "KIOREX_NOT_CONFIGURED", "Kiorex connection is not configured for this deployment");
    const body = JSON.stringify({ nonce: newLeadNonce(), kind: "LAB", orgRef: u.orgId, orgName: t.name, ...clean, locale: "en", market: t.marketCode, consent: true });
    let res: Response;
    try { res = await fetch(`${kiorexHost()}/api/v1/partners/v1/leads`, { method: "POST", headers: leadHeaders(secret, Math.floor(Date.now() / 1000), body), body, signal: AbortSignal.timeout(8000) }); }
    catch { throw err(ConflictException, "KIOREX_UNREACHABLE", "Kiorex could not be reached. Nothing was sent. Try again."); }
    if (!res.ok) throw err(ConflictException, res.status === 429 ? "KIOREX_BUSY" : "KIOREX_REJECTED_REQUEST", "Kiorex did not accept the request", { status: res.status });
    await this.mark(u.orgId, u.staffId, "lead");
    return this.get(u.orgId);
  }

  private async sendFunnel(orgId: string, stage: "INTERESTED" | "STARTED"): Promise<boolean> {
    const secret = leadSigningSecret(); if (!secret) return false;
    const body = JSON.stringify({ nonce: newLeadNonce(), kind: "LAB", orgRef: orgId, stage });
    try { const r = await fetch(`${kiorexHost()}/api/v1/partners/v1/funnel`, { method: "POST", headers: leadHeaders(secret, Math.floor(Date.now() / 1000), body), body, signal: AbortSignal.timeout(4000) }); return r.ok; }
    catch (e) { this.log.warn(`funnel marker not sent (${(e as Error).name})`); return false; }
  }
}
