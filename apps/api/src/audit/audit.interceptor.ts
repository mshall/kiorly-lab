import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import type { AuthedRequest } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";

/** Request-level audit of every authenticated mutating call (route template + status; no bodies, no PHI). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next.handle();
    return next.handle().pipe(
      tap({
        next: () => void this.write(req, ctx, "ok"),
        error: (e: { status?: number }) => void this.write(req, ctx, `error:${e?.status ?? 500}`),
      }),
    );
  }

  private async write(req: AuthedRequest, ctx: ExecutionContext, outcome: string) {
    if (!req.user) return;
    const res = ctx.switchToHttp().getResponse<{ statusCode?: number }>();
    try {
      await this.prisma.auditLog.create({
        data: {
          orgId: req.user.orgId,
          actorId: req.user.staffId,
          action: `http.${req.method}`,
          entityType: "request",
          entityId: req.route?.path ?? req.originalUrl.split("?")[0],
          meta: { outcome, status: res.statusCode },
        },
      });
    } catch {
      /* audit must never break the request path; domain-level audit rows are written in transactions */
    }
  }
}
