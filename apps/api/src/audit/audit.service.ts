import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Db } from "../common/db";

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Ids and field names only. No PHI (names, phones, result values). */
  meta?: Record<string, unknown>;
}

/** safety.lab.audit_logging: state changes affecting results, access, money are audited (append-only table). */
@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async record(input: AuditInput, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        orgId: input.orgId,
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        meta: (input.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
