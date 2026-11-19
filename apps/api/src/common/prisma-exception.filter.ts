import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";

/** Maps database-level safety invariants and constraint errors to clean API errors (never leaks SQL). */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientUnknownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(e: Error & { code?: string; meta?: unknown }, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<{ status: (n: number) => { json: (b: unknown) => void } }>();
    const msg = e.message ?? "";
    if (e.code === "P2002") return res.status(HttpStatus.CONFLICT).json({ statusCode: 409, code: "UNIQUE_VIOLATION", target: (e.meta as { target?: unknown } | undefined)?.target });
    if (e.code === "P2025") return res.status(HttpStatus.NOT_FOUND).json({ statusCode: 404, code: "NOT_FOUND" });
    if (/append-only|immutable|cannot be released|check_violation|result_release_requires|report_version_signed|critical_alert_deadline/i.test(msg)) {
      return res.status(HttpStatus.CONFLICT).json({ statusCode: 409, code: "SAFETY_INVARIANT", message: msg.split("\n").pop()?.slice(0, 300) });
    }
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, code: "INTERNAL_ERROR" });
  }
}
