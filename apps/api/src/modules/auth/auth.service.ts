import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import type { RegisterInput, LoginInput } from "@privateride/validation";
import { InvitationStatus, Prisma } from "@privateride/database";
import type { Role } from "@privateride/shared";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import { loadEnv } from "../../config/env";
import { TokenService, TokenPair } from "./token.service";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB, OWASP recommendation
  timeCost: 2,
  parallelism: 1,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface AuthResult {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: Role[];
    membershipStatus: string | null;
  };
  tokens: TokenPair | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(
    input: RegisterInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthResult> {
    const codeHash = sha256(input.invitationCode.trim().toUpperCase());
    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
    const now = new Date();

    const created = await this.prisma.$transaction(async (tx) => {
      try {
        return await this.registerInTx(tx, input, passwordHash, codeHash, now);
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002"
        ) {
          throw new ConflictException(
            "An account with this email or phone already exists",
          );
        }
        throw e;
      }
    });

    await this.audit.log({
      actorId: created.user.id,
      action: "auth.register",
      entity: "User",
      entityId: created.user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return {
      user: {
        id: created.user.id,
        email: created.user.email,
        firstName: created.user.firstName,
        lastName: created.user.lastName,
        roles: [created.roleName as Role],
        membershipStatus: "PENDING_APPROVAL",
      },
      // No tokens until the membership is approved; the client polls the
      // approval status with the login endpoint.
      tokens: null,
    };
  }

  private async registerInTx(
    tx: Prisma.TransactionClient,
    input: RegisterInput,
    passwordHash: string,
    codeHash: string,
    now: Date,
  ) {
    {
      const invitation = await tx.invitation.findUnique({
        where: { codeHash },
      });
      if (!invitation || invitation.status === InvitationStatus.REVOKED) {
        throw new BadRequestException("Invalid invitation code");
      }
      if (invitation.expiresAt < now) {
        throw new BadRequestException("Invitation has expired");
      }
      if (
        invitation.status !== InvitationStatus.PENDING ||
        invitation.usedCount >= invitation.maxUses
      ) {
        throw new BadRequestException("Invitation has already been used");
      }
      if (
        invitation.invitedEmail &&
        invitation.invitedEmail !== input.email
      ) {
        throw new BadRequestException(
          "Invitation was issued for a different email address",
        );
      }

      // Guarded increment: loses the race -> affects 0 rows -> reject.
      const bumped = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          status: InvitationStatus.PENDING,
          usedCount: { lt: invitation.maxUses },
        },
        data: { usedCount: { increment: 1 } },
      });
      if (bumped.count !== 1) {
        throw new BadRequestException("Invitation has already been used");
      }

      const role = await tx.role.findUniqueOrThrow({
        where: { name: invitation.role },
      });

      const user = await tx.user.create({
        data: {
          email: input.email,
          phone: input.phone,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          locale: input.locale,
          termsAcceptedAt: now,
          privacyAcceptedAt: now,
          roles: { create: { roleId: role.id } },
          memberships: {
            create: {
              communityId: invitation.communityId,
              status: "PENDING_APPROVAL",
            },
          },
        },
      });

      const nowUsedUp = invitation.usedCount + 1 >= invitation.maxUses;
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: nowUsedUp ? InvitationStatus.USED : InvitationStatus.PENDING,
          usedById: invitation.maxUses === 1 ? user.id : undefined,
        },
      });

      return { user, roleName: role.name };
    }
  }

  async login(
    input: LoginInput,
    meta: { ip?: string; userAgent?: string },
  ): Promise<AuthResult> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
      include: {
        roles: { select: { role: { select: { name: true } } } },
        memberships: { take: 1, orderBy: { createdAt: "asc" } },
      },
    });

    // Verify against a dummy hash when the user is unknown to keep timing flat.
    const hash =
      user?.passwordHash ??
      "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    let valid = false;
    try {
      valid = await argon2.verify(hash, input.password);
    } catch {
      valid = false;
    }
    if (!user || !valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const roles = user.roles.map((r) => r.role.name as Role);
    const membership = user.memberships[0] ?? null;
    const tokens = await this.tokens.issuePair(user.id, roles, meta);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
        membershipStatus: membership?.status ?? null,
      },
      tokens,
    };
  }

  issueEmailVerificationToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, type: "email-verify" },
      { secret: loadEnv().JWT_ACCESS_SECRET, expiresIn: "24h" },
    );
  }

  async verifyEmail(token: string): Promise<void> {
    let payload: { sub: string; type: string };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: loadEnv().JWT_ACCESS_SECRET,
      });
    } catch {
      throw new BadRequestException("Invalid or expired verification token");
    }
    if (payload.type !== "email-verify") {
      throw new BadRequestException("Wrong token type");
    }
    try {
      await this.prisma.user.update({
        where: { id: payload.sub },
        data: { emailVerifiedAt: new Date() },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2025"
      ) {
        throw new BadRequestException("User not found");
      }
      throw e;
    }
  }

  async requestAccountDeletion(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { deletionRequestedAt: new Date() },
    });
    await this.tokens.revokeAllForUser(userId);
    await this.audit.log({
      actorId: userId,
      action: "auth.deletion_requested",
      entity: "User",
      entityId: userId,
    });
  }
}
