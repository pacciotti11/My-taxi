import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from "@nestjs/common";
import type { Role } from "@privateride/shared";
import type { AuthenticatedRequest, AuthenticatedUser } from "../types";

export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const REQUIRE_ACTIVE_MEMBER_KEY = "requireActiveMember";
/** Endpoint requires an ACTIVE community membership (not merely a valid token). */
export const RequireActiveMember = () =>
  SetMetadata(REQUIRE_ACTIVE_MEMBER_KEY, true);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user;
  },
);
