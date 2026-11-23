import type { PrismaService } from "../prisma/prisma.service";
import { cleanOrgHint, deploymentDefaultMethod, effectiveOrgDefault, resolvePublicSignInConfig, type OrgSignInFacts, type SignInDefaultMethod } from "./sign-in-default";

/** Linked to Kiorex = an external Kiorex org id, or at least one active staff member who signed in with Kiorex Passport (has a Passport subject). */
export async function tenantLinkedToKiorex(prisma: PrismaService, t: { id: string; externalOrgId: string | null }): Promise<boolean> {
  if (t.externalOrgId) return true;
  return (await prisma.staffUser.count({ where: { orgId: t.id, active: true, subject: { not: null } }, take: 1 })) > 0;
}

/** Facts for `?org=<slug or id>` (the web remembers the id after a sign-in); null for a missing or unknown org (the caller then answers with the deployment default, same shape). */
export async function orgSignInFacts(prisma: PrismaService, orgHint: unknown): Promise<OrgSignInFacts | null> {
  const slug = cleanOrgHint(orgHint);
  if (!slug) return null;
  const t = await prisma.tenant.findFirst({ where: { OR: [{ slug }, { id: slug }] }, select: { id: true, externalOrgId: true, defaultSignInMethod: true } });
  if (!t) return null;
  return { stored: t.defaultSignInMethod, linkedToKiorex: await tenantLinkedToKiorex(prisma, t) };
}

export { deploymentDefaultMethod, effectiveOrgDefault, resolvePublicSignInConfig };
export type { SignInDefaultMethod };
