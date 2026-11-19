import { ApiBody } from "@nestjs/swagger";
import { BadRequestException, CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata, applyDecorators } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { z } from "zod";
import type { Observable } from "rxjs";

export const ZOD_BODY = "kx:zod-body";
export const ZOD_QUERY = "kx:zod-query";

/** Validates req.body with a zod schema (replaces it with the parsed value) and documents it in OpenAPI. */
export function ZBody(schema: z.ZodType) {
  let json: Record<string, unknown> = { type: "object" };
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
  } catch {
    /* docs only */
  }
  return applyDecorators(SetMetadata(ZOD_BODY, schema), ApiBody({ schema: json as never }));
}
export const ZQuery = (schema: z.ZodType) => SetMetadata(ZOD_QUERY, schema);

@Injectable()
export class ZodInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<{ body?: unknown; query?: unknown }>();
    const bodySchema = this.reflector.get<z.ZodType | undefined>(ZOD_BODY, ctx.getHandler());
    const querySchema = this.reflector.get<z.ZodType | undefined>(ZOD_QUERY, ctx.getHandler());
    if (bodySchema) req.body = parse(bodySchema, req.body ?? {});
    if (querySchema) req.query = parse(querySchema, req.query ?? {}) as never;
    return next.handle();
  }
}

function parse(schema: z.ZodType, value: unknown): unknown {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new BadRequestException({ code: "VALIDATION_FAILED", issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  }
  return r.data;
}

export { z };
