import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  DocumentStatus,
  DriverVerificationStatus,
  Prisma,
} from "@privateride/database";
import {
  LOCATION_MAX_ACCURACY_METERS,
  LOCATION_STALE_AFTER_SECONDS,
} from "@privateride/shared";
import type {
  CreateDriverProfileInput,
  CreateVehicleInput,
  LocationUpdateInput,
} from "@privateride/validation";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import { RedisService } from "../../common/redis.service";
import type { AuthenticatedUser } from "../../common/types";

export const driverAvailabilityKey = (driverProfileId: string) =>
  `driver:available:${driverProfileId}`;
export const driverLocationKey = (driverProfileId: string) =>
  `driver:location:${driverProfileId}`;

@Injectable()
export class DriversService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async getOwnProfile(userId: string) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId },
      include: { vehicles: true },
    });
    if (!profile) throw new NotFoundException("No driver profile");
    return profile;
  }

  async createProfile(actor: AuthenticatedUser, input: CreateDriverProfileInput) {
    try {
      const profile = await this.prisma.driverProfile.create({
        data: {
          userId: actor.id,
          licenseNumber: input.licenseNumber,
          verificationStatus: DriverVerificationStatus.PENDING_REVIEW,
        },
      });
      await this.audit.log({
        actorId: actor.id,
        action: "driver.profile_submitted",
        entity: "DriverProfile",
        entityId: profile.id,
      });
      return profile;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException("Driver profile already exists");
      }
      throw e;
    }
  }

  async addVehicle(actor: AuthenticatedUser, input: CreateVehicleInput) {
    const profile = await this.getOwnProfile(actor.id);
    try {
      return await this.prisma.vehicle.create({
        data: {
          driverProfileId: profile.id,
          make: input.make,
          model: input.model,
          color: input.color,
          registrationNumber: input.registrationNumber,
          category: input.category,
          seats: input.seats,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException("Vehicle registration already exists");
      }
      throw e;
    }
  }

  async setAvailability(actor: AuthenticatedUser, online: boolean) {
    const profile = await this.getOwnProfile(actor.id);
    if (
      online &&
      profile.verificationStatus !== DriverVerificationStatus.APPROVED
    ) {
      throw new ForbiddenException("Driver is not approved yet");
    }
    if (online) {
      const activeVehicle = profile.vehicles.some(
        (v) => v.active && v.verificationStatus === DocumentStatus.APPROVED,
      );
      if (!activeVehicle) {
        throw new BadRequestException("No approved active vehicle");
      }
    }
    await this.prisma.driverProfile.update({
      where: { id: profile.id },
      data: { isOnline: online, lastOnlineAt: online ? new Date() : undefined },
    });
    if (online) {
      await this.redis.client.set(
        driverAvailabilityKey(profile.id),
        "1",
        "EX",
        120,
      );
    } else {
      await this.redis.client.del(driverAvailabilityKey(profile.id));
    }
    return { online };
  }

  async ingestLocation(actor: AuthenticatedUser, input: LocationUpdateInput) {
    const profile = await this.prisma.driverProfile.findUnique({
      where: { userId: actor.id },
      select: { id: true, isOnline: true },
    });
    if (!profile) throw new NotFoundException("No driver profile");
    if (!profile.isOnline) {
      throw new BadRequestException("Driver is offline; location not accepted");
    }
    if (
      input.accuracyM !== undefined &&
      input.accuracyM > LOCATION_MAX_ACCURACY_METERS
    ) {
      return { accepted: false, reason: "accuracy_too_low" };
    }
    const ageS = (Date.now() - input.recordedAt.getTime()) / 1000;
    if (ageS > LOCATION_STALE_AFTER_SECONDS || ageS < -30) {
      return { accepted: false, reason: "stale_or_future_timestamp" };
    }

    await this.prisma.$executeRaw`
      INSERT INTO "DriverLocation" ("driverProfileId", "point", "accuracyM", "recordedAt", "updatedAt")
      VALUES (
        ${profile.id}::uuid,
        ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
        ${input.accuracyM ?? null},
        ${input.recordedAt},
        NOW()
      )
      ON CONFLICT ("driverProfileId") DO UPDATE SET
        "point" = EXCLUDED."point",
        "accuracyM" = EXCLUDED."accuracyM",
        "recordedAt" = EXCLUDED."recordedAt",
        "updatedAt" = NOW()
    `;
    await this.redis.client.set(
      driverLocationKey(profile.id),
      JSON.stringify({
        lat: input.lat,
        lng: input.lng,
        recordedAt: input.recordedAt.toISOString(),
      }),
      "EX",
      LOCATION_STALE_AFTER_SECONDS,
    );
    // Refresh availability heartbeat.
    await this.redis.client.expire(driverAvailabilityKey(profile.id), 120);
    return { accepted: true };
  }

  // --- Admin operations ---

  async adminSetDriverVerification(
    actor: AuthenticatedUser,
    driverProfileId: string,
    status: DriverVerificationStatus,
    note?: string,
  ) {
    const updated = await this.prisma.driverProfile.update({
      where: { id: driverProfileId },
      data: {
        verificationStatus: status,
        ...(status !== DriverVerificationStatus.APPROVED
          ? { isOnline: false }
          : {}),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: "driver.verification_changed",
      entity: "DriverProfile",
      entityId: driverProfileId,
      metadata: { status, note },
    });
    return { id: updated.id, verificationStatus: updated.verificationStatus };
  }

  async adminSetVehicleVerification(
    actor: AuthenticatedUser,
    vehicleId: string,
    status: DocumentStatus,
    active?: boolean,
  ) {
    const updated = await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: {
        verificationStatus: status,
        active:
          active ?? (status === DocumentStatus.APPROVED ? true : undefined),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: "vehicle.verification_changed",
      entity: "Vehicle",
      entityId: vehicleId,
      metadata: { status },
    });
    return {
      id: updated.id,
      verificationStatus: updated.verificationStatus,
      active: updated.active,
    };
  }
}
