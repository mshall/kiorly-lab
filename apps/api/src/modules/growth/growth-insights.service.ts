import { Inject, Injectable } from "@nestjs/common";
import type { AuthUser } from "../../auth/auth.types";
import { listingPause } from "../../integration/kiorex-listing-pause";
import { PrismaService } from "../../prisma/prisma.service";
import { growthLimitsFor } from "./growth-plan-limits";
import { CommissionRateService } from "./commission-rate.service";
import { buildPerformance } from "./growth-metrics";
import { THRESHOLDS, buildRecommendations } from "./growth-recommendations";
import { utcDay } from "./link-counters";
import { ProviderLinksService } from "./provider-links.service";

/** Performance and recommendations for the Growth workspace. Aggregates only; no patient, no test, no result and no money leave the database. */
@Injectable()
export class GrowthInsightsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(ProviderLinksService) private readonly links: ProviderLinksService, @Inject(CommissionRateService) private readonly rates: CommissionRateService) {}

  async performance(user: AuthUser, q: { days?: number } = {}) {
    const orgId = this.links.assert(user, "view");
    await this.links.assertConnected(orgId);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId }, select: { edition: true } });
    const days = Math.min(growthLimitsFor(t.edition).trendDays, Math.max(7, Math.round(q.days ?? 30)));
    const since = utcDay(new Date(Date.now() - (days - 1) * 86_400_000));
    const scoped = user.labIds.length > 0;
    const orderWhere = { orgId, source: "KIOREX_BOOKING" as const, createdAt: { gte: since }, ...(scoped ? { labId: { in: user.labIds } } : {}) };
    const linkWhere = { orgId, date: { gte: since }, ...(scoped ? { link: { OR: [{ ownerScope: "ORG" as const }, { branchRef: { in: user.labIds } }] } } : {}) };
    const [byStatus, daily] = await Promise.all([
      this.prisma.labOrder.groupBy({ by: ["status"], where: orderWhere, _count: { _all: true } }),
      this.prisma.providerReferralLinkDaily.aggregate({ where: linkWhere, _sum: { visits: true, orders: true, completed: true } }),
    ]);
    const n = (...s: string[]) => byStatus.filter((r) => s.includes(r.status)).reduce((a, r) => a + r._count._all, 0);
    const perf = buildPerformance(
      { total: byStatus.reduce((a, r) => a + r._count._all, 0), completed: n("RELEASED"), rejectedOrCancelled: n("CANCELLED") },
      { visits: daily._sum.visits ?? 0, orders: daily._sum.orders ?? 0, completed: daily._sum.completed ?? 0 },
    );
    const rate = await this.rates.view(orgId);
    return { days, ...perf, statement: { configured: rate.state === "SET" } };
  }

  async recommendations(user: AuthUser) {
    const orgId = this.links.assert(user, "view");
    await this.links.assertConnected(orgId);
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const stale = new Date(Date.now() - THRESHOLDS.unusedAfterDays * 86_400_000);
    const scoped = user.labIds.length > 0;
    const [active, labs, paused, visits, byStatus] = await Promise.all([
      this.prisma.providerReferralLink.findMany({ where: { orgId, status: "ACTIVE", ...(scoped ? { OR: [{ ownerScope: "ORG" as const }, { branchRef: { in: user.labIds } }] } : {}) }, select: { id: true, ownerScope: true, createdAt: true } }),
      this.prisma.lab.count({ where: { orgId, ...(scoped ? { id: { in: user.labIds } } : {}) } }),
      listingPause(this.prisma, orgId),
      this.prisma.providerReferralLinkDaily.groupBy({ by: ["linkId"], where: { orgId, date: { gte: utcDay(since30) } }, _sum: { visits: true } }),
      this.prisma.labOrder.groupBy({ by: ["status"], where: { orgId, source: "KIOREX_BOOKING", createdAt: { gte: since30 }, ...(scoped ? { labId: { in: user.labIds } } : {}) }, _count: { _all: true } }),
    ]);
    const visited = new Set(visits.filter((v) => (v._sum.visits ?? 0) > 0).map((v) => v.linkId));
    const total = byStatus.reduce((a, r) => a + r._count._all, 0);
    const bad = byStatus.filter((r) => r.status === "CANCELLED").reduce((a, r) => a + r._count._all, 0);
    const items = buildRecommendations({
      activeLinks: active.length,
      hasDeskLink: active.some((l) => l.ownerScope === "DESK"),
      branchesNotListed: paused.paused ? labs : 0, // a lab has no per-site listing switch: a paused Kiorex listing means no site is offered
      unusedLinks: active.filter((l) => l.createdAt < stale && !visited.has(l.id)).length,
      kiorexOrders30d: total,
      rejectedOrCancelled30d: bad,
    });
    return { items, guardrail: "Recommendations never suggest extra tests, price pressure on patients or review tactics, and never use what a patient was tested for." };
  }
}
