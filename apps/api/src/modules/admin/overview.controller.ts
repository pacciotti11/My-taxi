import { Controller, Get } from "@nestjs/common";
import { Role } from "@privateride/shared";
import { CurrentUser, Roles } from "../../common/guards/decorators";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";

@Roles(Role.COMMUNITY_ADMIN, Role.SUPER_ADMIN)
@Controller({ path: "admin/overview", version: "1" })
export class AdminOverviewController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async overview(@CurrentUser() user: AuthenticatedUser) {
    const communityId = user.roles.includes(Role.SUPER_ADMIN)
      ? undefined
      : (user.communityId ?? "none");
    const membershipWhere = communityId ? { communityId } : {};
    const rideWhere = communityId ? { communityId } : {};

    const [
      totalMembers,
      activeMembers,
      pendingMembers,
      approvedDrivers,
      onlineDrivers,
      activeRides,
      completedRides,
      cancelledRides,
      captured,
      revenue,
      pendingPayouts,
    ] = await Promise.all([
      this.prisma.communityMembership.count({ where: membershipWhere }),
      this.prisma.communityMembership.count({
        where: { ...membershipWhere, status: "ACTIVE" },
      }),
      this.prisma.communityMembership.count({
        where: { ...membershipWhere, status: "PENDING_APPROVAL" },
      }),
      this.prisma.driverProfile.count({
        where: { verificationStatus: "APPROVED" },
      }),
      this.prisma.driverProfile.count({ where: { isOnline: true } }),
      this.prisma.ride.count({
        where: {
          ...rideWhere,
          status: {
            in: [
              "REQUESTED",
              "SEARCHING",
              "OFFERED",
              "ACCEPTED",
              "DRIVER_ARRIVING",
              "DRIVER_ARRIVED",
              "IN_PROGRESS",
              "PAYMENT_PENDING",
            ],
          },
        },
      }),
      this.prisma.ride.count({ where: { ...rideWhere, status: "COMPLETED" } }),
      this.prisma.ride.count({ where: { ...rideWhere, status: "CANCELLED" } }),
      this.prisma.payment.aggregate({
        where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
        _sum: { capturedMinor: true },
      }),
      this.prisma.payment.aggregate({
        where: { status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
        _sum: { platformFeeMinor: true },
      }),
      this.prisma.payout.aggregate({
        where: { status: { in: ["PENDING", "IN_TRANSIT"] } },
        _sum: { amountMinor: true },
      }),
    ]);

    return {
      members: {
        total: totalMembers,
        active: activeMembers,
        pending: pendingMembers,
      },
      drivers: { approved: approvedDrivers, online: onlineDrivers },
      rides: {
        active: activeRides,
        completed: completedRides,
        cancelled: cancelledRides,
      },
      finance: {
        capturedMinor: captured._sum.capturedMinor ?? 0,
        platformRevenueMinor: revenue._sum.platformFeeMinor ?? 0,
        outstandingPayoutsMinor: pendingPayouts._sum.amountMinor ?? 0,
      },
    };
  }

  @Get("rides")
  async recentRides(@CurrentUser() user: AuthenticatedUser) {
    const communityId = user.roles.includes(Role.SUPER_ADMIN)
      ? undefined
      : (user.communityId ?? "none");
    return this.prisma.ride.findMany({
      where: communityId ? { communityId } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        pickupAddress: true,
        dropoffAddress: true,
        currency: true,
        estimatedFareMinor: true,
        finalFareMinor: true,
        requestedAt: true,
        completedAt: true,
        passenger: { select: { firstName: true, lastName: true } },
        driver: {
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
  }

  @Get("payments")
  async recentPayments(@CurrentUser() _user: AuthenticatedUser) {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        currency: true,
        amountMinor: true,
        capturedMinor: true,
        refundedMinor: true,
        platformFeeMinor: true,
        provider: true,
        createdAt: true,
        ride: {
          select: {
            id: true,
            pickupAddress: true,
            dropoffAddress: true,
            passenger: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
  }

  @Get("drivers")
  async driversList(@CurrentUser() _user: AuthenticatedUser) {
    return this.prisma.driverProfile.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        verificationStatus: true,
        isOnline: true,
        ratingAvg: true,
        ratingCount: true,
        licenseNumber: true,
        createdAt: true,
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        vehicles: {
          select: {
            id: true,
            make: true,
            model: true,
            registrationNumber: true,
            category: true,
            verificationStatus: true,
            active: true,
          },
        },
      },
    });
  }
}
