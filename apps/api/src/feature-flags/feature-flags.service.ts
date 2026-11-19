import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { randomUUID } from "node:crypto";
import { FLAG_DEFINITIONS, isKnownFlagKey } from "./feature-flag-keys";
import { type FlagSnapshot, type SnapshotFlag, signControlRequest } from "./flag-snapshot";
import { SafetyControlNotAFlagError, isSafetyControlKey } from "./safety-controls";

export interface FlagContext {
  orgId?: string;
  market?: string;
}
export interface FlagDecision {
  enabled: boolean;
  /** Which layer turned it OFF (for the 403 FEATURE_DISABLED body). */
  scope?: "global" | "market" | "org" | "dependency" | "launch-locked";
  key: string;
}

/**
 * STUB evaluator over the Kiorex snapshot. Local evaluation only; missing snapshot => code defaults
 * (ON, launch-locked OFF). Effective = global AND market AND org AND dependencies (ADR-023).
 * Plan entitlement (HTTP 402) is a separate concern and not modelled here.
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FeatureFlagsService.name);
  private snapshot: FlagSnapshot | null = null;
  private etag: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  /** Restores the last good snapshot from FlagSnapshotCache so a restart never loses flag state while the control plane is down. */
  async loadPersisted(): Promise<boolean> {
    if (!this.prisma) return false;
    try {
      const row = await this.prisma.flagSnapshotCache.findUnique({ where: { product: "kiorly-lab" } });
      if (!row) return false;
      this.snapshot = row.body as unknown as FlagSnapshot;
      this.etag = row.etag;
      return true;
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    if (!this.prisma || !this.snapshot) return;
    try {
      const body = this.snapshot as unknown as Prisma.InputJsonValue;
      await this.prisma.flagSnapshotCache.upsert({
        where: { product: "kiorly-lab" },
        create: { product: "kiorly-lab", version: String(this.snapshot.version), etag: this.etag, body },
        update: { version: String(this.snapshot.version), etag: this.etag, body, fetchedAt: new Date() },
      });
    } catch (e) {
      this.log.warn(`could not persist flag snapshot: ${(e as Error).message}`);
    }
  }

  async onModuleInit() {
    await this.loadPersisted();
    if (process.env.FLAGS_POLL_ENABLED === "true") {
      void this.refresh();
      this.timer = setInterval(() => void this.refresh(), Number(process.env.FLAGS_POLL_INTERVAL_MS ?? 30_000));
      this.timer.unref();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Test seam and push handler (flag.changed webhook) entry point. */
  setSnapshot(snapshot: FlagSnapshot | null) {
    this.snapshot = snapshot;
  }

  getSnapshotVersion(): string | number | null {
    return this.snapshot?.version ?? null;
  }

  /** Poll once with If-None-Match. Failures keep the last good snapshot. */
  async refresh(fetchImpl: typeof fetch = fetch): Promise<"updated" | "not-modified" | "failed"> {
    const base = process.env.KIOREX_FLAGS_URL;
    const key = process.env.KIOREX_PRODUCT_KEY;
    const secret = process.env.KIOREX_PRODUCT_SECRET;
    if (!base || !key || !secret) return "failed";
    try {
      const url = new URL(base);
      url.searchParams.set("product", "kiorly-lab");
      const timestamp = new Date().toISOString();
      const nonce = randomUUID();
      const headers: Record<string, string> = {
        "x-kiorex-product-key": key,
        "x-kiorly-timestamp": timestamp,
        "x-kiorly-nonce": nonce,
        "x-kiorly-signature": signControlRequest(secret, { timestamp, nonce, method: "GET", path: url.pathname + url.search }),
      };
      if (this.etag) headers["if-none-match"] = this.etag;
      const res = await fetchImpl(url, { headers });
      if (res.status === 304) return "not-modified";
      if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
      this.snapshot = (await res.json()) as FlagSnapshot;
      this.etag = res.headers.get("etag");
      await this.persist();
      return "updated";
    } catch (err) {
      this.log.warn(`flag snapshot refresh failed (keeping last good): ${(err as Error).message}`);
      return "failed";
    }
  }

  evaluate(key: string, ctx: FlagContext = {}): FlagDecision {
    if (isSafetyControlKey(key)) throw new SafetyControlNotAFlagError(key);
    if (!isKnownFlagKey(key)) throw new Error(`Unknown flag key "${key}"`);
    const def = FLAG_DEFINITIONS.find((f) => f.key === key)!;
    for (const dep of def.dependsOn) {
      const d = this.evaluate(dep, ctx);
      if (!d.enabled) return { key, enabled: false, scope: "dependency" };
    }
    const row: SnapshotFlag | undefined = this.snapshot?.flags.find((f) => f.key === key);
    const launchLocked = row?.launchLocked ?? def.launchLocked;
    if (launchLocked && !(row?.gateSatisfied ?? false)) return { key, enabled: false, scope: "launch-locked" };
    if (row?.expiresAt && Date.parse(row.expiresAt) < Date.now()) return { key, enabled: true };
    const v = row?.values;
    if (v?.global === "OFF") return { key, enabled: false, scope: "global" };
    if (ctx.market && v?.markets?.[ctx.market] === "OFF") return { key, enabled: false, scope: "market" };
    if (ctx.orgId && v?.orgs?.[ctx.orgId] === "OFF") return { key, enabled: false, scope: "org" };
    return { key, enabled: true };
  }

  isEnabled(key: string, ctx: FlagContext = {}): boolean {
    return this.evaluate(key, ctx).enabled;
  }
}
