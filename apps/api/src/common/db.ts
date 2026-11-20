import type { Prisma, PrismaClient } from "../generated/prisma/client";

/** Either the client or a transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export const D = (n: number | string | { toString(): string }): number => Number(n.toString());

/** Round half away from zero to 2 decimals (money). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Atomic per-tenant sequence (INSERT .. ON CONFLICT DO UPDATE .. RETURNING). Concurrency-safe. */
export async function nextSequence(db: Db, orgId: string, key: string): Promise<number> {
  const rows = await (db as PrismaClient).$queryRaw<{ value: number }[]>`
    INSERT INTO "SequenceCounter" ("orgId", "key", "value") VALUES (${orgId}, ${key}, 1)
    ON CONFLICT ("orgId", "key") DO UPDATE SET "value" = "SequenceCounter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

export const pad = (n: number, w: number) => String(n).padStart(w, "0");
export const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
