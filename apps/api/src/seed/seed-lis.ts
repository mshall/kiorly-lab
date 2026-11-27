import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import type { Lab, StaffRole, Tenant } from "../generated/prisma/client";
import { AppModule } from "../app.module";
import type { AuthUser } from "../auth/auth.types";
import { loadEnv } from "../config/env";
import { assertDemoSeedAllowed } from "../common/demo-seed-guard";
import { tagDemoRows } from "../common/demo-data-tag";
import { PrismaService } from "../prisma/prisma.service";
import { QcService } from "../modules/analysis-qc/qc.service";
import { seedCatalogue } from "./lis-seed-catalogue";
import { seedOperations } from "./lis-seed-operations";
import { seedBackOffice } from "./lis-seed-backoffice";

/**
 * Kiorly Lab LIS demo dataset (SYNTHETIC, DEV/STAGING ONLY, behind the demo-seed guard). Extends the base demo tenant (npm run db:seed) with the
 * standalone-LIS modules: a 200+ test catalogue with panels/packages, referring doctors with commission/credit accounts, patients with multi-visit
 * result histories (trends), orders in every state, inventory with lots and auto-consumption, microbiology and histopathology cases, quality records
 * (calibration, EQA, maintenance, NCR/CAPA, SOP library), finance (contracts, discounts, partial payments, refunds, aging, expenses) and reception data.
 *
 *   npm run db:seed:lis -w api     (idempotent: skips when the marker supplier "MedSupply (demo)" exists)
 */
const SLUG = "demo-lab";
export const DAY = 86_400_000;

export interface Ctx {
  app: INestApplicationContext;
  prisma: PrismaService;
  tenant: Tenant;
  lab: Lab;
  users: Record<StaffRole, AuthUser>;
  bench: { id: string };
  astm: { id: string };
  hl7: { id: string };
  log: (m: string) => void;
}

async function ensureStaff(prisma: PrismaService, tenant: Tenant): Promise<Record<StaffRole, AuthUser>> {
  const want: [StaffRole, string, string][] = [["SUPERVISOR", "supervisor", "Rania Supervisor"], ["FINANCE", "finance", "Fady Finance"]];
  for (const [role, local, name] of want) {
    if (!(await prisma.staffUser.findFirst({ where: { orgId: tenant.id, role } }))) await prisma.staffUser.create({ data: { orgId: tenant.id, email: `${local}@${SLUG}.test`, displayName: name, role } });
  }
  const staff = await prisma.staffUser.findMany({ where: { orgId: tenant.id } });
  const users = {} as Record<StaffRole, AuthUser>;
  for (const s of staff) users[s.role] = { staffId: s.id, orgId: tenant.id, role: s.role, displayName: s.displayName, labIds: [], marketCode: "EG", edition: "PRO", signatoryLicenceNo: s.signatoryLicenceNo };
  return users;
}

/** Runs every LIS seed phase against `tenant`. Exported so the base seed can chain it. */
export async function seedLis(app: INestApplicationContext, tenant: Tenant): Promise<void> {
  const prisma = app.get(PrismaService);
  const log = (m: string) => console.log(`lis seed: ${m}`);
  if (await prisma.supplier.findFirst({ where: { orgId: tenant.id, name: "MedSupply (demo)" } })) { log("already seeded, skipping"); return; }
  const lab = await prisma.lab.findFirstOrThrow({ where: { orgId: tenant.id }, orderBy: { createdAt: "asc" } });
  const users = await ensureStaff(prisma, tenant);
  const instruments = await prisma.instrument.findMany({ where: { orgId: tenant.id } });
  const bench = instruments.find((i) => i.kind === "MANUAL_BENCH") ?? (await prisma.instrument.create({ data: { orgId: tenant.id, labId: lab.id, name: "Manual bench", kind: "MANUAL_BENCH" } }));
  const astm = instruments.find((i) => i.protocol === "ASTM_E1394") ?? bench;
  const hl7 = instruments.find((i) => i.protocol === "HL7_V2") ?? bench;
  const ctx: Ctx = { app, prisma, tenant, lab, users, bench, astm, hl7, log };
  await prisma.tenant.update({ where: { id: tenant.id }, data: { defaultLocale: "ar" } });
  await seedCatalogue(ctx);
  await seedOperations(ctx);
  await seedBackOffice(ctx);
  log("done. Logins: supervisor@demo-lab.test, finance@demo-lab.test (plus the base roles)");
}

async function main() {
  assertDemoSeedAllowed("Kiorly Lab LIS dataset (demo-lab tenant)");
  loadEnv();
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const tenant = await app.get(PrismaService).tenant.findUnique({ where: { slug: SLUG } });
    if (!tenant) throw new Error('base demo tenant "demo-lab" missing: run `npm run db:seed -w api` first');
    await seedLis(app, tenant);
  } finally {
    await app.close();
  }
}

if (require.main === module) main().then(() => tagDemoRows("seed-lis")).catch((e) => { console.error(e); process.exit(1); });
void QcService;
