import { createHmac } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MatchingService } from "../../src/modules/rides/matching.service";
import { SANDBOX_WEBHOOK_SECRET } from "../../src/modules/payments/sandbox.provider";
import {
  createApp,
  prisma,
  registerAndApprove,
  seedBase,
  truncateAll,
  TestWorld,
} from "./helpers";

const SOFIA = { lat: 42.6977, lng: 23.3219 };
const NDK = { lat: 42.6848, lng: 23.3188 };

describe("Payments, ledger & webhooks (e2e)", () => {
  let app: INestApplication;
  let world: TestWorld;
  let matching: MatchingService;

  beforeAll(async () => {
    await truncateAll();
    app = await createApp();
    world = await seedBase(app);
    matching = app.get(MatchingService);
    await prisma.pricingRule.create({
      data: {
        communityId: world.communityId,
        vehicleCategory: "STANDARD",
        currency: "BGN",
        version: 1,
        baseFareMinor: 200,
        perKmMinor: 120,
        perMinuteMinor: 20,
        minimumFareMinor: 500,
        commissionPercent: 10,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function makeDriver(email: string) {
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });
    const d = await registerAndApprove(app, world, email, "DRIVER");
    await request(app.getHttpServer())
      .post("/v1/drivers/profile")
      .set("authorization", `Bearer ${d.token}`)
      .send({ licenseNumber: "B9999999" })
      .expect(201);
    const vehicle = await request(app.getHttpServer())
      .post("/v1/drivers/vehicles")
      .set("authorization", `Bearer ${d.token}`)
      .send({
        make: "Toyota",
        model: "Corolla",
        color: "blue",
        registrationNumber: `PB${Math.floor(Math.random() * 9000) + 1000}KX`,
      })
      .expect(201);
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: d.userId },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${profile.id}/verification`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ status: "APPROVED" })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/admin/drivers/vehicles/${vehicle.body.id}/verification`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ status: "APPROVED", active: true })
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/drivers/availability")
      .set("authorization", `Bearer ${d.token}`)
      .send({ online: true })
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/drivers/location")
      .set("authorization", `Bearer ${d.token}`)
      .send({ ...SOFIA, accuracyM: 8, recordedAt: new Date().toISOString() })
      .expect(200);
    return { ...d, profileId: profile.id };
  }

  async function rideToCompletion(passengerToken: string, driverToken: string) {
    const est = await request(app.getHttpServer())
      .post("/v1/rides/estimate")
      .set("authorization", `Bearer ${passengerToken}`)
      .send({ pickup: SOFIA, dropoff: NDK })
      .expect(200);
    const ride = await request(app.getHttpServer())
      .post("/v1/rides")
      .set("authorization", `Bearer ${passengerToken}`)
      .send({
        pickup: SOFIA,
        pickupAddress: "Center",
        dropoff: NDK,
        dropoffAddress: "NDK",
        estimateId: est.body.estimateId,
      })
      .expect(201);
    const rideId = ride.body.id as string;
    await matching.offerToNextDriver(rideId);
    for (const step of ["accept", "arrived", "start", "complete"]) {
      await request(app.getHttpServer())
        .post(`/v1/rides/${rideId}/${step}`)
        .set("authorization", `Bearer ${driverToken}`)
        .expect(200);
    }
    return rideId;
  }

  it("authorizes, captures, books the ledger and issues a receipt end to end", async () => {
    const passenger = await registerAndApprove(app, world, "pay1@test.local");
    const driver = await makeDriver("payd1@test.local");

    const rideId = await rideToCompletion(passenger.token, driver.token);

    const ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.status).toBe("COMPLETED");

    const payment = await prisma.payment.findFirstOrThrow({
      where: { rideId },
    });
    expect(payment.status).toBe("CAPTURED");
    expect(payment.capturedMinor).toBeGreaterThan(0);
    expect(payment.platformFeeMinor).toBe(
      Math.round((payment.capturedMinor! * 10) / 100),
    );
    expect(payment.driverNetMinor).toBe(
      payment.capturedMinor! - payment.platformFeeMinor,
    );

    // Ledger: charge + fee + earning, amounts consistent.
    const entries = await prisma.financialLedgerEntry.findMany({
      where: { rideId },
    });
    expect(entries.map((e) => e.type).sort()).toEqual([
      "DRIVER_EARNING",
      "PASSENGER_CHARGE",
      "PLATFORM_FEE",
    ]);
    const charge = entries.find((e) => e.type === "PASSENGER_CHARGE")!;
    const fee = entries.find((e) => e.type === "PLATFORM_FEE")!;
    const earning = entries.find((e) => e.type === "DRIVER_EARNING")!;
    expect(charge.amountMinor).toBe(payment.capturedMinor);
    expect(fee.amountMinor + earning.amountMinor).toBe(charge.amountMinor);

    // Receipt visible to the passenger.
    const receipt = await request(app.getHttpServer())
      .get(`/v1/rides/${rideId}/receipt`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);
    expect(receipt.body.totalMinor).toBe(payment.capturedMinor);
    expect(receipt.body.testMode).toBe(true);

    // Driver sees earnings; admin pays out; balance returns to zero.
    const earnings = await request(app.getHttpServer())
      .get("/v1/drivers/earnings")
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(earnings.body.balanceMinor).toBe(earning.amountMinor);

    await request(app.getHttpServer())
      .post(`/v1/admin/payments/payouts/${driver.profileId}`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .expect(201);
    const after = await request(app.getHttpServer())
      .get("/v1/drivers/earnings")
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(after.body.balanceMinor).toBe(0);
    expect(after.body.payouts[0].status).toBe("PAID");
  });

  it("cannot finalize the same payment twice (idempotent settlement)", async () => {
    const passenger = await registerAndApprove(app, world, "pay2@test.local");
    const driver = await makeDriver("payd2@test.local");
    const rideId = await rideToCompletion(passenger.token, driver.token);

    // Settle again through the retry endpoint — must be a no-op.
    await request(app.getHttpServer())
      .post(`/v1/rides/${rideId}/retry-payment`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);

    const payments = await prisma.payment.findMany({ where: { rideId } });
    expect(payments).toHaveLength(1);
    const entries = await prisma.financialLedgerEntry.findMany({
      where: { rideId },
    });
    expect(entries).toHaveLength(3);
  });

  it("declines authorization and never leaves the ride searching", async () => {
    const passenger = await registerAndApprove(app, world, "pay3@test.local");
    await makeDriver("payd3@test.local");
    // Replace the default method with a declining card.
    const bad = await request(app.getHttpServer())
      .post("/v1/payments/methods")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({ token: "sandbox_pm_fail_auth", brand: "visa", last4: "0002" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/payments/methods/${bad.body.id}/default`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);

    const est = await request(app.getHttpServer())
      .post("/v1/rides/estimate")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({ pickup: SOFIA, dropoff: NDK })
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/rides")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: SOFIA,
        pickupAddress: "Center",
        dropoff: NDK,
        dropoffAddress: "NDK",
        estimateId: est.body.estimateId,
      })
      .expect(400);

    const rides = await prisma.ride.findMany({
      where: { passengerId: passenger.userId },
    });
    expect(rides).toHaveLength(1);
    expect(rides[0]!.status).toBe("CANCELLED");
    const payment = await prisma.payment.findFirstOrThrow({
      where: { rideId: rides[0]!.id },
    });
    expect(payment.status).toBe("FAILED");
  });

  it("marks the ride PAYMENT_FAILED on capture failure and recovers via retry", async () => {
    const passenger = await registerAndApprove(app, world, "pay4@test.local");
    const driver = await makeDriver("payd4@test.local");
    // Card that authorizes but fails at capture.
    const flaky = await request(app.getHttpServer())
      .post("/v1/payments/methods")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({ token: "sandbox_pm_capture-fail", brand: "mc", last4: "5100" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/v1/payments/methods/${flaky.body.id}/default`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);

    const rideId = await rideToCompletion(passenger.token, driver.token);
    let ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.status).toBe("PAYMENT_FAILED");

    // Passenger switches back to a good card and retries.
    const methods = await request(app.getHttpServer())
      .get("/v1/payments/methods")
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);
    const good = methods.body.find((m: { last4: string }) => m.last4 === "4242");
    await request(app.getHttpServer())
      .post(`/v1/payments/methods/${good.id}/default`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${rideId}/retry-payment`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);

    ride = await prisma.ride.findUniqueOrThrow({ where: { id: rideId } });
    expect(ride.status).toBe("COMPLETED");
    const entries = await prisma.financialLedgerEntry.findMany({
      where: { rideId },
    });
    expect(entries.filter((e) => e.type === "PASSENGER_CHARGE")).toHaveLength(1);
  });

  it("refunds partially and updates payment, ledger and passenger balance", async () => {
    const passenger = await registerAndApprove(app, world, "pay5@test.local");
    const driver = await makeDriver("payd5@test.local");
    const rideId = await rideToCompletion(passenger.token, driver.token);
    const payment = await prisma.payment.findFirstOrThrow({ where: { rideId } });

    // Refusals first: amount beyond refundable, non-admin caller.
    await request(app.getHttpServer())
      .post(`/v1/admin/payments/${payment.id}/refund`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ amountMinor: payment.capturedMinor! + 1 })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/v1/admin/payments/${payment.id}/refund`)
      .set("authorization", `Bearer ${passenger.token}`)
      .send({ amountMinor: 100 })
      .expect(403);

    const refundAmount = Math.floor(payment.capturedMinor! / 2);
    await request(app.getHttpServer())
      .post(`/v1/admin/payments/${payment.id}/refund`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ amountMinor: refundAmount, reason: "service issue" })
      .expect(200);

    const updated = await prisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(updated.status).toBe("PARTIALLY_REFUNDED");
    expect(updated.refundedMinor).toBe(refundAmount);
    const refundEntry = await prisma.financialLedgerEntry.findFirst({
      where: { rideId, type: "PASSENGER_REFUND" },
    });
    expect(refundEntry?.amountMinor).toBe(refundAmount);
  });

  it("verifies webhook signatures and ignores duplicate deliveries", async () => {
    const passenger = await registerAndApprove(app, world, "pay6@test.local");
    const driver = await makeDriver("payd6@test.local");
    const rideId = await rideToCompletion(passenger.token, driver.token);
    const payment = await prisma.payment.findFirstOrThrow({ where: { rideId } });

    const event = JSON.stringify({
      id: "evt_test_001",
      type: "payment.captured",
      providerRef: payment.providerRef,
    });
    const sig = createHmac("sha256", SANDBOX_WEBHOOK_SECRET)
      .update(event)
      .digest("hex");

    // Bad signature is rejected.
    await request(app.getHttpServer())
      .post("/v1/webhooks/payments")
      .set("content-type", "application/json")
      .set("x-webhook-signature", "deadbeef")
      .send(event)
      .expect(400);

    // First valid delivery processes, second is a duplicate no-op.
    const first = await request(app.getHttpServer())
      .post("/v1/webhooks/payments")
      .set("content-type", "application/json")
      .set("x-webhook-signature", sig)
      .send(event)
      .expect(200);
    expect(first.body.duplicate).toBeUndefined();
    const second = await request(app.getHttpServer())
      .post("/v1/webhooks/payments")
      .set("content-type", "application/json")
      .set("x-webhook-signature", sig)
      .send(event)
      .expect(200);
    expect(second.body.duplicate).toBe(true);

    // Ledger unchanged: still exactly one charge for the ride.
    const charges = await prisma.financialLedgerEntry.findMany({
      where: { rideId, type: "PASSENGER_CHARGE" },
    });
    expect(charges).toHaveLength(1);
    const events = await prisma.webhookEvent.findMany({
      where: { providerEventId: "evt_test_001" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.processedAt).not.toBeNull();
  });
});
