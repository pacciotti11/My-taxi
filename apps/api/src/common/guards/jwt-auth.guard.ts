import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { MembershipStatus, Role } from "@privateride/shared";
import { loadEnv } from "../../config/env";
import { PrismaService } from "../prisma.service";
import type { AccessTokenPayload, AuthenticatedRequest } from "../types";
import {
  IS_PUBLIC_KEY,
  REQUIRE_ACTIVE_MEMBER_KEY,
  ROLES_KEY,
} from "./decorators";

/**
 * Single guard handling authentication, role checks and membership checks.
 * Registered globally; endpoints opt out with @Public().
 *
 * Authorization is always resolved against the database on each request so
 * that suspensions and role revocations take effect immediately, not when
 * the access token expires.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice("Bearer ".length),
        { secret: loadEnv().JWT_ACCESS_SECRET },
      );
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }
    if (payload.type !== "access") {
      throw new UnauthorizedException("Wrong token type");
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        roles: { select: { role: { select: { name: true } } } },
        memberships: {
          select: { communityId: true, status: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!user) throw new UnauthorizedException("User no longer exists");

    const membership = user.memberships[0] ?? null;
    req.user = {
      id: user.id,
      roles: user.roles.map((r) => r.role.name as Role),
      membershipStatus: (membership?.status as MembershipStatus) ?? null,
      communityId: membership?.communityId ?? null,
    };

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (requiredRoles?.length) {
      const has = requiredRoles.some((r) => req.user.roles.includes(r));
      if (!has) throw new ForbiddenException("Insufficient role");
    }

    const requireActive = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ACTIVE_MEMBER_KEY,
      [context.getHandler(), context.getClass()],
    );
    // SUPER_ADMINs operate across communities and need no membership.
    if (
      requireActive &&
      !req.user.roles.includes(Role.SUPER_ADMIN) &&
      req.user.membershipStatus !== MembershipStatus.ACTIVE
    ) {
      throw new ForbiddenException(
        "Account is not an active community member",
      );
    }

    return true;
  }
}
