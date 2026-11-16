import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  AssignmentStatus,
  Prisma,
  Ride,
} from "@privateride/database";
import {
  DEFAULT_MATCHING_RADII_METERS,
  DEFAULT_OFFER_TIMEOUT_SECONDS,
  LOCATION_STALE_AFTER_SECONDS,
} from "@privateride/shared";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";
import { RideEventsService } from "../realtime/ride-events.service";
import { RidesService } from "./rides.service";

export interface DriverCandidate {
  driverProfileId: string;
  distanceM: number;
}

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rides: RidesService,
    private readonly events: RideEventsService,
  ) {}

  /**
   * PostGIS candidate search. A driver qualifies when they are online,
   * APPROVED, hold an approved active vehicle of the requested category,
   * have an ACTIVE membership in the ride's community, a fresh location fix
   * inside the radius, no active ride, and no prior offer for this ride.
   */
  async findCandidates(
    ride: Ride,
    radiusM: number,
    limit = 5,
  ): Promise<DriverCandidate[]> {
    return this.prisma.$queryRaw<DriverCandidate[]>`
      SELECT
        dp.id AS "driverProfileId",
        ST_Distance(dl."point", r."pickupPoint")::float8 AS "distanceM"
      FROM "DriverProfile" dp
      JOIN "DriverLocation" dl ON dl."driverProfileId" = dp.id
      JOIN "User" u ON u.id = dp."userId" AND u."deletedAt" IS NULL
      JOIN "CommunityMembership" cm
        ON cm."userId" = u.id
       AND cm."communityId" = ${ride.communityId}::uuid
       AND cm."status" = 'ACTIVE'
      JOIN "Ride" r ON r.id = ${ride.id}::uuid
      WHERE dp."isOnline" = true
        AND dp."verificationStatus" = 'APPROVED'
        AND dl."recordedAt" > NOW() - make_interval(secs => ${LOCATION_STALE_AFTER_SECONDS})
        AND ST_DWithin(dl."point", r."pickupPoint", ${radiusM})
        AND EXISTS (
          SELECT 1 FROM "Vehicle" v
          WHERE v."driverProfileId" = dp.id
            AND v."active" = true
            AND v."verificationStatus" = 'APPROVED'
            AND v."category" = ${ride.vehicleCategory}::"VehicleCategory"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Ride" active
          WHERE active."driverId" = dp.id
            AND active."status" IN ('ACCEPTED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','PAYMENT_PENDING')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "RideAssignment" ra
          WHERE ra."rideId" = ${ride.id}::uuid
            AND ra."driverProfileId" = dp.id
        )
      ORDER BY "distanceM" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * One matching step: find the nearest unoffered candidate (expanding the
   * search radius) and create an offer. Returns the assignment or null when
   * no candidate exists at any radius.
   */
  async offerToNextDriver(rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) throw new NotFoundException("Ride not found");
    if (ride.status !== "SEARCHING") return null;

    for (const radiusM of DEFAULT_MATCHING_RADII_METERS) {
      const candidates = await this.findCandidates(ride, radiusM, 1);
      const best = candidates[0];
      if (!best) continue;

      const assignment = await this.prisma.rideAssignment.create({
        data: {
          rideId,
          driverProfileId: best.driverProfileId,
          status: AssignmentStatus.OFFERED,
          expiresAt: new Date(Date.now() + DEFAULT_OFFER_TIMEOUT_SECONDS * 1000),
        },
      });
      await this.rides.transition(rideId, "OFFERED", {
        reason: `offered_to:${best.driverProfileId}`,
      });
      this.logger.log(
        `Ride ${rideId}: offered to driver ${best.driverProfileId} (${Math.round(best.distanceM)} m)`,
      );
      await this.events.publish({
        type: "offer",
        rideId,
        driverProfileId: best.driverProfileId,
        expiresAt: assignment.expiresAt.toISOString(),
      });
      return assignment;
    }
    return null;
  }

  /** Driver accepts an offer. The DB partial unique index is the final word. */
  async acceptOffer(actor: AuthenticatedUser, rideId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: actor.id },
      include: {
        vehicles: {
          where: { active: true, verificationStatus: "APPROVED" },
          take: 1,
        },
      },
    });
    if (!profile) throw new NotFoundException("No driver profile");
    const vehicle = profile.vehicles[0];
    if (!vehicle) throw new ConflictException("No approved active vehicle");

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const assignment = await tx.rideAssignment.findUnique({
          where: {
            rideId_driverProfileId: {
              rideId,
              driverProfileId: profile.id,
            },
          },
        });
        if (!assignment || assignment.status !== AssignmentStatus.OFFERED) {
          throw new ConflictException("No pending offer for this ride");
        }
        if (assignment.expiresAt < new Date()) {
          throw new ConflictException("Offer has expired");
        }

        const ride = await this.rides.transition(
          rideId,
          "ACCEPTED",
          {
            actorId: actor.id,
            extraData: {
              driver: { connect: { id: profile.id } },
              vehicle: { connect: { id: vehicle.id } },
              acceptedAt: new Date(),
            },
          },
          tx,
        );
        await tx.rideAssignment.update({
          where: { id: assignment.id },
          data: {
            status: AssignmentStatus.ACCEPTED,
            respondedAt: new Date(),
          },
        });
        // Immediately head to pickup.
        return this.rides.transition(
          rideId,
          "DRIVER_ARRIVING",
          { actorId: actor.id },
          tx,
        );
      });
      await this.events.publish({
        type: "status",
        rideId,
        status: "DRIVER_ARRIVING",
        at: new Date().toISOString(),
      });
      return result;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // Partial unique index: this driver already holds an active ride.
        throw new ConflictException("Driver already has an active ride");
      }
      throw e;
    }
  }

  /** Driver declines; ride goes back to searching and the next driver is offered. */
  async rejectOffer(actor: AuthenticatedUser, rideId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("No driver profile");
    const assignment = await this.prisma.rideAssignment.findUnique({
      where: {
        rideId_driverProfileId: { rideId, driverProfileId: profile.id },
      },
    });
    if (!assignment || assignment.status !== AssignmentStatus.OFFERED) {
      throw new ConflictException("No pending offer for this ride");
    }
    await this.prisma.rideAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.REJECTED, respondedAt: new Date() },
    });
    await this.rides.transition(rideId, "SEARCHING", {
      actorId: actor.id,
      reason: "driver_rejected",
    });
    return this.offerToNextDriver(rideId);
  }

  /** Called by the worker when an offer passes its expiry. */
  async expireOffer(assignmentId: string) {
    const assignment = await this.prisma.rideAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!assignment || assignment.status !== AssignmentStatus.OFFERED) return null;
    if (assignment.expiresAt > new Date()) return null;
    await this.prisma.rideAssignment.update({
      where: { id: assignmentId },
      data: { status: AssignmentStatus.TIMED_OUT, respondedAt: new Date() },
    });
    await this.rides.transition(assignment.rideId, "SEARCHING", {
      reason: "offer_timed_out",
    });
    return this.offerToNextDriver(assignment.rideId);
  }

  /** Called by the worker when the overall search window closes. */
  async expireSearch(rideId: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return;
    if (ride.status === "SEARCHING" || ride.status === "REQUESTED") {
      await this.rides.transition(rideId, "EXPIRED", {
        reason: "no_driver_found",
      });
    }
  }

  /** Pending offers for the authenticated driver. */
  async myOffers(actor: AuthenticatedUser) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: actor.id },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("No driver profile");
    return this.prisma.rideAssignment.findMany({
      where: {
        driverProfileId: profile.id,
        status: AssignmentStatus.OFFERED,
        expiresAt: { gt: new Date() },
      },
      include: {
        ride: {
          select: {
            id: true,
            pickupAddress: true,
            pickupLat: true,
            pickupLng: true,
            dropoffAddress: true,
            estimatedFareMinor: true,
            currency: true,
            vehicleCategory: true,
          },
        },
      },
    });
  }
}
