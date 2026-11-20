import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** Money/offline paths: replays with the same Idempotency-Key return the stored response instead of re-executing. */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async run<T>(orgId: string, scope: string, key: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!key) throw new BadRequestException({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    const hit = await this.prisma.idempotencyRecord.findUnique({ where: { orgId_scope_key: { orgId, scope, key } } });
    if (hit) return hit.response as T;
    const out = await fn();
    try {
      await this.prisma.idempotencyRecord.create({ data: { orgId, scope, key, response: JSON.parse(JSON.stringify(out ?? null)) as Prisma.InputJsonValue } });
    } catch {
      /* concurrent duplicate stored first: fine */
    }
    return out;
  }
}
