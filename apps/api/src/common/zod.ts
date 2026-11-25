import { ApiBody } from "@nestjs/swagger";
import { BadRequestException, CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor, SetMetadata, applyDecorators } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { z } from "zod";
import type { Observable } from "rxjs";

export const ZOD_BODY = "kx:zod-body";
export const ZOD_QUERY = "kx:zod-query";

/**
 * zod emits JSON Schema 2020-12; the document is OpenAPI 3.0, which has no `type: "null"`, no `$schema` and no `const`. `null` members of an `anyOf` become `nullable: true`, a `type` array with "null"
 * becomes `nullable`, `const` becomes a one-value `enum`. Docs only: validation still uses the zod schema.
 */
export function toOpenApi30(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toOpenApi30);
  if (!node || typeof node !== "object") return node;
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) o[k] = toOpenApi30(v);
  delete o.$schema; delete o.propertyNames;
  for (const [ex, bound] of [["exclusiveMinimum", "minimum"], ["exclusiveMaximum", "maximum"]] as const) if (typeof o[ex] === "number") { o[bound] = o[ex]; o[ex] = true; }
  if ("const" in o) { o.enum = [o.const]; delete o.const; }
  if (Array.isArray(o.type)) { const t = (o.type as string[]).filter((x) => x !== "null"); if (t.length !== o.type.length) o.nullable = true; o.type = t.length === 1 ? t[0] : undefined; if (o.type === undefined) delete o.type; }
  for (const key of ["anyOf", "oneOf"] as const) {
    const arr = o[key];
    if (!Array.isArray(arr)) continue;
    const rest = arr.filter((m) => !(m && typeof m === "object" && (m as { type?: unknown }).type === "null"));
    if (rest.length === arr.length) continue;
    o.nullable = true;
    if (rest.length === 1 && rest[0] && typeof rest[0] === "object") { delete o[key]; Object.assign(o, rest[0]); o.nullable = true; } else o[key] = rest;
  }
  if (o.type === "null") { delete o.type; o.nullable = true; }
  return o;
}

/** Validates req.body with a zod schema (replaces it with the parsed value) and documents it in OpenAPI. */
export function ZBody(schema: z.ZodType) {
  let json: Record<string, unknown> = { type: "object" };
  try {
    json = z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>;
    json = toOpenApi30(json) as Record<string, unknown>; // OpenAPI lint (struct): no `$schema`, no `type: "null"`
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
