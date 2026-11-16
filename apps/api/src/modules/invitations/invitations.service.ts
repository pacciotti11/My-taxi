import { createHash, randomBytes } from "node:crypto";
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InvitationStatus } from "@privateride/database";
import { Role } from "@privateride/shared";
import type { CreateInvitationInput } from "@privateride/validation";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no I/L/O/0/1

function generateCode(): string {
  const bytes = randomBytes(10);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `PR-${code}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Community admins act within their own community; super admins anywhere. */
  private resolveCommunityId(actor: AuthenticatedUser, communityId?: string) {
    if (actor.roles.includes(Role.SUPER_ADMIN)) {
      const id = communityId ?? actor.communityId;
      if (!id) throw new ForbiddenException("communityId is required");
      return id;
    }
    if (!actor.communityId) {
      throw new ForbiddenException("Admin has no community");
    }
    if (communityId && communityId !== actor.communityId) {
      throw new ForbiddenException("Cannot act outside your community");
    }
    return actor.communityId;
  }

  async create(
    actor: AuthenticatedUser,
    input: CreateInvitationInput,
    communityId?: string,
  ) {
    const targetCommunity = this.resolveCommunityId(actor, communityId);
    const rawCode = generateCode();
    const invitation = await this.prisma.invitation.create({
      data: {
        communityId: targetCommunity,
        codeHash: sha256(rawCode),
        role: input.role,
        maxUses: input.maxUses,
        expiresAt: new Date(Date.now() + input.ttlHours * 3_600_000),
        invitedEmail: input.invitedEmail,
        invitedById: actor.id,
      },
    });

    await this.audit.log({
      actorId: actor.id,
      action: "invitation.create",
      entity: "Invitation",
      entityId: invitation.id,
      metadata: { role: input.role, maxUses: input.maxUses },
    });

    // The raw code is returned exactly once and never stored.
    return {
      id: invitation.id,
      code: rawCode,
      role: invitation.role,
      maxUses: invitation.maxUses,
      expiresAt: invitation.expiresAt,
      invitedEmail: invitation.invitedEmail,
    };
  }

  async list(actor: AuthenticatedUser, communityId?: string) {
    const targetCommunity = this.resolveCommunityId(actor, communityId);
    return this.prisma.invitation.findMany({
      where: { communityId: targetCommunity },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        role: true,
        status: true,
        maxUses: true,
        usedCount: true,
        expiresAt: true,
        invitedEmail: true,
        createdAt: true,
        invitedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  }

  async revoke(actor: AuthenticatedUser, invitationId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");
    this.resolveCommunityId(actor, invitation.communityId);

    const updated = await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.log({
      actorId: actor.id,
      action: "invitation.revoke",
      entity: "Invitation",
      entityId: invitationId,
    });
    return { id: updated.id, status: updated.status };
  }
}
