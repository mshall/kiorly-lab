import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Sex } from "../../generated/prisma/client";
import type { AuthUser } from "../../auth/auth.types";
import { AuditService } from "../../audit/audit.service";
import type { Db } from "../../common/db";
import { hashNationalId } from "../../common/identity";
import { nextSequence, pad } from "../../common/db";
import { page } from "../../common/pagination";
import { PrismaService } from "../../prisma/prisma.service";

export interface PatientInput {
  fullName: string;
  dateOfBirth?: string;
  sex?: Sex;
  phone?: string;
  nationalId?: string;
  externalId?: string;
  preferredLocale?: string;
  email?: string;
  address?: string;
  city?: string;
  nationality?: string;
  bloodGroup?: string;
  notes?: string;
  conditions?: string[];
}

@Injectable()
export class PatientsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Finds an existing patient (external id, else phone + date of birth) or creates one. */
  async upsert(db: Db, orgId: string, p: PatientInput) {
    if (p.dateOfBirth && Number.isNaN(Date.parse(p.dateOfBirth))) throw new BadRequestException({ code: "DOB_INVALID" });
    const dob = p.dateOfBirth ? new Date(p.dateOfBirth) : null;
    const live = { active: true, mergedIntoId: null };
    let found = p.externalId ? await db.patientRef.findFirst({ where: { orgId, externalId: p.externalId, ...live } }) : null;
    if (!found && p.nationalId) found = await db.patientRef.findFirst({ where: { orgId, nationalIdHash: hashNationalId(p.nationalId), ...live } });
    if (!found && p.phone && dob) found = await db.patientRef.findFirst({ where: { orgId, phone: p.phone, dateOfBirth: dob, ...live } });
    if (found) return found;
    const mrn = `MRN-${pad(await nextSequence(db, orgId, "mrn"), 6)}`;
    return db.patientRef.create({
      data: {
        orgId, mrn, fullName: p.fullName, dateOfBirth: dob, sex: p.sex ?? "UNKNOWN", phone: p.phone, externalId: p.externalId,
        email: p.email, address: p.address, city: p.city, nationality: p.nationality, bloodGroup: p.bloodGroup, notes: p.notes, conditions: p.conditions ?? [],
        nationalIdHash: p.nationalId ? hashNationalId(p.nationalId) : null, nationalIdLast4: p.nationalId ? p.nationalId.replace(/\s+/g, "").slice(-4) : null,
        preferredLocale: p.preferredLocale ?? "ar",
      },
    });
  }

  async create(u: AuthUser, p: PatientInput) {
    const row = await this.upsert(this.prisma, u.orgId, p);
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.upsert", entityType: "PatientRef", entityId: row.id });
    return this.strip(row);
  }

  async list(u: AuthUser, q: { search?: string; limit?: string; offset?: string }) {
    const rows = await this.prisma.patientRef.findMany({
      where: { orgId: u.orgId, mergedIntoId: null, ...(q.search ? { OR: [{ fullName: { contains: q.search, mode: "insensitive" } }, { phone: { contains: q.search } }, { nationalIdLast4: q.search }, { mrn: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }, { nationalIdHash: hashNationalId(q.search) }] } : {}) },
      orderBy: { createdAt: "desc" }, ...page(q),
    });
    return rows.map((r) => this.strip(r));
  }

  async get(u: AuthUser, id: string) {
    const r = await this.prisma.patientRef.findFirst({ where: { id, orgId: u.orgId } });
    if (!r) throw new NotFoundException({ code: "PATIENT_NOT_FOUND" });
    await this.audit.record({ orgId: u.orgId, actorId: u.staffId, action: "patient.view", entityType: "PatientRef", entityId: id });
    return this.strip(r);
  }

  /** Never return the national id hash. */
  private strip<T extends { nationalIdHash?: string | null }>(r: T): Omit<T, "nationalIdHash"> {
    const { nationalIdHash: _h, ...rest } = r;
    void _h;
    return rest;
  }
}
