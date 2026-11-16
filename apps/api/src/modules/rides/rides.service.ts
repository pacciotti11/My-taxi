import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  CancelledBy,
  Prisma,
  Ride,
  RideStatus as DbRideStatus,
} from "@privateride/database";
import { canTransition, RideStatus, Role } from "@privateride/shared";
import type { CancelRideInput, RequestRideInput } from "@privateride/validation";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";
import { PricingService } from "../pricing/pricing.service";
import { RideEventsService } from "../realtime/ride-events.service";

export interface TransitionContext {
  actorId?: string | null;
  reason?: string;
  extraData?: Prisma.RideUpdateInput;
}

@Injectable()
export class RidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly events: RideEventsService,
  ) {}

  /**
   * The only way a ride status changes. Locks the ride row, validates the
   * transition against the shared state machine, persists the change plus a
   * history record in one transaction.
   */
  async transition(
    rideId: string,
    to: DbRideStatus,
    ctx: TransitionContext = {},
    tx?: Prisma.TransactionClient,
  ): Promise<Ride> {
    const run = async (client: Prisma.TransactionClient): Promise<Ride> => {
      const rows = await client.$queryRaw<{ status: DbRideStatus }[]>`
        SELECT "status" FROM "Ride" WHERE id = ${rideId}::uuid FOR UPDATE
      `;
      const current = rows[0]?.status;
      if (!current) throw new NotFoundException("Ride not found");
      if (!canTransition(current as RideStatus, to as RideStatus)) {
        throw new ConflictException(
          `Illegal ride transition ${current} -> ${to}`,
        );
      }
      const updated = await client.ride.update({
        where: { id: rideId },
        data: { status: to, ...(ctx.extraData ?? {}) },
      });
      await client.rideStatusHistory.create({
        data: {
          rideId,
          fromStatus: current,
          toStatus: to,
          actorId: ctx.actorId ?? null,
          reason: ctx.reason,
        },
      });
      return updated;
    };
    // With a caller-provided transaction the caller publishes the event
    // after commit; here we own the transaction and publish on success.
    if (tx) return run(tx);
    const result = await this.prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    await this.events.publish({
      type: "status",
      rideId,
      status: to,
      at: new Date().toISOString(),
    });
    return result;
  }

  async requestRide(
    actor: AuthenticatedUser,
    input: RequestRideInput,
  ): Promise<Ride> {
    if (!actor.communityId) {
      throw new ForbiddenException("No community membership");
    }
    const { snapshotId, data } = await this.pricing.consumeEstimate(
      input.estimateId,
      actor.communityId,
      input.pickup,
      input.dropoff,
      input.vehicleCategory,
    );

    let ride: Ride;
    try {
      ride = await this.prisma.ride.create({
        data: {
          communityId: actor.communityId,
          passengerId: actor.id,
          status: "REQUESTED",
          vehicleCategory: input.vehicleCategory,
          pickupAddress: input.pickupAddress,
          pickupLat: input.pickup.lat,
          pickupLng: input.pickup.lng,
          dropoffAddress: input.dropoffAddress,
          dropoffLat: input.dropoff.lat,
          dropoffLng: input.dropoff.lng,
          currency: data.currency,
          estimatedDistanceM: data.estimatedDistanceM,
          estimatedDurationS: data.estimatedDurationS,
          estimatedFareMinor: data.totalMinor,
          pricingSnapshotId: snapshotId,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException("You already have an active ride");
      }
      throw e;
    }

    // Populate geography columns for spatial queries.
    await this.prisma.$executeRaw`
      UPDATE "Ride" SET
        "pickupPoint" = ST_SetSRID(ST_MakePoint(${input.pickup.lng}, ${input.pickup.lat}), 4326)::geography,
        "dropoffPoint" = ST_SetSRID(ST_MakePoint(${input.dropoff.lng}, ${input.dropoff.lat}), 4326)::geography
      WHERE id = ${ride.id}::uuid
    `;
    await this.prisma.rideStatusHistory.create({
      data: { rideId: ride.id, toStatus: "REQUESTED", actorId: actor.id },
    });

    return this.transition(ride.id, "SEARCHING", { actorId: actor.id });
  }

  async getRideForParticipant(
    actor: AuthenticatedUser,
    rideId: string,
  ): Promise<Ride & { isPassenger: boolean; isDriver: boolean }> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        driver: {
          select: {
            id: true,
            userId: true,
            ratingAvg: true,
            user: { select: { firstName: true, lastName: true, phone: true } },
          },
        },
        vehicle: {
          select: {
            make: true,
            model: true,
            color: true,
            registrationNumber: true,
          },
        },
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!ride) throw new NotFoundException("Ride not found");
    const isPassenger = ride.passengerId === actor.id;
    const isDriver = ride.driver?.userId === actor.id;
    const isAdmin =
      actor.roles.includes(Role.SUPER_ADMIN) ||
      (actor.roles.includes(Role.COMMUNITY_ADMIN) &&
        actor.communityId === ride.communityId);
    if (!isPassenger && !isDriver && !isAdmin) {
      // 404, not 403: do not leak ride existence to strangers.
      throw new NotFoundException("Ride not found");
    }
    return Object.assign(ride, { isPassenger, isDriver });
  }

  async listMyRides(actor: AuthenticatedUser) {
    return this.prisma.ride.findMany({
      where: {
        OR: [
          { passengerId: actor.id },
          { driver: { userId: actor.id } },
        ],
      },
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
      },
    });
  }

  async cancelByPassenger(
    actor: AuthenticatedUser,
    rideId: string,
    input: CancelRideInput,
  ): Promise<Ride> {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.passengerId !== actor.id) {
      throw new NotFoundException("Ride not found");
    }
    const cancelled = await this.transition(rideId, "CANCELLED", {
      actorId: actor.id,
      reason: input.reason ?? "cancelled_by_passenger",
      extraData: {
        cancelledAt: new Date(),
        cancelledBy: CancelledBy.PASSENGER,
        cancelReason: input.reason,
      },
    });
    // Close any outstanding driver offers.
    await this.prisma.rideAssignment.updateMany({
      where: { rideId, status: "OFFERED" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });
    return cancelled;
  }

  /** Driver lifecycle actions; each verifies the caller is the assigned driver. */
  private async loadRideForAssignedDriver(
    actor: AuthenticatedUser,
    rideId: string,
  ): Promise<Ride> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { driver: { select: { userId: true } } },
    });
    if (!ride || ride.driver?.userId !== actor.id) {
      throw new NotFoundException("Ride not found");
    }
    return ride;
  }

  async driverArrived(actor: AuthenticatedUser, rideId: string): Promise<Ride> {
    await this.loadRideForAssignedDriver(actor, rideId);
    return this.transition(rideId, "DRIVER_ARRIVED", {
      actorId: actor.id,
      extraData: { arrivedAt: new Date() },
    });
  }

  async startRide(actor: AuthenticatedUser, rideId: string): Promise<Ride> {
    await this.loadRideForAssignedDriver(actor, rideId);
    return this.transition(rideId, "IN_PROGRESS", {
      actorId: actor.id,
      extraData: { startedAt: new Date() },
    });
  }

  async completeRide(actor: AuthenticatedUser, rideId: string): Promise<Ride> {
    const ride = await this.loadRideForAssignedDriver(actor, rideId);
    const startedAt = ride.startedAt ?? new Date();
    const durationS = Math.max(
      60,
      Math.round((Date.now() - startedAt.getTime()) / 1000),
    );
    // Final fare: recompute time component from actual duration; distance
    // stays the estimate until real GPS-trace distance lands in M4.
    const snapshot = ride.pricingSnapshotId
      ? await this.prisma.pricingSnapshot.findUnique({
          where: { id: ride.pricingSnapshotId },
        })
      : null;
    let finalFareMinor = ride.estimatedFareMinor ?? 0;
    if (snapshot) {
      const d = snapshot.data as unknown as {
        baseFareMinor: number;
        perKmMinor: number;
        perMinuteMinor: number;
        minimumFareMinor: number;
        estimatedDistanceM: number;
      };
      const fare = this.pricing.computeFare(
        d,
        ride.actualDistanceM ?? d.estimatedDistanceM,
        durationS,
      );
      finalFareMinor = fare.total;
    }
    return this.transition(rideId, "PAYMENT_PENDING", {
      actorId: actor.id,
      extraData: {
        completedAt: new Date(),
        actualDurationS: durationS,
        finalFareMinor,
      },
    });
  }
}
