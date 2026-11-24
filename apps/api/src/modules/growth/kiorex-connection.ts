import type { PrismaService } from "../../prisma/prisma.service";

/**
 * Is this lab connected to Kiorex? The same reading the Connect to Kiorex front door uses (`KiorexConnectService.get`), without the Kiorex pull: a lab is
 * connected when its recorded connection status (latest `kiorex_connect.state` audit snapshot) is APPROVED, or it is a legacy connection (no recorded
 * state, an active KIOREX_BOOKING client, integration mode INTEGRATED). A paused, requested or STANDALONE lab is NOT connected, so no link event reaches Kiorex.
 */
export async function isKiorexConnected(prisma: Pick<PrismaService, "tenant" | "integrationClient" | "auditLog">, orgId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: orgId }, select: { integrationMode: true } });
  if (!t) return false;
  const row = await prisma.auditLog.findFirst({ where: { orgId, entityType: "KiorexConnect", action: "kiorex_connect.state" }, orderBy: { at: "desc" }, select: { meta: true } });
  const status = (row?.meta as { status?: string } | null)?.status;
  if (row) return status === "APPROVED" && t.integrationMode === "INTEGRATED";
  return t.integrationMode === "INTEGRATED" && (await prisma.integrationClient.count({ where: { orgId, active: true, source: "KIOREX_BOOKING" } })) > 0;
}
