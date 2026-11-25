import type { Edition, LedgerAccount } from "../generated/prisma/client";
import type { Db } from "../common/db";

/**
 * Kernel seam. @kiorly/commerce-kernel is NOT published yet (NH-LB-022 / KCV-202). These ports are the only surface the
 * rest of the app uses for plans/entitlements, price book and ledger; the local implementation (local-kernel.ts) is swapped
 * for the published package by changing the providers in kernel.module.ts. Never copy kernel code into the domain modules.
 */
export type Capability = "analyzer_interfaces" | "home_collection" | "referral_labs" | "multi_branch" | "kiorex_bookings";

export interface EntitlementsPort {
  edition(orgId: string): Promise<Edition>;
  has(orgId: string, capability: Capability, opts?: { readOnlyRequest?: boolean }): Promise<boolean>;
}

export interface PriceQuery {
  orgId: string;
  testId?: string;
  packageId?: string;
  priceListId?: string | null;
  at?: Date;
}
export interface PriceBookPort {
  resolve(q: PriceQuery, db?: Db): Promise<number>;
  /** Versioned: closes the current row and inserts version+1. */
  set(input: { orgId: string; priceListId: string; testId?: string; packageId?: string; amount: number; actorId: string }, db?: Db): Promise<{ version: number }>;
}

export interface LedgerPostInput {
  orgId: string;
  refType: string;
  refId: string;
  debit: LedgerAccount;
  credit: LedgerAccount;
  amount: number;
  currency: string;
  memo?: string;
}
export interface LedgerPort {
  post(entry: LedgerPostInput, db?: Db): Promise<void>;
  /** Net of all entries per account. */
  balances(orgId: string, db?: Db): Promise<Record<string, number>>;
}

export const KERNEL_ENTITLEMENTS = Symbol("KERNEL_ENTITLEMENTS");
export const KERNEL_PRICE_BOOK = Symbol("KERNEL_PRICE_BOOK");
export const KERNEL_LEDGER = Symbol("KERNEL_LEDGER");
