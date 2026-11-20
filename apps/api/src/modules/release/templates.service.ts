import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ReportLanguage } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import { appConfig } from "../../config/app-config";
import { PrismaService } from "../../prisma/prisma.service";
import { renderReportPdf, type ReportModel, type ReportTemplateView } from "./report-pdf";

const MAX_LOGO = 256 * 1024;
/** PNG or JPEG only (magic bytes), so a "logo" can never be anything else. */
export function logoType(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}

export interface TemplateInput { name: string; labId?: string | null; language?: ReportLanguage; headerTitle?: string | null; headerSubtitle?: string | null; footerText?: string | null; accentColor?: string; showQr?: boolean; showRanges?: boolean }

/** M7: report templates (branding per lab, Arabic/English/bilingual) used by the PDF renderer at signing time. */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private view<T extends { logo?: Buffer | Uint8Array | null }>(t: T) {
    const { logo, ...rest } = t;
    return { ...rest, hasLogo: Boolean(logo && logo.length) };
  }

  async list(orgId: string) { return (await this.prisma.reportTemplate.findMany({ where: { orgId, active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] })).map((t) => this.view(t)); }

  async get(orgId: string, id: string) {
    const t = await this.prisma.reportTemplate.findFirst({ where: { id, orgId } });
    if (!t) throw new NotFoundException({ code: "TEMPLATE_NOT_FOUND" });
    return t;
  }

  async create(u: AuthUser, b: TemplateInput) {
    if (b.accentColor && !/^#[0-9a-fA-F]{6}$/.test(b.accentColor)) throw new BadRequestException({ code: "COLOUR_INVALID" });
    if (b.labId && !(await this.prisma.lab.findFirst({ where: { id: b.labId, orgId: u.orgId } }))) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    if (await this.prisma.reportTemplate.findFirst({ where: { orgId: u.orgId, name: b.name } })) throw new ConflictException({ code: "TEMPLATE_EXISTS" });
    const first = !(await this.prisma.reportTemplate.count({ where: { orgId: u.orgId, active: true } }));
    const row = await this.prisma.reportTemplate.create({ data: { orgId: u.orgId, ...b, isDefault: first } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "template.create", entityType: "ReportTemplate", entityId: row.id });
    return this.view(row);
  }

  async update(u: AuthUser, id: string, b: Partial<TemplateInput>) {
    await this.get(u.orgId, id);
    if (b.accentColor && !/^#[0-9a-fA-F]{6}$/.test(b.accentColor)) throw new BadRequestException({ code: "COLOUR_INVALID" });
    const row = await this.prisma.reportTemplate.update({ where: { id }, data: b });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "template.update", entityType: "ReportTemplate", entityId: id, meta: { fields: Object.keys(b) } });
    return this.view(row);
  }

  async setDefault(u: AuthUser, id: string) {
    const t = await this.get(u.orgId, id);
    await this.prisma.$transaction([
      this.prisma.reportTemplate.updateMany({ where: { orgId: u.orgId, labId: t.labId, isDefault: true }, data: { isDefault: false } }),
      this.prisma.reportTemplate.update({ where: { id }, data: { isDefault: true, active: true } }),
    ]);
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "template.default", entityType: "ReportTemplate", entityId: id });
    return this.view(await this.get(u.orgId, id));
  }

  async deactivate(u: AuthUser, id: string) {
    const t = await this.get(u.orgId, id);
    if (t.isDefault) throw new ConflictException({ code: "DEFAULT_TEMPLATE", message: "choose another default first" });
    await this.prisma.reportTemplate.update({ where: { id }, data: { active: false } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "template.deactivate", entityType: "ReportTemplate", entityId: id });
    return { id, active: false };
  }

  async setLogo(u: AuthUser, id: string, b64: string) {
    await this.get(u.orgId, id);
    const buf = Buffer.from(b64, "base64");
    if (buf.length > MAX_LOGO) throw new BadRequestException({ code: "LOGO_TOO_LARGE", maxBytes: MAX_LOGO });
    const type = logoType(buf);
    if (!type) throw new BadRequestException({ code: "LOGO_TYPE_INVALID", message: "PNG or JPEG only" });
    await this.prisma.reportTemplate.update({ where: { id }, data: { logo: buf, logoType: type } });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "template.logo", entityType: "ReportTemplate", entityId: id });
    return { id, logoType: type, bytes: buf.length };
  }

  async logo(orgId: string, id: string) {
    const t = await this.get(orgId, id);
    if (!t.logo) throw new NotFoundException({ code: "LOGO_NOT_FOUND" });
    return { data: Buffer.from(t.logo), type: t.logoType ?? "image/png" };
  }

  /** The template used to render a report for `labId`: the lab's default, else the org default, else none (built-in English layout). */
  async resolve(orgId: string, labId: string, qrPayload?: string): Promise<ReportTemplateView | undefined> {
    const rows = await this.prisma.reportTemplate.findMany({ where: { orgId, active: true, OR: [{ labId }, { labId: null }] } });
    const t = rows.find((r) => r.labId === labId && r.isDefault) ?? rows.find((r) => r.labId === null && r.isDefault) ?? rows.find((r) => r.labId === labId) ?? rows[0];
    if (!t) return undefined;
    return { language: t.language, headerTitle: t.headerTitle, headerSubtitle: t.headerSubtitle, footerText: t.footerText, accentColor: t.accentColor, showQr: t.showQr, showRanges: t.showRanges, logo: t.logo ? Buffer.from(t.logo) : null, qrPayload };
  }

  /** Sample report (synthetic patient) rendered with the template, for the designer's preview. */
  async preview(orgId: string, id: string): Promise<Buffer> {
    const t = await this.get(orgId, id);
    const lab = t.labId ? await this.prisma.lab.findFirst({ where: { id: t.labId } }) : await this.prisma.lab.findFirst({ where: { orgId }, orderBy: { createdAt: "asc" } });
    const model: ReportModel = {
      reportId: "rep_preview", version: 1, labName: lab?.name ?? "Lab", licenceNo: lab?.licenceNo, orderNumber: "ORD-PREVIEW-000001", accessions: ["PRV2611200001"],
      patient: { name: "أميرة سامي (Amira Samy)", sex: "F", dateOfBirth: "1990-05-10" }, collectedAt: new Date().toISOString(), signedBy: "Dr. Preview", signatoryLicenceNo: "PREVIEW-000", signedAt: new Date().toISOString(),
      lines: [
        { test: "Complete blood count", testAr: "صورة دم كاملة", analyte: "Haemoglobin", analyteAr: "الهيموجلوبين", value: "13.4", unit: "g/dL", range: "12 - 15.5", flag: "" },
        { test: "Fasting glucose", testAr: "سكر صائم", analyte: "Glucose (fasting)", analyteAr: "سكر صائم", value: "128", unit: "mg/dL", range: "70 - 100", flag: "H" },
      ],
      template: { language: t.language, headerTitle: t.headerTitle, headerSubtitle: t.headerSubtitle, footerText: t.footerText, accentColor: t.accentColor, showQr: t.showQr, showRanges: t.showRanges, logo: t.logo ? Buffer.from(t.logo) : null, qrPayload: `${appConfig.publicBaseUrl()}/verify/rep_preview` },
    };
    return renderReportPdf(model);
  }
}
