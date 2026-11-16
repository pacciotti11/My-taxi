import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  Payment,
  PaymentStatus,
  Prisma,
  Ride,
} from "@privateride/database";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import type { AuthenticatedUser } from "../../common/types";
import { RidesService } from "../rides/rides.service";
import { Accounts, LedgerService } from "./ledger.service";
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from "./payment-provider.interface";

interface SnapshotFareData {
  commissionPercent: number;
  cancellationFeeMinor: number;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rides: RidesService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  // ------------------------------------------------------------------
  // Payment methods (tokens only; raw card data never reaches this API)
  // ------------------------------------------------------------------

  async addMethod(
    actor: AuthenticatedUser,
    input: { token: string; brand?: string; last4?: string },
  ) {
    const count = await this.prisma.paymentMethod.count({
      where: { userId: actor.id, deletedAt: null },
    });
    try {
      return await this.prisma.paymentMethod.create({
        data: {
          userId: actor.id,
          provider: this.provider.name,
          providerRef: input.token,
          brand: input.brand,
          last4: input.last4,
          isDefault: count === 0,
        },
        select: {
          id: true,
          provider: true,
          brand: true,
          last4: true,
          isDefault: true,
        },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        throw new ConflictException("Payment method already registered");
      }
      throw e;
    }
  }

  async listMethods(actor: AuthenticatedUser) {
    return this.prisma.paymentMethod.findMany({
      where: { userId: actor.id, deletedAt: null },
      select: {
        id: true,
        provider: true,
        brand: true,
        last4: true,
        isDefault: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async setDefaultMethod(actor: AuthenticatedUser, methodId: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, userId: actor.id, deletedAt: null },
    });
    if (!method) throw new NotFoundException("Payment method not found");
    await this.prisma.$transaction([
      this.prisma.paymentMethod.updateMany({
        where: { userId: actor.id },
        data: { isDefault: false },
      }),
      this.prisma.paymentMethod.update({
        where: { id: methodId },
        data: { isDefault: true },
      }),
    ]);
    return { id: methodId, isDefault: true };
  }

  async removeMethod(actor: AuthenticatedUser, methodId: string) {
    const method = await this.prisma.paymentMethod.findFirst({
      where: { id: methodId, userId: actor.id, deletedAt: null },
    });
    if (!method) throw new NotFoundException("Payment method not found");
    await this.prisma.paymentMethod.update({
      where: { id: methodId },
      data: { deletedAt: new Date(), isDefault: false },
    });
    return { id: methodId, deleted: true };
  }

  private async defaultMethod(userId: string) {
    return this.prisma.paymentMethod.findFirst({
      where: {
        userId,
        deletedAt: null,
        isDefault: true,
        provider: this.provider.name,
      },
    });
  }

  async requireDefaultMethod(userId: string) {
    const method = await this.defaultMethod(userId);
    if (!method) {
      throw new BadRequestException(
        "Add a payment method before requesting a ride",
      );
    }
    return method;
  }

  // ------------------------------------------------------------------
  // Ride payment lifecycle
  // ------------------------------------------------------------------

  /** Authorizes the estimated fare before matching starts. */
  async authorizeForRide(ride: Ride): Promise<Payment> {
    const method = await this.requireDefaultMethod(ride.passengerId);
    const payment = await this.prisma.payment.create({
      data: {
        rideId: ride.id,
        paymentMethodId: method.id,
        provider: this.provider.name,
        status: PaymentStatus.REQUIRES_AUTHORIZATION,
        currency: ride.currency,
        amountMinor: ride.estimatedFareMinor ?? 0,
      },
    });

    const result = await this.provider.authorize({
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      paymentMethodRef: method.providerRef,
      idempotencyKey: `payment:${payment.id}:auth`,
      metadata: { rideId: ride.id },
    });
    await this.prisma.paymentAttempt.create({
      data: {
        paymentId: payment.id,
        action: "AUTHORIZE",
        success: result.ok,
        errorCode: result.errorCode,
        rawRef: result.providerRef,
      },
    });

    if (!result.ok) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: result.errorCode,
          failureMessage: result.errorMessage,
        },
      });
      throw new BadRequestException(
        `Payment authorization failed: ${result.errorMessage ?? result.errorCode ?? "declined"}`,
      );
    }

    return this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: PaymentStatus.AUTHORIZED,
        providerRef: result.providerRef,
        authorizedAt: new Date(),
      },
    });
  }

  /**
   * Captures the final fare for a ride in PAYMENT_PENDING and books the
   * ledger. Idempotent: safe to call repeatedly and safe against concurrent
   * webhook processing (ledger keys are unique).
   */
  async settleRide(rideId: string): Promise<Ride> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      include: { pricingSnapshot: true },
    });
    if (!ride) throw new NotFoundException("Ride not found");
    if (ride.status === "COMPLETED") return ride;
    if (ride.status !== "PAYMENT_PENDING" && ride.status !== "PAYMENT_FAILED") {
      throw new ConflictException(`Ride is not awaiting payment (${ride.status})`);
    }

    let payment = await this.prisma.payment.findFirst({
      where: { rideId, status: { in: ["AUTHORIZED", "CAPTURED"] } },
      orderBy: { createdAt: "desc" },
    });

    // Retry path: the original authorization failed or was lost — authorize
    // again against the (possibly new) default method.
    if (!payment) {
      payment = await this.authorizeForRide(ride);
    }

    const finalFare = ride.finalFareMinor ?? ride.estimatedFareMinor ?? 0;
    // Cannot capture more than was authorized; any overage would need an
    // explicit incremental authorization (documented limitation).
    const captureAmount = Math.min(finalFare, payment.amountMinor);

    if (payment.status !== "CAPTURED") {
      const result = await this.provider.capture({
        providerRef: payment.providerRef!,
        amountMinor: captureAmount,
        idempotencyKey: `payment:${payment.id}:capture`,
      });
      await this.prisma.paymentAttempt.create({
        data: {
          paymentId: payment.id,
          action: "CAPTURE",
          success: result.ok,
          errorCode: result.errorCode,
        },
      });
      if (!result.ok) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: PaymentStatus.FAILED,
            failureCode: result.errorCode,
            failureMessage: result.errorMessage,
          },
        });
        if (ride.status !== "PAYMENT_FAILED") {
          return this.rides.transition(rideId, "PAYMENT_FAILED", {
            reason: result.errorCode ?? "capture_failed",
          });
        }
        return (await this.prisma.ride.findUnique({ where: { id: rideId } }))!;
      }
      payment = await this.markCaptured(payment.id, ride, captureAmount);
    } else {
      // Already captured (e.g. by a webhook) — make sure the ledger exists.
      await this.bookCaptureLedger(payment, ride, payment.capturedMinor ?? captureAmount);
    }

    if (ride.status === "PAYMENT_FAILED") {
      await this.rides.transition(rideId, "PAYMENT_PENDING", {
        reason: "payment_retried",
      });
    }
    return this.rides.transition(rideId, "COMPLETED", {
      reason: "payment_captured",
    });
  }

  private commissionFor(ride: Ride & { pricingSnapshot: { data: unknown } | null }): number {
    const data = ride.pricingSnapshot?.data as SnapshotFareData | undefined;
    return data?.commissionPercent ?? 0;
  }

  private async markCaptured(
    paymentId: string,
    ride: Ride & { pricingSnapshot: { data: unknown } | null },
    capturedMinor: number,
  ): Promise<Payment> {
    const commissionPercent = this.commissionFor(ride);
    const platformFeeMinor = Math.round(
      (capturedMinor * commissionPercent) / 100,
    );
    const driverNetMinor = capturedMinor - platformFeeMinor;
    const payment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.CAPTURED,
        capturedMinor,
        capturedAt: new Date(),
        platformFeeMinor,
        driverNetMinor,
      },
    });
    await this.bookCaptureLedger(payment, ride, capturedMinor);
    return payment;
  }

  private async bookCaptureLedger(
    payment: Payment,
    ride: Ride,
    capturedMinor: number,
  ): Promise<void> {
    const platformFeeMinor = payment.platformFeeMinor ?? 0;
    const driverNetMinor =
      payment.driverNetMinor ?? capturedMinor - platformFeeMinor;
    await this.ledger.book({
      type: "PASSENGER_CHARGE",
      debitAccount: Accounts.passenger(ride.passengerId),
      creditAccount: Accounts.platformCash,
      currency: payment.currency,
      amountMinor: capturedMinor,
      idempotencyKey: `ride:${ride.id}:charge`,
      rideId: ride.id,
      paymentId: payment.id,
      memo: "Ride fare captured",
    });
    if (platformFeeMinor > 0) {
      await this.ledger.book({
        type: "PLATFORM_FEE",
        debitAccount: Accounts.platformCash,
        creditAccount: Accounts.platformRevenue,
        currency: payment.currency,
        amountMinor: platformFeeMinor,
        idempotencyKey: `ride:${ride.id}:fee`,
        rideId: ride.id,
        paymentId: payment.id,
        memo: "Platform commission",
      });
    }
    if (ride.driverId && driverNetMinor > 0) {
      await this.ledger.book({
        type: "DRIVER_EARNING",
        debitAccount: Accounts.platformCash,
        creditAccount: Accounts.driver(ride.driverId),
        currency: payment.currency,
        amountMinor: driverNetMinor,
        idempotencyKey: `ride:${ride.id}:earning`,
        rideId: ride.id,
        paymentId: payment.id,
        memo: "Driver net earning",
      });
    }
  }

  // ------------------------------------------------------------------
  // Refunds
  // ------------------------------------------------------------------

  async refund(
    actor: AuthenticatedUser,
    paymentId: string,
    amountMinor: number,
    reason?: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { ride: true },
    });
    if (!payment) throw new NotFoundException("Payment not found");
    if (
      payment.status !== "CAPTURED" &&
      payment.status !== "PARTIALLY_REFUNDED"
    ) {
      throw new ConflictException("Only captured payments can be refunded");
    }
    const refundable = (payment.capturedMinor ?? 0) - payment.refundedMinor;
    if (amountMinor <= 0 || amountMinor > refundable) {
      throw new BadRequestException(
        `Refund amount must be between 1 and ${refundable}`,
      );
    }

    const refund = await this.prisma.refund.create({
      data: {
        paymentId,
        amountMinor,
        currency: payment.currency,
        reason,
        createdBy: actor.id,
      },
    });
    const result = await this.provider.refund({
      providerRef: payment.providerRef!,
      amountMinor,
      idempotencyKey: `refund:${refund.id}`,
      reason,
    });
    await this.prisma.paymentAttempt.create({
      data: {
        paymentId,
        action: "REFUND",
        success: result.ok,
        errorCode: result.errorCode,
        rawRef: result.providerRef,
      },
    });
    if (!result.ok) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: "FAILED" },
      });
      throw new BadRequestException(
        `Refund failed: ${result.errorMessage ?? "provider error"}`,
      );
    }

    const newRefunded = payment.refundedMinor + amountMinor;
    await this.prisma.$transaction([
      this.prisma.refund.update({
        where: { id: refund.id },
        data: { status: "SUCCEEDED", providerRef: result.providerRef },
      }),
      this.prisma.payment.update({
        where: { id: paymentId },
        data: {
          refundedMinor: newRefunded,
          status:
            newRefunded >= (payment.capturedMinor ?? 0)
              ? PaymentStatus.REFUNDED
              : PaymentStatus.PARTIALLY_REFUNDED,
        },
      }),
    ]);
    await this.ledger.book({
      type: "PASSENGER_REFUND",
      debitAccount: Accounts.platformCash,
      creditAccount: Accounts.passenger(payment.ride.passengerId),
      currency: payment.currency,
      amountMinor,
      idempotencyKey: `refund:${refund.id}:ledger`,
      rideId: payment.rideId,
      paymentId,
      refundId: refund.id,
      memo: reason ?? "Refund",
    });
    await this.audit.log({
      actorId: actor.id,
      action: "payment.refund",
      entity: "Payment",
      entityId: paymentId,
      metadata: { amountMinor, reason },
    });
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }

  // ------------------------------------------------------------------
  // Receipt
  // ------------------------------------------------------------------

  async receipt(actor: AuthenticatedUser, rideId: string) {
    const ride = await this.rides.getRideForParticipant(actor, rideId);
    const payment = await this.prisma.payment.findFirst({
      where: { rideId, status: { in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
      orderBy: { createdAt: "desc" },
      include: { refunds: true, paymentMethod: { select: { brand: true, last4: true } } },
    });
    if (!payment) throw new NotFoundException("No settled payment for this ride");
    const snapshot = ride.pricingSnapshotId
      ? await this.prisma.pricingSnapshot.findUnique({
          where: { id: ride.pricingSnapshotId },
        })
      : null;
    return {
      rideId,
      completedAt: ride.completedAt,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      distanceM: ride.actualDistanceM ?? ride.estimatedDistanceM,
      durationS: ride.actualDurationS ?? ride.estimatedDurationS,
      currency: payment.currency,
      totalMinor: payment.capturedMinor,
      refundedMinor: payment.refundedMinor,
      platformFeeMinor: payment.platformFeeMinor,
      paymentMethod: payment.paymentMethod,
      pricing: snapshot?.data ?? null,
      provider: payment.provider,
      providerRef: payment.providerRef,
      testMode: payment.provider === "sandbox",
    };
  }
}
