import { Controller, Get, NotFoundException } from "@nestjs/common";
import { CurrentUser } from "../../common/guards/decorators";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";

@Controller({ path: "users", version: "1" })
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("me")
  async me(@CurrentUser() user: AuthenticatedUser) {
    const record = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        phone: true,
        phoneVerifiedAt: true,
        firstName: true,
        lastName: true,
        locale: true,
        avatarUrl: true,
        createdAt: true,
        memberships: {
          select: {
            communityId: true,
            status: true,
            community: { select: { name: true, defaultCurrency: true } },
          },
        },
        driverProfile: {
          select: { id: true, verificationStatus: true, isOnline: true },
        },
      },
    });
    if (!record) throw new NotFoundException();
    return { ...record, roles: user.roles };
  }
}
