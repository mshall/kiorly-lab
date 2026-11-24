import { Inject, Injectable } from "@nestjs/common";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import type { AuthUser } from "../auth/auth.types";
import { open as unseal, seal } from "../common/secret-box";
import { PrismaService } from "../prisma/prisma.service";
import { StorageAdapter } from "../adapters/storage.adapter";
import { KIOREX_TERMS_VERSION, canRequest, deriveStatusToken, intakeHeaders, intakeUrl, isEnrolmentCode, kiorexHost, newClientKey, newIntakeNonce, newSecret, progressPct, publicApiBase, validatePayoutLabel, type ConnectStatus } from "./kiorex-connect.core";
import { computeLabSteps } from "./kiorex-connect.logic";

interface Doc { status: ConnectStatus; terms?: { at: string; userId: string; version: string }; payoutLabel?: string; licenceDocument?: { at: string; bytes: number }; request?: { id: string; submittedAt: string; clientKey: string }; /** AES-GCM sealed intake key issued by Kiorex (shown once there); signs later requests */ intakeKeyEnc?: string; kiorex?: { status: string; at: string }; contactEmail?: string }
const err = (E: new (b: object) => Error, code: string, message: string, extra: object = {}) => new E({ code, message, ...extra });
const kek = () => process.env.INTEGRATION_KEK ?? "dev-kek-change-me-dev-kek-change-me!";
const ENTITY = "KiorexConnect";

/**
 * Connect to Kiorex for a standalone lab (ADR-040). The state is an append-only snapshot in AuditLog (entityType KiorexConnect, ids and statuses only:
 * no schema change, full history for free). Secrets are shown once and never written to the log; the status token is derived, never stored.
 */
@Injectable()
export class KiorexConnectService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService, @Inject(StorageAdapter) private readonly storage: StorageAdapter) {}

  private async doc(orgId: string): Promise<Doc | undefined> {
    const row = await this.prisma.auditLog.findFirst({ where: { orgId, entityType: ENTITY, action: "kiorex_connect.state" }, orderBy: { at: "desc" } });
    return (row?.meta as unknown as Doc | undefined) ?? undefined;
  }
  private async save(orgId: string, actorId: string | null, patch: (d: Doc) => Doc) {
    const next = patch((await this.doc(orgId)) ?? { status: "STANDALONE" });
    await this.audit.record({ orgId, actorId, action: "kiorex_connect.state", entityType: ENTITY, entityId: orgId, meta: next as unknown as Record<string, unknown> });
  }

  async get(orgId: string, opts: { pull?: boolean } = {}) {
    let tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } });
    let d = await this.doc(orgId);
    const clients = await this.prisma.integrationClient.count({ where: { orgId, active: true, source: "KIOREX_BOOKING" } });
    const legacy = !d && clients > 0 && tenant.integrationMode === "INTEGRATED";
    if (opts.pull !== false && d?.request && ["REQUESTED", "CHANGES_REQUESTED", "APPROVED", "PAUSED"].includes(d.status)) { await this.pull(orgId, d); d = await this.doc(orgId); tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } }); }
    const status: ConnectStatus = d?.status ?? (legacy ? "APPROVED" : "STANDALONE");
    const labs = await this.prisma.lab.findMany({ where: { orgId } });
    const tests = await this.prisma.testDefinition.findMany({ where: { orgId, active: true, sendOut: false }, select: { id: true } });
    const priced = tests.length ? await this.prisma.priceListItem.findMany({ where: { orgId, testId: { in: tests.map((x) => x.id) }, effectiveTo: null, priceList: { isDefault: true, active: true } }, select: { testId: true }, distinct: ["testId"] }) : [];
    const steps = computeLabSteps({
      status, labs: labs.length, activeTests: tests.length, pricedTests: priced.length, labsMissingHours: labs.filter((l) => !(l.openingHour < l.closingHour)).length,
      labsMissingLicenceNo: labs.filter((l) => !l.licenceNo?.trim()).length, licenceDocument: !!d?.licenceDocument, homeCollectionConfigured: labs.some((l) => l.coverageDistricts.length > 0),
      payoutLabel: !!d?.payoutLabel, termsAccepted: !!d?.terms, liveOnKiorex: status === "APPROVED",
    });
    return { legacy, status, progress: legacy ? 100 : progressPct(steps), canRequest: !legacy && canRequest(steps, status), steps, kiorex: d?.kiorex ?? null, requestId: d?.request?.id ?? null, clientKey: d?.request?.clientKey ?? null, enrolmentCodeRequired: !d?.intakeKeyEnc, termsVersion: KIOREX_TERMS_VERSION, payoutLabel: d?.payoutLabel ?? null, terms: d?.terms ? { at: d.terms.at, version: d.terms.version } : null, licenceDocument: d?.licenceDocument ?? null, mode: tenant.integrationMode };
  }

  async acceptTerms(u: AuthUser, version: string) {
    if (version !== KIOREX_TERMS_VERSION) throw err(BadRequestException, "TERMS_VERSION_MISMATCH", "Reload the page: the terms changed");
    await this.save(u.orgId, u.staffId, (d) => ({ ...d, status: d.status === "STANDALONE" ? "CONSENTED" : d.status, terms: { at: new Date().toISOString(), userId: u.staffId, version } }));
    return this.get(u.orgId, { pull: false });
  }
  async setPayout(u: AuthUser, label: unknown) {
    const v = validatePayoutLabel(label);
    if (!v.ok) throw err(BadRequestException, v.code, v.code === "PAYOUT_LOOKS_LIKE_ACCOUNT_NUMBER" ? "Enter a short label only. Bank details are never stored here" : "Enter a short label (2 to 40 characters)");
    await this.save(u.orgId, u.staffId, (d) => ({ ...d, payoutLabel: v.value }));
    return this.get(u.orgId, { pull: false });
  }
  async uploadLicence(u: AuthUser, name: string, contentBase64: string) {
    const bytes = Buffer.from(contentBase64, "base64");
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw err(BadRequestException, "LICENCE_FILE_INVALID", "The licence file must be 1 byte to 5 MB");
    const ext = /\.pdf$/i.test(name) ? "pdf" : /\.png$/i.test(name) ? "png" : "jpg";
    await this.storage.put(`tenants/${u.orgId}/kiorex-connect/licence.${ext}`, bytes);
    await this.save(u.orgId, u.staffId, (d) => ({ ...d, licenceDocument: { at: new Date().toISOString(), bytes: bytes.length } }));
    return this.get(u.orgId, { pull: false });
  }

  /** Issues a fresh KIOREX_BOOKING client, switches the lab to INTEGRATED and submits the signed registration request. Rotation returns the secrets ONCE. */
  async request(u: AuthUser, o: { rotate?: boolean; contactEmail?: string; enrolmentCode?: string } = {}) {
    const state = await this.get(u.orgId, { pull: false }); const d0 = await this.doc(u.orgId);
    if (state.legacy) throw err(ConflictException, "ALREADY_CONNECTED", "This lab is already connected");
    const rotating = !!o.rotate && state.status === "APPROVED";
    if (!rotating && !state.canRequest && state.status !== "REQUESTED") throw err(ConflictException, "CONNECT_NOT_READY", "Finish every required step first", { open: state.steps.filter((s) => !s.optional && !["request", "live"].includes(s.key) && s.status !== "done").map((s) => s.key) });
    // the first request needs the one-time enrolment code Kiorex ops handed over; later ones are signed with the intake key Kiorex issued then
    const code = o.enrolmentCode?.trim(); const intakeKey = d0?.intakeKeyEnc ? unseal(d0.intakeKeyEnc) : undefined;
    if (code && !isEnrolmentCode(code)) throw err(BadRequestException, "ENROLMENT_CODE_INVALID", "That enrolment code is not valid. Copy it exactly as Kiorex gave it to you");
    if (!code && !intakeKey) throw err(ConflictException, "ENROLMENT_CODE_REQUIRED", "Enter the enrolment code Kiorex gave you");
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: u.orgId } }); const host = kiorexHost();
    const clientKey = newClientKey("kl"); const clientSecret = newSecret(); const webhookSecret = newSecret();
    await this.prisma.integrationClient.create({ data: { orgId: u.orgId, key: clientKey, secretEnc: seal(clientSecret), source: "KIOREX_BOOKING", kiorexBaseUrl: host, webhookSecretEnc: seal(webhookSecret) } });
    const body = JSON.stringify({
      nonce: newIntakeNonce(), statusToken: deriveStatusToken(kek(), u.orgId), kind: "LAB", orgRef: u.orgId, name: t.name, market: t.marketCode, locale: "en", contactEmail: o.contactEmail ?? d0?.contactEmail,
      baseUrl: publicApiBase(), clientKey, clientSecret, webhookSecret,
      readiness: { counts: { labs: state.steps.find((s) => s.key === "lab_site")?.detail?.labs, items: state.steps.find((s) => s.key === "price_list")?.detail?.priced }, documents: { licence: state.steps.find((s) => s.key === "licence")?.status === "done" }, termsAcceptedAt: d0?.terms?.at, termsVersion: d0?.terms?.version, steps: state.steps.map((s) => ({ key: s.key, status: s.status })) },
    });
    const ts = Math.floor(Date.now() / 1000); const undo = () => this.prisma.integrationClient.updateMany({ where: { orgId: u.orgId, key: clientKey }, data: { active: false } });
    let res: Response;
    try { res = await fetch(intakeUrl(host), { method: "POST", headers: intakeHeaders(code ?? intakeKey!, ts, body, code), body, signal: AbortSignal.timeout(8000) }); }
    catch { await undo(); throw err(ConflictException, "KIOREX_UNREACHABLE", "Kiorex could not be reached. Nothing was sent. Try again."); }
    if (!res.ok) { await undo(); throw err(ConflictException, res.status === 401 ? "ENROLMENT_CODE_REJECTED" : res.status === 429 ? "KIOREX_BUSY" : "KIOREX_REJECTED_REQUEST", res.status === 401 ? "Kiorex did not accept the enrolment code. Check it, or ask Kiorex for a new one" : "Kiorex did not accept the request", { status: res.status }); }
    const sent = (await res.json()) as { id: string; intakeKey?: string };
    await this.save(u.orgId, u.staffId, (d) => ({ ...d, status: rotating ? d.status : "REQUESTED", request: { id: sent.id, submittedAt: new Date().toISOString(), clientKey }, contactEmail: o.contactEmail ?? d.contactEmail, ...(sent.intakeKey ? { intakeKeyEnc: seal(sent.intakeKey) } : {}) }));
    await this.prisma.tenant.update({ where: { id: u.orgId }, data: { integrationMode: "INTEGRATED" } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: rotating ? "kiorex_connect.credentials_rotated" : "kiorex_connect.requested", entityType: ENTITY, entityId: u.orgId, meta: { requestId: sent.id, clientKey } });
    return { ...(await this.get(u.orgId, { pull: false })), ...(rotating ? { credentials: { clientKey, clientSecret, webhookSecret, shownOnce: true } } : {}) };
  }

  async pull(orgId: string, d: Doc): Promise<void> {
    if (!d.request) return;
    try {
      const res = await fetch(`${intakeUrl(kiorexHost())}/${encodeURIComponent(d.request.id)}`, { headers: { "x-connection-token": deriveStatusToken(kek(), orgId) }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) return;
      const s = (await res.json()) as { status: string };
      const map: Record<string, ConnectStatus | undefined> = { LIVE: "APPROVED", PAUSED: "PAUSED", REJECTED: "REJECTED", CHANGES_REQUESTED: "CHANGES_REQUESTED" };
      const next = map[s.status];
      if (d.kiorex?.status === s.status && (!next || d.status === next)) return; // idempotent: no new snapshot when nothing changed
      await this.save(orgId, null, (cur) => ({ ...cur, kiorex: { status: s.status, at: new Date().toISOString() }, ...(next ? { status: next } : {}) }));
      if (next === "REJECTED") await this.prisma.tenant.update({ where: { id: orgId }, data: { integrationMode: "STANDALONE" } });
    } catch { /* Kiorex unreachable: keep the last known state */ }
  }
}
