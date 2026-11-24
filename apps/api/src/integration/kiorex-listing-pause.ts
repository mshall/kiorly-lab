import type { PrismaService } from "../prisma/prisma.service";

/**
 * The lab's own "pause my whole Kiorex listing" switch (separate from Kiorex ops pausing a partner). No schema change: the latest
 * `kiorex_listing.paused|resumed` audit row of the organisation IS the state, so the audit trail and the state can never disagree.
 */
export const LISTING_ENTITY = "KiorexListing";
export const LISTING_PAUSED_ACTION = "kiorex_listing.paused";
export const LISTING_RESUMED_ACTION = "kiorex_listing.resumed";
export interface ListingPause { paused: boolean; pausedAt: string | null; reason: string | null }

export function pauseFromRow(row: { action: string; at: Date; meta: unknown } | null | undefined): ListingPause {
  if (!row || row.action !== LISTING_PAUSED_ACTION) return { paused: false, pausedAt: null, reason: null };
  const reason = (row.meta as { reason?: string } | null)?.reason;
  return { paused: true, pausedAt: row.at.toISOString(), reason: reason ?? null };
}
export async function listingPause(prisma: PrismaService, orgId: string): Promise<ListingPause> {
  const row = await prisma.auditLog.findFirst({ where: { orgId, entityType: LISTING_ENTITY }, orderBy: { at: "desc" }, select: { action: true, at: true, meta: true } });
  return pauseFromRow(row);
}
export const cleanPauseReason = (r: unknown): string | undefined => { if (typeof r !== "string") return undefined; const s = r.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200); return s || undefined; };
