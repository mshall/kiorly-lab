import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { appConfig } from "../config/app-config";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthedRequest } from "./auth.types";
import { IS_PUBLIC, PERMS } from "./decorators";
import { hasPermission, mfaSatisfied, type Permission } from "./rbac";
import { TokenService } from "./token.service";

/**
 * Global guard: authenticates (JWT aud/iss), resolves the staff row (tenant + role come from the DB, never from headers),
 * enforces privileged-MFA and RBAC. NOT flag-controlled (safety.lab.tenant_isolation, safety.lab.privileged_mfa).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const h = req.headers.authorization;
    const raw = Array.isArray(h) ? h[0] : h;
    if (!raw?.startsWith("Bearer ")) throw new UnauthorizedException({ code: "UNAUTHENTICATED" });
    const tok = await this.tokens.verify(raw.slice(7));
    const staff = await this.prisma.staffUser.findFirst({
      where: tok.staffId ? { id: tok.staffId, active: true } : { subject: tok.sub, active: true },
      include: { tenant: true },
    });
    if (!staff) throw new UnauthorizedException({ code: "UNKNOWN_STAFF" });
    if (!mfaSatisfied(staff.role, tok.amr, appConfig.mfaEnforced())) throw new ForbiddenException({ code: "MFA_REQUIRED" });
    req.user = {
      staffId: staff.id,
      orgId: staff.orgId,
      role: staff.role,
      displayName: staff.displayName,
      labIds: staff.labIds,
      marketCode: staff.tenant.marketCode,
      edition: staff.tenant.edition,
      signatoryLicenceNo: staff.signatoryLicenceNo,
    };
    const need = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMS, [ctx.getHandler(), ctx.getClass()]);
    if (need?.length && !need.every((p) => hasPermission(staff.role, p))) throw new ForbiddenException({ code: "FORBIDDEN", required: need });
    return true;
  }
}
