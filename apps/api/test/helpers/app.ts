import "reflect-metadata";
import { randomBytes } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { StaffRole } from "@prisma/client";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import { loadEnv } from "../../src/config/env";
import { FeatureFlagsService } from "../../src/feature-flags/feature-flags.service";
import { StarterCatalogueService } from "../../src/modules/admin/starter-catalogue.service";
import { OutboxDispatcher } from "../../src/outbox/outbox.dispatcher";
import { CriticalService } from "../../src/modules/critical/critical.service";
import { InsightsService } from "../../src/modules/business/insights.service";
import { PrismaService } from "../../src/prisma/prisma.service";
import { TokenService } from "../../src/auth/token.service";

export interface TestApp {
  app: INestApplication;
  base: string;
  prisma: PrismaService;
  flags: FeatureFlagsService;
  tokens: TokenService;
  outbox: OutboxDispatcher;
  critical: CriticalService;
  insights: InsightsService;
  starter: StarterCatalogueService;
  close(): Promise<void>;
}

export async function bootApp(): Promise<TestApp> {
  process.env.NODE_ENV = "test";
  loadEnv();
  process.env.SWAGGER_ENABLED = "false";
  process.env.STORAGE_DIR = "./.data/test-storage";
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.listen(0, "127.0.0.1");
  return {
    app,
    base: await app.getUrl(),
    prisma: app.get(PrismaService),
    flags: app.get(FeatureFlagsService),
    tokens: app.get(TokenService),
    outbox: app.get(OutboxDispatcher),
    critical: app.get(CriticalService),
    insights: app.get(InsightsService),
    starter: app.get(StarterCatalogueService),
    close: () => app.close(),
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
  raw: Buffer;
}

export async function call<T = any>(t: TestApp, method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string>; rawBody?: string } = {}): Promise<Res<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined;
  if (opts.rawBody !== undefined) body = opts.rawBody;
  else if (opts.body !== undefined) body = JSON.stringify(opts.body);
  if (body !== undefined && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  const res = await fetch(`${t.base}/api/v1${path}`, { method, headers, body });
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: unknown = null;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("json")) parsed = JSON.parse(raw.toString("utf8") || "null");
  else parsed = raw.toString("utf8");
  return { status: res.status, body: parsed as T, headers: res.headers, raw };
}

export interface Lab {
  orgId: string;
  slug: string;
  labId: string;
  staff: Record<StaffRole, { id: string; token: string }>;
  tokens: Record<StaffRole, string>;
  instruments: { astm: string; hl7: string; bench: string };
  analytes: Record<string, string>;
  materials: Record<string, { l1: string; l2: string }>;
}

export const ALL_ROLES: StaffRole[] = ["OWNER", "LAB_DIRECTOR", "AUTHORIZED_SIGNATORY", "TECHNOLOGIST", "PHLEBOTOMIST", "RECEPTION", "BRANCH_MANAGER"];

/** Creates an isolated tenant (PRO edition by default) with one lab, one staff member per role, the synthetic starter catalogue, QC materials and three instruments. */
export async function makeLab(t: TestApp, opts: { edition?: "LITE" | "PRO" | "CHAIN"; vat?: number; market?: string } = {}): Promise<Lab> {
  const slug = `t${randomBytes(5).toString("hex")}`;
  const tenant = await t.prisma.tenant.create({ data: { name: `Test ${slug}`, slug, edition: opts.edition ?? "PRO", vatRatePercent: opts.vat ?? 14, marketCode: opts.market ?? "EG" } });
  const lab = await t.prisma.lab.create({ data: { orgId: tenant.id, name: "Test Lab", code: "TL" } });
  const staff = {} as Lab["staff"];
  const tokens = {} as Lab["tokens"];
  for (const role of ALL_ROLES) {
    const signatory = role === "AUTHORIZED_SIGNATORY" || role === "LAB_DIRECTOR";
    const s = await t.prisma.staffUser.create({ data: { orgId: tenant.id, email: `${role.toLowerCase()}@${slug}.test`, displayName: `${role} ${slug}`, role, signatoryLicenceNo: signatory ? `LIC-${role}` : null } });
    const token = await t.tokens.signDev({ staffId: s.id, amr: ["pwd", "mfa"] });
    staff[role] = { id: s.id, token };
    tokens[role] = token;
  }
  await t.starter.load(tenant.id);
  const mkInst = (name: string, kind: "ANALYZER" | "MANUAL_BENCH", protocol?: "ASTM_E1394" | "HL7_V2") =>
    t.prisma.instrument.create({ data: { orgId: tenant.id, labId: lab.id, name, kind, protocol, simulated: kind === "ANALYZER" } }).then((i) => i.id);
  const instruments = { astm: await mkInst("SimAnalyzer-ASTM", "ANALYZER", "ASTM_E1394"), hl7: await mkInst("SimAnalyzer-HL7", "ANALYZER", "HL7_V2"), bench: await mkInst("Manual bench", "MANUAL_BENCH") };
  const analytes: Record<string, string> = {};
  for (const a of await t.prisma.analyte.findMany({ where: { orgId: tenant.id } })) analytes[a.code] = a.id;
  const materials: Lab["materials"] = {};
  for (const m of await t.prisma.qcMaterialLevel.findMany({ where: { orgId: tenant.id }, include: { analyte: true } })) {
    const code = m.analyte.code;
    materials[code] ??= { l1: "", l2: "" };
    if (m.level === "LEVEL_1") materials[code].l1 = m.id;
    else materials[code].l2 = m.id;
  }
  return { orgId: tenant.id, slug, labId: lab.id, staff, tokens, instruments, analytes, materials };
}

export const PATIENT = { fullName: "Amira Test", dateOfBirth: "1990-05-10", sex: "F", phone: "+201000000111" } as const;

/** Submits a passing QC run (z=0) for both levels of each analyte on the instrument. */
export async function qcPass(t: TestApp, lab: Lab, instrumentId: string, codes: string[], z = 0) {
  for (const code of codes) {
    for (const lvl of ["l1", "l2"] as const) {
      const m = await t.prisma.qcMaterialLevel.findUniqueOrThrow({ where: { id: lab.materials[code][lvl] } });
      const r = await call(t, "POST", "/qc/runs", { token: lab.tokens.TECHNOLOGIST, body: { instrumentId, materialId: m.id, value: Number(m.targetMean) + z * Number(m.targetSd) } });
      if (r.status !== 201) throw new Error(`QC run failed: ${JSON.stringify(r.body)}`);
    }
  }
}

export interface OrderFixture {
  orderId: string;
  order: any;
  specimens: { id: string; barcode: string }[];
}

/** Creates a walk-in order with verified identity and full consent. */
export async function makeOrder(t: TestApp, lab: Lab, testCodes: string[], extra: Record<string, unknown> = {}): Promise<OrderFixture> {
  const r = await call(t, "POST", "/orders", {
    token: lab.tokens.RECEPTION,
    body: { patient: PATIENT, testCodes, identifiersChecked: ["dateOfBirth", "phone"], consentChannels: ["PRINTED", "PATIENT_LINK_OTP", "KIOREX_VAULT", "KIORLY_CLINIC_IMPORT"], referringDoctorName: "Dr Ref", referringDoctorPhone: "+201000000222", ...extra },
  });
  if (r.status !== 201) throw new Error(`order create failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { orderId: r.body.id, order: r.body, specimens: r.body.specimens.map((s: any) => ({ id: s.id, barcode: s.barcode })) };
}

/** collect -> receive -> process, each with the correct scanned label. */
export async function toProcessing(t: TestApp, lab: Lab, f: OrderFixture) {
  for (const s of f.specimens) {
    for (const [action, role] of [["collect", "RECEPTION"], ["receive", "TECHNOLOGIST"], ["process", "TECHNOLOGIST"]] as const) {
      const r = await call(t, "POST", `/specimens/${s.id}/${action}`, { token: lab.tokens[role], body: { scannedBarcode: s.barcode } });
      if (r.status !== 201) throw new Error(`${action} failed: ${r.status} ${JSON.stringify(r.body)}`);
    }
  }
}

/** Manual entry with dual control for every analyte of an order, then technical validation. Returns result ids. */
export async function enterAndTechValidate(t: TestApp, lab: Lab, orderId: string, values: Record<string, number>, instrumentId = lab.instruments.bench) {
  const order = await call(t, "GET", `/orders/${orderId}`, { token: lab.tokens.TECHNOLOGIST });
  const ids: string[] = [];
  for (const item of order.body.items) {
    const test = await call(t, "GET", `/catalogue/tests/${item.testId}`, { token: lab.tokens.TECHNOLOGIST });
    for (const ta of test.body.analytes) {
      const code = ta.analyte.code;
      const value = values[code];
      const e = await call(t, "POST", "/results", { token: lab.tokens.TECHNOLOGIST, body: { orderItemId: item.id, analyteId: ta.analyteId, instrumentId, value } });
      if (e.status !== 201) throw new Error(`enter ${code}: ${e.status} ${JSON.stringify(e.body)}`);
      const second = await call(t, "POST", `/results/${e.body.id}/second-entry`, { token: lab.tokens.LAB_DIRECTOR, body: { value } });
      if (second.status !== 201) throw new Error(`second entry ${code}: ${second.status} ${JSON.stringify(second.body)}`);
      const v = await call(t, "POST", `/results/${e.body.id}/tech-validate`, { token: lab.tokens.TECHNOLOGIST, body: {} });
      if (v.status !== 201) throw new Error(`tech validate ${code}: ${v.status} ${JSON.stringify(v.body)}`);
      ids.push(e.body.id);
    }
  }
  return ids;
}

export const NORMAL = { HB: 13.5, WBC: 7, PLT: 250, GLU: 85, CREA: 0.9, K: 4.2, NA: 140, ALT: 25, AST: 25, TSH: 2 };
