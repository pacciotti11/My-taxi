import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { VehicleCategory } from "@privateride/database";
import type { FareEstimateInput, GeoPoint } from "@privateride/validation";
import { PrismaService } from "../../common/prisma.service";
import { haversineMeters, MapsService } from "../maps/maps.service";

export interface FareEstimate {
  estimateId: string;
  currency: string;
  baseFareMinor: number;
  distanceFareMinor: number;
  timeFareMinor: number;
  totalMinor: number;
  estimatedDistanceM: number;
  estimatedDurationS: number;
  pricingRuleVersion: number;
  expiresAt: string;
}

export interface SnapshotData {
  communityId: string;
  vehicleCategory: VehicleCategory;
  currency: string;
  baseFareMinor: number;
  perKmMinor: number;
  perMinuteMinor: number;
  minimumFareMinor: number;
  cancellationFeeMinor: number;
  commissionPercent: number;
  pricingRuleVersion: number;
  estimatedDistanceM: number;
  estimatedDurationS: number;
  totalMinor: number;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  expiresAt: string;
}

const ESTIMATE_TTL_MS = 10 * 60_000;
/** Estimate is only valid for the points it was computed for (tolerance in m). */
const POINT_TOLERANCE_M = 150;

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: MapsService,
  ) {}

  computeFare(
    rule: {
      baseFareMinor: number;
      perKmMinor: number;
      perMinuteMinor: number;
      minimumFareMinor: number;
    },
    distanceM: number,
    durationS: number,
  ): { base: number; distance: number; time: number; total: number } {
    const base = rule.baseFareMinor;
    const distance = Math.round((distanceM / 1000) * rule.perKmMinor);
    const time = Math.round((durationS / 60) * rule.perMinuteMinor);
    const total = Math.max(base + distance + time, rule.minimumFareMinor);
    return { base, distance, time, total };
  }

  async estimate(
    communityId: string,
    input: FareEstimateInput,
  ): Promise<FareEstimate> {
    const rule = await this.prisma.pricingRule.findFirst({
      where: {
        communityId,
        vehicleCategory: input.vehicleCategory,
        active: true,
        validFrom: { lte: new Date() },
        OR: [{ validTo: null }, { validTo: { gte: new Date() } }],
      },
      orderBy: { version: "desc" },
    });
    if (!rule) {
      throw new NotFoundException(
        `No active pricing rule for ${input.vehicleCategory} in this community`,
      );
    }

    const route = await this.maps.route(input.pickup, input.dropoff);
    const fare = this.computeFare(rule, route.distanceM, route.durationS);
    const expiresAt = new Date(Date.now() + ESTIMATE_TTL_MS).toISOString();

    const data: SnapshotData = {
      communityId,
      vehicleCategory: rule.vehicleCategory,
      currency: rule.currency,
      baseFareMinor: rule.baseFareMinor,
      perKmMinor: rule.perKmMinor,
      perMinuteMinor: rule.perMinuteMinor,
      minimumFareMinor: rule.minimumFareMinor,
      cancellationFeeMinor: rule.cancellationFeeMinor,
      commissionPercent: Number(rule.commissionPercent),
      pricingRuleVersion: rule.version,
      estimatedDistanceM: route.distanceM,
      estimatedDurationS: route.durationS,
      totalMinor: fare.total,
      pickup: input.pickup,
      dropoff: input.dropoff,
      expiresAt,
    };

    const snapshot = await this.prisma.pricingSnapshot.create({
      data: { pricingRuleId: rule.id, data: data as unknown as object },
    });

    return {
      estimateId: snapshot.id,
      currency: rule.currency,
      baseFareMinor: fare.base,
      distanceFareMinor: fare.distance,
      timeFareMinor: fare.time,
      totalMinor: fare.total,
      estimatedDistanceM: route.distanceM,
      estimatedDurationS: route.durationS,
      pricingRuleVersion: rule.version,
      expiresAt,
    };
  }

  /** Loads and validates a snapshot for ride creation. */
  async consumeEstimate(
    estimateId: string,
    communityId: string,
    pickup: GeoPoint,
    dropoff: GeoPoint,
    vehicleCategory: VehicleCategory,
  ): Promise<{ snapshotId: string; data: SnapshotData }> {
    const snapshot = await this.prisma.pricingSnapshot.findUnique({
      where: { id: estimateId },
    });
    if (!snapshot) throw new BadRequestException("Unknown fare estimate");
    const data = snapshot.data as unknown as SnapshotData;
    if (data.communityId !== communityId) {
      throw new BadRequestException("Estimate belongs to another community");
    }
    if (new Date(data.expiresAt) < new Date()) {
      throw new BadRequestException("Fare estimate has expired");
    }
    if (data.vehicleCategory !== vehicleCategory) {
      throw new BadRequestException("Estimate is for a different vehicle category");
    }
    if (
      haversineMeters(data.pickup, pickup) > POINT_TOLERANCE_M ||
      haversineMeters(data.dropoff, dropoff) > POINT_TOLERANCE_M
    ) {
      throw new BadRequestException(
        "Estimate was computed for different pickup/dropoff points",
      );
    }
    return { snapshotId: snapshot.id, data };
  }
}
