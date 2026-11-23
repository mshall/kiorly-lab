import { BadRequestException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { assertFlagOn } from "../feature-flags/flag-gate";
import { FeatureFlagsService } from "../feature-flags/feature-flags.service";
import { KERNEL_ENTITLEMENTS, KERNEL_PRICE_BOOK, type EntitlementsPort, type PriceBookPort } from "../kernel-adapter/ports";
import { defaultSlotsFor } from "../modules/orders/home-routing";
import { PrismaService } from "../prisma/prisma.service";

const minor = (major: number) => Math.round(major * 100);
/**
 * Arabic label for the common specimen types (1.8.0 `sampleTypeAr`). The lab holds no Arabic specimen column, so this is a display dictionary;
 * an unknown type returns undefined and the patient app falls back to the English `sampleType`.
 */
const SPECIMEN_AR: Record<string, string> = { blood: "دم", "whole blood": "دم كامل", serum: "مصل", plasma: "بلازما", urine: "بول", stool: "براز", swab: "مسحة", saliva: "لعاب", sputum: "بلغم", csf: "سائل نخاعي", tissue: "عينة نسيج", semen: "سائل منوي" };
export const specimenAr = (v: string | null | undefined): string | undefined => (v ? SPECIMEN_AR[v.trim().toLowerCase()] : undefined);
const MAX_SLOT_RANGE_DAYS = 14;

/**
 * Kiorex marketplace read side (kiorex-contracts 1.4.0 `labListLabs`, `labListTests`, `labQuote`, `labSlots`). The lab is the price
 * and capacity authority: Kiorex never trusts client prices and re-checks the slot right before booking. Gated by `lab.kiorex_bookings`.
 */
@Injectable()
export class IntegrationCatalogueService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FeatureFlagsService) private readonly flags: FeatureFlagsService,
    @Inject(KERNEL_PRICE_BOOK) private readonly prices: PriceBookPort,
    @Inject(KERNEL_ENTITLEMENTS) private readonly ent: EntitlementsPort,
  ) {}

  private async gate(orgId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: orgId } });
    assertFlagOn(this.flags, "lab.kiorex_bookings", { orgId, market: t.marketCode });
    return t;
  }
  private async homeOk(orgId: string, market: string) {
    return this.flags.isEnabled("lab.home_collection", { orgId, market }) && (await this.ent.has(orgId, "home_collection"));
  }

  async labs(orgId: string) {
    const t = await this.gate(orgId);
    const home = await this.homeOk(orgId, t.marketCode);
    return { items: (await this.prisma.lab.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } })).map((l) => ({ id: l.id, name: l.name, homeCollection: home })) };
  }

  async tests(orgId: string, q: { q?: string; labId?: string }) {
    const t = await this.gate(orgId);
    const home = await this.homeOk(orgId, t.marketCode);
    const labs = await this.prisma.lab.findMany({ where: { orgId, ...(q.labId ? { id: q.labId } : {}) }, orderBy: { createdAt: "asc" } });
    if (q.labId && !labs.length) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    const needle = q.q?.trim();
    const tests = await this.prisma.testDefinition.findMany({
      where: { orgId, active: true, sendOut: false, ...(needle ? { OR: [{ code: { contains: needle, mode: "insensitive" } }, { nameEn: { contains: needle, mode: "insensitive" } }, { nameAr: { contains: needle } }] } : {}) },
      orderBy: { code: "asc" }, take: 200,
    });
    const items: Array<Record<string, unknown>> = [];
    for (const lab of labs) {
      for (const d of tests) {
        items.push({ labId: lab.id, labName: lab.name, code: d.code, name: d.nameEn, ...(d.nameAr ? { nameAr: d.nameAr } : {}), priceMinor: minor(await this.prices.resolve({ orgId, testId: d.id })), sampleType: d.specimenType, ...(specimenAr(d.specimenType) ? { sampleTypeAr: specimenAr(d.specimenType) } : {}), homeCollection: home, ...(d.prepInstructionsEn ? { preparation: d.prepInstructionsEn } : {}), ...(d.prepInstructionsAr ? { preparationAr: d.prepInstructionsAr } : {}) });
      }
    }
    return { items };
  }

  async quote(orgId: string, b: { labId?: string; testCodes: string[]; collectionType?: "HOME" | "WALK_IN" }) {
    const t = await this.gate(orgId);
    const codes = [...new Set(b.testCodes.map((c) => c.toUpperCase()))];
    const defs = await this.prisma.testDefinition.findMany({ where: { orgId, code: { in: codes }, active: true, sendOut: false } });
    const unknown = codes.filter((c) => !defs.some((d) => d.code === c));
    if (unknown.length) throw new UnprocessableEntityException({ code: "UNKNOWN_TESTS", codes: unknown });
    if (b.collectionType === "HOME" && !(await this.homeOk(orgId, t.marketCode))) throw new UnprocessableEntityException({ code: "HOME_COLLECTION_NOT_AVAILABLE" });
    const tests = [];
    for (const c of codes) { const d = defs.find((x) => x.code === c)!; tests.push({ code: d.code, name: d.nameEn, ...(d.nameAr ? { nameAr: d.nameAr } : {}), priceMinor: minor(await this.prices.resolve({ orgId, testId: d.id })) }); }
    return { tests, collectionFeeMinor: b.collectionType === "HOME" ? Number(process.env.LAB_HOME_COLLECTION_FEE_MINOR ?? 0) : 0 };
  }

  /** HOME: the lab's capacity grid (booked < capacity). WALK_IN: the same opening grid, no capacity enforced (NEEDS_HUMAN NH-LB-031). */
  async slots(orgId: string, labId: string, q: { collectionType: "HOME" | "WALK_IN"; from: string; to: string }) {
    const t = await this.gate(orgId);
    const lab = await this.prisma.lab.findFirst({ where: { id: labId, orgId } });
    if (!lab) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    const from = new Date(q.from), to = new Date(q.to);
    if (Number.isNaN(+from) || Number.isNaN(+to) || to <= from || to.getTime() - from.getTime() > MAX_SLOT_RANGE_DAYS * 86_400_000) throw new BadRequestException({ code: "RANGE_INVALID", maxDays: MAX_SLOT_RANGE_DAYS });
    if (q.collectionType === "HOME" && !(await this.homeOk(orgId, t.marketCode))) throw new UnprocessableEntityException({ code: "HOME_COLLECTION_NOT_AVAILABLE" });
    const day0 = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    for (let d = day0; d <= to.getTime(); d += 86_400_000) {
      const day = new Date(d);
      const exists = await this.prisma.collectionSlot.count({ where: { labId, startsAt: { gte: day, lt: new Date(d + 86_400_000) } } });
      if (!exists) await this.prisma.collectionSlot.createMany({ data: defaultSlotsFor(day).map((s) => ({ orgId, labId, ...s })), skipDuplicates: true });
    }
    const rows = await this.prisma.collectionSlot.findMany({ where: { labId, orgId, startsAt: { gte: from, lt: to } }, orderBy: { startsAt: "asc" } });
    const now = Date.now();
    return {
      slots: rows
        .filter((r) => r.startsAt.getTime() > now && (q.collectionType === "WALK_IN" || r.booked < r.capacity))
        .map((r) => ({ startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), available: q.collectionType === "HOME" ? Math.max(r.capacity - r.booked, 0) : r.capacity })),
    };
  }
}
