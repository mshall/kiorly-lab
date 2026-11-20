import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { MicroStatus, Susceptibility } from "@prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { D } from "../../common/db";
import { PrismaService } from "../../prisma/prisma.service";
import { ResultsService } from "../analysis-qc/results.service";
import { ANTIBIOTICS, ORGANISMS, PANELS } from "./micro-starter";
import { missingSusceptibility, summarizeCase } from "./summary";

export interface SusceptibilityInput { antibioticId: string; method?: "DISK" | "MIC" | "ETEST"; micMgL?: number; zoneMm?: number; interpretation: Susceptibility; reported?: boolean }

/** M4 microbiology: culture & sensitivity cases with organisms, isolates, antibiotic panels and selective reporting; final report becomes a structured Result. */
@Injectable()
export class MicrobiologyService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ResultsService) private readonly results: ResultsService,
  ) {}

  // ----------------------------------------------------------- catalogue
  organisms(orgId: string) { return this.prisma.organism.findMany({ where: { orgId, active: true }, orderBy: { nameEn: "asc" } }); }
  antibiotics(orgId: string) { return this.prisma.antibiotic.findMany({ where: { orgId, active: true }, orderBy: { code: "asc" } }); }
  async panels(orgId: string) {
    const rows = await this.prisma.antibioticPanel.findMany({ where: { orgId, active: true }, include: { items: { include: { antibiotic: true }, orderBy: { position: "asc" } } }, orderBy: { name: "asc" } });
    return rows.map((p) => ({ id: p.id, name: p.name, organismGroup: p.organismGroup, antibiotics: p.items.map((i) => i.antibiotic) }));
  }

  async createOrganism(u: AuthUser, b: { code: string; nameEn: string; nameAr?: string; gram?: string }) {
    const code = b.code.toUpperCase();
    if (await this.prisma.organism.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "ORGANISM_EXISTS" });
    const row = await this.prisma.organism.create({ data: { orgId: u.orgId, code, nameEn: b.nameEn, nameAr: b.nameAr, gram: b.gram ?? "OTHER" } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "organism.create", entityType: "Organism", entityId: row.id });
    return row;
  }
  async createAntibiotic(u: AuthUser, b: { code: string; nameEn: string; nameAr?: string; antibioticClass?: string }) {
    const code = b.code.toUpperCase();
    if (await this.prisma.antibiotic.findFirst({ where: { orgId: u.orgId, code } })) throw new ConflictException({ code: "ANTIBIOTIC_EXISTS" });
    const row = await this.prisma.antibiotic.create({ data: { orgId: u.orgId, code, nameEn: b.nameEn, nameAr: b.nameAr, antibioticClass: b.antibioticClass } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "antibiotic.create", entityType: "Antibiotic", entityId: row.id });
    return row;
  }
  async createPanel(u: AuthUser, b: { name: string; organismGroup: string; antibioticCodes: string[] }) {
    const abx = await this.prisma.antibiotic.findMany({ where: { orgId: u.orgId, code: { in: b.antibioticCodes.map((c) => c.toUpperCase()) } } });
    const missing = b.antibioticCodes.filter((c) => !abx.some((a) => a.code === c.toUpperCase()));
    if (missing.length) throw new BadRequestException({ code: "UNKNOWN_ANTIBIOTIC", codes: missing });
    if (await this.prisma.antibioticPanel.findFirst({ where: { orgId: u.orgId, name: b.name } })) throw new ConflictException({ code: "PANEL_EXISTS" });
    const p = await this.prisma.antibioticPanel.create({ data: { orgId: u.orgId, name: b.name, organismGroup: b.organismGroup, items: { create: b.antibioticCodes.map((c, i) => ({ orgId: u.orgId, antibioticId: abx.find((a) => a.code === c.toUpperCase())!.id, position: i })) } } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "antibiotic_panel.create", entityType: "AntibioticPanel", entityId: p.id });
    return p;
  }

  /** Idempotent loader of the synthetic starter microbiology catalogue. */
  async loadStarter(orgId: string) {
    let created = 0;
    for (const o of ORGANISMS) if (!(await this.prisma.organism.findFirst({ where: { orgId, code: o.code } }))) { await this.prisma.organism.create({ data: { orgId, code: o.code, nameEn: o.nameEn, nameAr: o.nameAr, gram: o.gram } }); created++; }
    for (const a of ANTIBIOTICS) if (!(await this.prisma.antibiotic.findFirst({ where: { orgId, code: a.code } }))) { await this.prisma.antibiotic.create({ data: { orgId, code: a.code, nameEn: a.nameEn, nameAr: a.nameAr, antibioticClass: a.cls } }); created++; }
    for (const p of PANELS) {
      if (await this.prisma.antibioticPanel.findFirst({ where: { orgId, name: p.name } })) continue;
      const abx = await this.prisma.antibiotic.findMany({ where: { orgId, code: { in: p.antibiotics } } });
      await this.prisma.antibioticPanel.create({ data: { orgId, name: p.name, organismGroup: p.organismGroup, items: { create: p.antibiotics.map((c, i) => ({ orgId, antibioticId: abx.find((a) => a.code === c)!.id, position: i })) } } });
      created++;
    }
    return { created };
  }

  // --------------------------------------------------------------- cases
  async open(u: AuthUser, b: { orderItemId: string; site?: string; gramStain?: string; cultureMedia?: string[] }) {
    const item = await this.prisma.orderItem.findFirst({ where: { id: b.orderItemId, order: { orgId: u.orgId } }, include: { test: true } });
    if (!item) throw new NotFoundException({ code: "ORDER_ITEM_NOT_FOUND" });
    if (item.test.section !== "MICROBIOLOGY") throw new UnprocessableEntityException({ code: "NOT_A_MICROBIOLOGY_TEST", section: item.test.section });
    if (!item.specimenId) throw new ConflictException({ code: "NO_SPECIMEN" });
    const sp = await this.prisma.specimen.findUniqueOrThrow({ where: { id: item.specimenId } });
    if (!["RECEIVED", "PROCESSING"].includes(sp.status)) throw new ConflictException({ code: "SPECIMEN_NOT_RECEIVED", status: sp.status });
    if (await this.prisma.microbiologyCase.findUnique({ where: { orderItemId: item.id } })) throw new ConflictException({ code: "CASE_EXISTS" });
    const row = await this.prisma.microbiologyCase.create({ data: { orgId: u.orgId, orderItemId: item.id, specimenId: sp.id, site: b.site, gramStain: b.gramStain, cultureMedia: b.cultureMedia ?? [], enteredBy: u.staffId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "micro.open", entityType: "MicrobiologyCase", entityId: row.id });
    return this.get(u.orgId, row.id);
  }

  async list(u: AuthUser, q: { status?: string }) {
    const rows = await this.prisma.microbiologyCase.findMany({ where: { orgId: u.orgId, ...(q.status ? { status: q.status as MicroStatus } : {}) }, orderBy: { createdAt: "desc" }, take: 200, include: { _count: { select: { isolates: true } } } });
    const items = await this.prisma.orderItem.findMany({ where: { id: { in: rows.map((r) => r.orderItemId) } }, select: { id: true, order: { select: { id: true, orderNumber: true, priority: true, patient: { select: { fullName: true } } } }, test: { select: { code: true, nameEn: true } } } });
    return rows.map((r) => ({ ...r, isolateCount: r._count.isolates, item: items.find((i) => i.id === r.orderItemId) ?? null }));
  }

  async get(orgId: string, id: string) {
    const c = await this.prisma.microbiologyCase.findFirst({ where: { id, orgId }, include: { isolates: { orderBy: { isolateNo: "asc" }, include: { organism: true, susceptibilities: { include: { antibiotic: true } } } } } });
    if (!c) throw new NotFoundException({ code: "CASE_NOT_FOUND" });
    const item = await this.prisma.orderItem.findUnique({ where: { id: c.orderItemId }, select: { id: true, test: { select: { code: true, nameEn: true } }, order: { select: { id: true, orderNumber: true, priority: true, patient: { select: { fullName: true, sex: true, dateOfBirth: true } } } } } });
    return { ...c, item, isolates: c.isolates.map((i) => ({ ...i, susceptibilities: i.susceptibilities.map((s) => ({ ...s, micMgL: s.micMgL == null ? null : D(s.micMgL) })) })) };
  }

  private async openCase(orgId: string, id: string) {
    const c = await this.prisma.microbiologyCase.findFirst({ where: { id, orgId } });
    if (!c) throw new NotFoundException({ code: "CASE_NOT_FOUND" });
    if (c.status === "FINAL") throw new ConflictException({ code: "CASE_FINAL", message: "a finalised case is changed by correcting the released result" });
    return c;
  }

  async update(u: AuthUser, id: string, b: { site?: string; gramStain?: string; cultureMedia?: string[]; status?: "INCUBATING" | "PRELIMINARY"; growth?: boolean; comment?: string }) {
    const c = await this.openCase(u.orgId, id);
    if (b.status === "INCUBATING" && c.status !== "RECEIVED") throw new ConflictException({ code: "ILLEGAL_CASE_TRANSITION", from: c.status });
    if (b.status === "PRELIMINARY" && c.status === "RECEIVED") throw new ConflictException({ code: "ILLEGAL_CASE_TRANSITION", from: c.status });
    if (b.growth === false && (await this.prisma.microbiologyIsolate.count({ where: { caseId: id } }))) throw new ConflictException({ code: "ISOLATES_EXIST", message: "remove isolates before recording no growth" });
    await this.prisma.microbiologyCase.update({ where: { id }, data: { site: b.site, gramStain: b.gramStain, cultureMedia: b.cultureMedia, status: b.status, growth: b.growth, comment: b.comment, ...(b.status === "INCUBATING" ? { incubationStartedAt: new Date() } : {}) } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "micro.update", entityType: "MicrobiologyCase", entityId: id, meta: { fields: Object.keys(b) } });
    return this.get(u.orgId, id);
  }

  async addIsolate(u: AuthUser, id: string, b: { organismId: string; quantity?: string; note?: string }) {
    const c = await this.openCase(u.orgId, id);
    if (c.growth === false) throw new ConflictException({ code: "NO_GROWTH_RECORDED" });
    if (!(await this.prisma.organism.findFirst({ where: { id: b.organismId, orgId: u.orgId, active: true } }))) throw new NotFoundException({ code: "ORGANISM_NOT_FOUND" });
    const n = (await this.prisma.microbiologyIsolate.count({ where: { caseId: id } })) + 1;
    await this.prisma.$transaction([
      this.prisma.microbiologyIsolate.create({ data: { orgId: u.orgId, caseId: id, organismId: b.organismId, isolateNo: n, quantity: b.quantity, note: b.note } }),
      this.prisma.microbiologyCase.update({ where: { id }, data: { growth: true, status: c.status === "RECEIVED" ? "PRELIMINARY" : c.status } }),
    ]);
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "micro.isolate_add", entityType: "MicrobiologyCase", entityId: id });
    return this.get(u.orgId, id);
  }

  async removeIsolate(u: AuthUser, id: string, isolateId: string) {
    await this.openCase(u.orgId, id);
    const iso = await this.prisma.microbiologyIsolate.findFirst({ where: { id: isolateId, caseId: id, orgId: u.orgId } });
    if (!iso) throw new NotFoundException({ code: "ISOLATE_NOT_FOUND" });
    await this.prisma.microbiologyIsolate.delete({ where: { id: isolateId } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "micro.isolate_remove", entityType: "MicrobiologyCase", entityId: id });
    return this.get(u.orgId, id);
  }

  /** Sets (upserts) the susceptibility results of one isolate. Interpretation comes from the bench's own breakpoint tables (not computed here). */
  async setSusceptibilities(u: AuthUser, id: string, isolateId: string, rows: SusceptibilityInput[]) {
    await this.openCase(u.orgId, id);
    const iso = await this.prisma.microbiologyIsolate.findFirst({ where: { id: isolateId, caseId: id, orgId: u.orgId } });
    if (!iso) throw new NotFoundException({ code: "ISOLATE_NOT_FOUND" });
    const abx = await this.prisma.antibiotic.findMany({ where: { orgId: u.orgId, id: { in: rows.map((r) => r.antibioticId) } } });
    if (abx.length !== new Set(rows.map((r) => r.antibioticId)).size) throw new NotFoundException({ code: "ANTIBIOTIC_NOT_FOUND" });
    await this.prisma.$transaction(rows.map((r) => this.prisma.microbiologySusceptibility.upsert({
      where: { isolateId_antibioticId: { isolateId, antibioticId: r.antibioticId } },
      create: { orgId: u.orgId, isolateId, antibioticId: r.antibioticId, method: r.method ?? "DISK", micMgL: r.micMgL, zoneMm: r.zoneMm, interpretation: r.interpretation, reported: r.reported ?? true },
      update: { method: r.method ?? "DISK", micMgL: r.micMgL, zoneMm: r.zoneMm, interpretation: r.interpretation, reported: r.reported ?? true },
    })));
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "micro.susceptibility", entityType: "MicrobiologyCase", entityId: id, meta: { isolateId, count: rows.length } });
    return this.get(u.orgId, id);
  }

  /** Final report: builds the text, writes the structured result (needs QC cover on the instrument), raises a critical alert for a positive blood culture. */
  async finalize(u: AuthUser, id: string, b: { instrumentId: string; comment?: string }) {
    const c = await this.get(u.orgId, id);
    if (c.status === "FINAL") throw new ConflictException({ code: "CASE_FINAL" });
    if (c.growth == null) throw new ConflictException({ code: "GROWTH_NOT_RECORDED" });
    if (c.growth && !c.isolates.length) throw new ConflictException({ code: "ISOLATE_REQUIRED" });
    const missing = missingSusceptibility(c.isolates.map((i) => ({ organism: i.organism.nameEn, gram: i.organism.gram, reportedCount: i.susceptibilities.filter((s) => s.reported).length })));
    if (missing.length) throw new ConflictException({ code: "SUSCEPTIBILITY_REQUIRED", organisms: missing });
    const hours = c.incubationStartedAt ? Math.max(1, Math.round((Date.now() - c.incubationStartedAt.getTime()) / 3_600_000)) : null;
    const text = summarizeCase({ site: c.site, growth: c.growth, hours, comment: b.comment ?? c.comment, isolates: c.isolates.map((i) => ({ organism: i.organism.nameEn, quantity: i.quantity, susceptibilities: i.susceptibilities.map((s) => ({ antibiotic: s.antibiotic.nameEn, interpretation: s.interpretation, reported: s.reported })) })) });
    const item = await this.prisma.orderItem.findUniqueOrThrow({ where: { id: c.orderItemId }, include: { test: { include: { analytes: { orderBy: { position: "asc" } } } } } });
    const analyteId = item.test.analytes[0]?.analyteId;
    if (!analyteId) throw new ConflictException({ code: "TEST_HAS_NO_ANALYTE" });
    const blood = /blood/i.test(c.site ?? "") || /blood/i.test(item.test.nameEn);
    return this.prisma.$transaction(async (tx) => {
      const result = await this.results.enterStructured(u, tx, { orderItemId: c.orderItemId, instrumentId: b.instrumentId, analyteId, valueText: text, flag: c.growth ? "ABNORMAL" : "NORMAL", critical: Boolean(c.growth && blood) });
      await tx.microbiologyCase.update({ where: { id }, data: { status: "FINAL", finalizedBy: u.staffId, finalizedAt: new Date(), resultId: result.id, comment: b.comment ?? c.comment } });
      await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "micro.finalize", entityType: "MicrobiologyCase", entityId: id, meta: { resultId: result.id, growth: c.growth } }, tx);
      return { caseId: id, resultId: result.id, text };
    });
  }
}
