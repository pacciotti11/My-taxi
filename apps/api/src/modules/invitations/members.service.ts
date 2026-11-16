import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { MembershipStatus as DbMembershipStatus } from "@privateride/database";
import { Role } from "@privateride/shared";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async loadMembership(actor: AuthenticatedUser, membershipId: string) {
    const membership = await this.prisma.communityMembership.findUnique({
      where: { id: membershipId },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
    });
    if (!membership) throw new NotFoundException("Membership not found");
    if (
      !actor.roles.includes(Role.SUPER_ADMIN) &&
      membership.communityId !== actor.communityId
    ) {
      throw new ForbiddenException("Cannot manage members of another community");
    }
    return membership;
  }

  async list(
    actor: AuthenticatedUser,
    filter: { status?: DbMembershipStatus },
  ) {
    const communityId = actor.roles.includes(Role.SUPER_ADMIN)
      ? undefined
      : (actor.communityId ?? "none");
    return this.prisma.communityMembership.findMany({
      where: { communityId, status: filter.status },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        status: true,
        createdAt: true,
        approvedAt: true,
        suspendedAt: true,
        suspendedReason: true,
        communityId: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        },
      },
    });
  }

  async approve(actor: AuthenticatedUser, membershipId: string) {
    const membership = await this.loadMembership(actor, membershipId);
    if (
      membership.status !== DbMembershipStatus.PENDING_APPROVAL &&
      membership.status !== DbMembershipStatus.SUSPENDED
    ) {
      throw new BadRequestException(
        `Cannot approve a membership in status ${membership.status}`,
      );
    }
    const updated = await this.prisma.communityMembership.update({
      where: { id: membershipId },
      data: {
        status: DbMembershipStatus.ACTIVE,
        approvedAt: new Date(),
        approvedBy: actor.id,
        suspendedAt: null,
        suspendedReason: null,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: "membership.approve",
      entity: "CommunityMembership",
      entityId: membershipId,
      metadata: { userId: membership.user.id },
    });
    return { id: updated.id, status: updated.status };
  }

  async reject(actor: AuthenticatedUser, membershipId: string, reason?: string) {
    const membership = await this.loadMembership(actor, membershipId);
    if (membership.status !== DbMembershipStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Cannot reject a membership in status ${membership.status}`,
      );
    }
    const updated = await this.prisma.communityMembership.update({
      where: { id: membershipId },
      data: { status: DbMembershipStatus.REJECTED, suspendedReason: reason },
    });
    await this.audit.log({
      actorId: actor.id,
      action: "membership.reject",
      entity: "CommunityMembership",
      entityId: membershipId,
      metadata: { userId: membership.user.id, reason },
    });
    return { id: updated.id, status: updated.status };
  }

  async suspend(actor: AuthenticatedUser, membershipId: string, reason?: string) {
    const membership = await this.loadMembership(actor, membershipId);
    if (membership.status !== DbMembershipStatus.ACTIVE) {
      throw new BadRequestException(
        `Cannot suspend a membership in status ${membership.status}`,
      );
    }
    const updated = await this.prisma.communityMembership.update({
      where: { id: membershipId },
      data: {
        status: DbMembershipStatus.SUSPENDED,
        suspendedAt: new Date(),
        suspendedReason: reason,
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: "membership.suspend",
      entity: "CommunityMembership",
      entityId: membershipId,
      metadata: { userId: membership.user.id, reason },
    });
    return { id: updated.id, status: updated.status };
  }
}
