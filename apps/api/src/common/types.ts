import type { Request } from "express";
import type { MembershipStatus, Role } from "@privateride/shared";

export interface AccessTokenPayload {
  sub: string; // user id
  roles: Role[];
  type: "access";
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
  membershipStatus: MembershipStatus | null;
  communityId: string | null;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
