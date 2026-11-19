import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Permission } from "./rbac";
import type { AuthUser, AuthedRequest } from "./auth.types";

export const IS_PUBLIC = "kx:public";
export const PERMS = "kx:perms";
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** All listed permissions are required. */
export const Perm = (...p: Permission[]) => SetMetadata(PERMS, p);
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<AuthedRequest>().user as AuthUser);
