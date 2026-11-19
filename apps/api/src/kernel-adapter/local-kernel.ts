import { Inject, Injectable } from "@nestjs/common";
import type { Edition } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { D, round2, type Db } from "../common/db";
import type { Capability, EntitlementsPort, LedgerPort, LedgerPostInput, PriceBookPort, PriceQuery } from "./ports";

/** PRD KX-07 §02 edition matrix. Pricing of editions is NOT decided here (NH-LB-004). */
export const EDITION_CAPABILITIES: Record<Edition, readonly Capability[]> = {
  LITE: ["kiorex_bookings"],
  PRO: ["kiorex_bookings", "analyzer_interfaces", "home_collection", "referral_labs"],
  CHAIN: ["kiorex_bookings", "analyzer_interfaces", "home_collection", "referral_labs", "multi_branch"],
};

@Injectable()
export class LocalEntitlements implements EntitlementsPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async edition(orgId: string): Promise<Edition> {
    const t = await this.prisma.tenant.findUnique({ where: { id: orgId }, select: { edition: true } });
    return t?.edition ?? "LITE";
  }
  async has(orgId: string, capability: Capability): Promise<boolean> {
    return EDITION_CAPABILITIES[await this.edition(orgId)].includes(capability);
  }
}

@Injectable()
export class LocalPriceBook implements PriceBookPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolve(q: PriceQuery, db: Db = this.prisma): Promise<number> {
    const at = q.at ?? new Date();
    const lists: string[] = [];
    if (q.priceListId) lists.push(q.priceListId);
    const def = await db.priceList.findFirst({ where: { orgId: q.orgId, isDefault: true, active: true } });
    if (def && !lists.includes(def.id)) lists.push(def.id);
    for (const id of lists) {
      const row = await db.priceListItem.findFirst({
        where: {
          orgId: q.orgId, priceListId: id, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
          ...(q.testId ? { testId: q.testId } : { packageId: q.packageId }),
        },
        orderBy: { version: "desc" },
      });
      if (row) return D(row.amount);
    }
    if (q.testId) return D((await db.testDefinition.findFirst({ where: { id: q.testId, orgId: q.orgId } }))?.price ?? 0);
    if (q.packageId) return D((await db.testPackage.findFirst({ where: { id: q.packageId, orgId: q.orgId } }))?.price ?? 0);
    return 0;
  }

  async set(i: { orgId: string; priceListId: string; testId?: string; packageId?: string; amount: number; actorId: string }, db: Db = this.prisma) {
    const where = { orgId: i.orgId, priceListId: i.priceListId, effectiveTo: null, ...(i.testId ? { testId: i.testId } : { packageId: i.packageId }) };
    const cur = await db.priceListItem.findFirst({ where, orderBy: { version: "desc" } });
    const now = new Date();
    if (cur) await db.priceListItem.update({ where: { id: cur.id }, data: { effectiveTo: now } });
    const version = (cur?.version ?? 0) + 1;
    await db.priceListItem.create({
      data: { orgId: i.orgId, priceListId: i.priceListId, testId: i.testId, packageId: i.packageId, amount: round2(i.amount), version, effectiveFrom: now, createdBy: i.actorId },
    });
    // keep the catalogue's "current price" mirror in step when this is the default list
    const list = await db.priceList.findUnique({ where: { id: i.priceListId } });
    if (list?.isDefault) {
      if (i.testId) await db.testDefinition.update({ where: { id: i.testId }, data: { price: round2(i.amount) } });
      if (i.packageId) await db.testPackage.update({ where: { id: i.packageId }, data: { price: round2(i.amount) } });
    }
    return { version };
  }
}

@Injectable()
export class LocalLedger implements LedgerPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async post(e: LedgerPostInput, db: Db = this.prisma): Promise<void> {
    await db.ledgerEntry.create({ data: { orgId: e.orgId, refType: e.refType, refId: e.refId, debit: e.debit, credit: e.credit, amount: round2(e.amount), currency: e.currency, memo: e.memo } });
  }
  async balances(orgId: string, db: Db = this.prisma): Promise<Record<string, number>> {
    const rows = await db.ledgerEntry.findMany({ where: { orgId }, select: { debit: true, credit: true, amount: true } });
    const out: Record<string, number> = {};
    for (const r of rows) {
      out[r.debit] = round2((out[r.debit] ?? 0) + D(r.amount));
      out[r.credit] = round2((out[r.credit] ?? 0) - D(r.amount));
    }
    return out;
  }
}
