import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Role } from "@privateride/shared";
import { loadEnv } from "../../config/env";
import { PrismaService } from "../../common/prisma.service";
import type { AccessTokenPayload } from "../../common/types";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async issuePair(
    userId: string,
    roles: Role[],
    meta: { ip?: string; userAgent?: string },
    familyId?: string,
  ): Promise<TokenPair> {
    const env = loadEnv();
    const payload: AccessTokenPayload = { sub: userId, roles, type: "access" };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_TTL,
    });

    const refreshToken = randomBytes(48).toString("base64url");
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        familyId: familyId ?? randomUUID(),
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return { accessToken, refreshToken, accessExpiresIn: env.JWT_ACCESS_TTL };
  }

  /**
   * Rotates a refresh token. Reuse of an already-rotated token is treated as
   * theft: the whole family is revoked and the caller must log in again.
   */
  async rotate(
    rawToken: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ pair: TokenPair; userId: string; roles: Role[] }> {
    const tokenHash = sha256(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            deletedAt: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        },
      },
    });

    if (!existing || existing.user.deletedAt) {
      throw new UnauthorizedException("Invalid refresh token");
    }
    if (existing.revokedAt) {
      // Token reuse detected -> revoke entire family.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected");
    }
    if (existing.expiresAt < new Date()) {
      throw new UnauthorizedException("Refresh token expired");
    }

    const roles = existing.user.roles.map((r) => r.role.name as Role);
    const pair = await this.issuePair(
      existing.userId,
      roles,
      meta,
      existing.familyId,
    );
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return { pair, userId: existing.userId, roles };
  }

  async revokeFamilyByToken(rawToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      select: { familyId: true },
    });
    if (!existing) return; // Idempotent logout.
    await this.prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
