import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../auth/auth.types";
import type { Db } from "./db";

/** Resolves the lab a request operates on, enforcing the user's lab list and tenant isolation. */
export async function resolveLabId(db: Db, user: AuthUser, requested?: string): Promise<string> {
  if (requested) {
    if (user.labIds.length && !user.labIds.includes(requested)) throw new ForbiddenException({ code: "LAB_NOT_ALLOWED" });
    const lab = await db.lab.findFirst({ where: { id: requested, orgId: user.orgId } });
    if (!lab) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
    return lab.id;
  }
  const lab = await db.lab.findFirst({ where: { orgId: user.orgId, ...(user.labIds.length ? { id: { in: user.labIds } } : {}) }, orderBy: { createdAt: "asc" } });
  if (!lab) throw new NotFoundException({ code: "LAB_NOT_FOUND" });
  return lab.id;
}
