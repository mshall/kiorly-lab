import { HttpException, HttpStatus } from "@nestjs/common";

/** Uniform API error { statusCode, code, message, details? } (same shape as Clinic and Pharmacy). */
export class DomainError extends HttpException {
  constructor(public readonly code: string, message: string, status: number = HttpStatus.UNPROCESSABLE_ENTITY, public readonly details?: unknown) {
    super({ statusCode: status, code, message, ...(details !== undefined ? { details } : {}) }, status);
  }
}
export const forbidden = (code: string, message: string, details?: unknown) => new DomainError(code, message, HttpStatus.FORBIDDEN, details);
