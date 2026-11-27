/**
 * Operator tool: create a Lab organisation with its first owner (production sign-up through Kiorex Account is not built, NH-LB-016; the self-serve HTTP onboarding is dev only).
 * Every value comes from the environment (never from a file in git, never printed):
 *   ORG_SLUG, ORG_NAME, LAB_NAME, LAB_CODE, OWNER_NAME, OWNER_EMAIL, OWNER_PHONE (E.164: the operator confirmed it, so the first Kiorex Passport sign-in by that verified phone binds the owner
 *   automatically when OIDC_PHONE_LINK=true), optional OWNER_PASSWORD (min 10 characters), optional MARKET_CODE (default EG; fixed for life), TAG_BATCH (registers the row in "DemoMarker" so
 *   `npm run demo-data:remove` can delete a throwaway organisation).
 * Idempotent per slug: an existing organisation is left as it is.
 */
import { PrismaClient } from "../generated/prisma/client";
import { createPgAdapter } from "../prisma/pg-adapter";
import { normalizePhone } from "../auth/passport";
import { hashPassword } from "../auth/password";
import { passwordPolicyError } from "../auth/password-auth.service";

const need = (k: string): string => { const v = process.env[k]?.trim(); if (!v) throw new Error(`${k} is required`); return v; };

async function main() {
  const slug = need("ORG_SLUG"); const email = need("OWNER_EMAIL").toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) throw new Error("ORG_SLUG must match [a-z0-9-]{3,40}");
  const phone = process.env.OWNER_PHONE ? normalizePhone(process.env.OWNER_PHONE) : null;
  if (process.env.OWNER_PHONE && !phone) throw new Error("OWNER_PHONE must be E.164");
  const pw = process.env.OWNER_PASSWORD;
  const err = pw ? passwordPolicyError(pw, email) : null; if (err) throw new Error(err);
  const market = (process.env.MARKET_CODE ?? "EG").toUpperCase();
  const prisma = new PrismaClient({ adapter: createPgAdapter() });
  try {
    if (await prisma.tenant.findUnique({ where: { slug } })) { console.log(`organisation ${slug} exists: nothing changed`); return; }
    const passwordHash = pw ? await hashPassword(pw) : null;
    const out = await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: { name: need("ORG_NAME"), slug, edition: "LITE", marketCode: market, integrationMode: "STANDALONE" } });
      await tx.lab.create({ data: { orgId: t.id, name: need("LAB_NAME"), code: need("LAB_CODE").toUpperCase() } });
      const owner = await tx.staffUser.create({ data: { orgId: t.id, email, displayName: need("OWNER_NAME"), role: "OWNER", phone, ...(passwordHash ? { passwordHash, passwordChangedAt: new Date() } : {}) } });
      await tx.priceList.create({ data: { orgId: t.id, name: "Standard", isDefault: true, currency: t.currency } });
      await tx.auditLog.create({ data: { orgId: t.id, actorId: owner.id, action: "tenant.onboard", entityType: "Tenant", entityId: t.id, meta: { via: "operator-script", phoneSet: !!phone, passwordSet: !!pw } } as never });
      if (process.env.TAG_BATCH) await tx.$executeRawUnsafe(`INSERT INTO "DemoMarker" ("tableName","rowId","dataClass","batch") VALUES ('Tenant',$1,'DEMO',$2) ON CONFLICT DO NOTHING`, t.id, process.env.TAG_BATCH);
      return { tenantId: t.id, ownerId: owner.id };
    });
    console.log(JSON.stringify({ ...out, slug, phoneSet: !!phone, passwordSet: !!pw, tagged: !!process.env.TAG_BATCH }));
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
