import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MatchingService } from "../../src/modules/rides/matching.service";
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
const DRIVER_NEARBY = { lat: 42.7, lng: 23.32 }; // ~0.3 km from center
const DRIVER_FAR = { lat: 42.9, lng: 23.9 }; // ~50 km away

async function makeEstimate(
  app: INestApplication,
  token: string,
  pickup = SOFIA,
  dropoff = NDK,
) {
  const res = await request(app.getHttpServer())
    .post("/v1/rides/estimate")
    .set("authorization", `Bearer ${token}`)
    .send({ pickup, dropoff })
    .expect(200);
  return res.body as { estimateId: string; totalMinor: number; currency: string };
}

async function requestRide(
  app: INestApplication,
  token: string,
  pickup = SOFIA,
  dropoff = NDK,
) {
  const est = await makeEstimate(app, token, pickup, dropoff);
  const res = await request(app.getHttpServer())
    .post("/v1/rides")
    .set("authorization", `Bearer ${token}`)
    .send({
      pickup,
      pickupAddress: "pl. Nezavisimost 1",
      dropoff,
      dropoffAddress: "NDK",
      estimateId: est.estimateId,
    })
    .expect(201);
  return res.body as { id: string; status: string; estimatedFareMinor: number };
}

interface DriverCtx {
  userId: string;
  token: string;
  profileId: string;
}

async function makeDriver(
  app: INestApplication,
  world: TestWorld,
  email: string,
  location = DRIVER_NEARBY,
): Promise<DriverCtx> {
  const d = await registerAndApprove(app, world, email, "DRIVER");
  await request(app.getHttpServer())
    .post("/v1/drivers/profile")
    .set("authorization", `Bearer ${d.token}`)
    .send({ licenseNumber: "B1234567" })
    .expect(201);
  const vehicle = await request(app.getHttpServer())
    .post("/v1/drivers/vehicles")
    .set("authorization", `Bearer ${d.token}`)
    .send({
      make: "Skoda",
      model: "Octavia",
      color: "grey",
      registrationNumber: `CB${Math.floor(Math.random() * 9000) + 1000}AB`,
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
    .send({ ...location, accuracyM: 10, recordedAt: new Date().toISOString() })
    .expect(200);
  return { ...d, profileId: profile.id };
}

describe("Ride lifecycle & matching (e2e)", () => {
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
        cancellationFeeMinor: 300,
        commissionPercent: 10,
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("runs the full happy path: request → match → accept → arrive → start → complete", async () => {
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });
    const passenger = await registerAndApprove(app, world, "p1@test.local");
    const driver = await makeDriver(app, world, "d1@test.local");

    const ride = await requestRide(app, passenger.token);
    expect(ride.status).toBe("SEARCHING");
    expect(ride.estimatedFareMinor).toBeGreaterThanOrEqual(500);

    const assignment = await matching.offerToNextDriver(ride.id);
    expect(assignment?.driverProfileId).toBe(driver.profileId);

    const offers = await request(app.getHttpServer())
      .get("/v1/rides/offers")
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(offers.body).toHaveLength(1);

    const accepted = await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/accept`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(accepted.body.status).toBe("DRIVER_ARRIVING");

    // Passenger sees the assigned driver and vehicle.
    const seen = await request(app.getHttpServer())
      .get(`/v1/rides/${ride.id}`)
      .set("authorization", `Bearer ${passenger.token}`)
      .expect(200);
    expect(seen.body.driver.user.firstName).toBeTruthy();
    expect(seen.body.vehicle.registrationNumber).toMatch(/^CB/);

    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/arrived`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/start`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    const done = await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/complete`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    expect(done.body.status).toBe("COMPLETED");
    expect(done.body.finalFareMinor).toBeGreaterThanOrEqual(500);

    const history = await prisma.rideStatusHistory.findMany({
      where: { rideId: ride.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history.map((h) => h.toStatus)).toEqual([
      "REQUESTED",
      "SEARCHING",
      "OFFERED",
      "ACCEPTED",
      "DRIVER_ARRIVING",
      "DRIVER_ARRIVED",
      "IN_PROGRESS",
      "PAYMENT_PENDING",
      "COMPLETED",
    ]);
  });

  it("prevents a driver from completing a ride that has not started", async () => {
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });
    const passenger = await registerAndApprove(app, world, "p2@test.local");
    const driver = await makeDriver(app, world, "d2@test.local");
    const ride = await requestRide(app, passenger.token);
    await matching.offerToNextDriver(ride.id);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/accept`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/arrived`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    // DRIVER_ARRIVED -> PAYMENT_PENDING is not a legal transition.
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/complete`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(409);
    // Clean up: finish the ride properly so the driver is free again.
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/start`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/complete`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
  });

  it("enforces one active ride per driver at the database level", async () => {
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });
    const p3 = await registerAndApprove(app, world, "p3@test.local");
    const p4 = await registerAndApprove(app, world, "p4@test.local");
    const driver = await makeDriver(app, world, "d3@test.local");

    const ride1 = await requestRide(app, p3.token);
    await matching.offerToNextDriver(ride1.id);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride1.id}/accept`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);

    // Busy drivers are not even candidates...
    const ride2 = await requestRide(app, p4.token);
    const none = await matching.offerToNextDriver(ride2.id);
    expect(none).toBeNull();

    // ...and even a forced offer (simulated race) cannot be accepted.
    await prisma.rideAssignment.create({
      data: {
        rideId: ride2.id,
        driverProfileId: driver.profileId,
        status: "OFFERED",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.ride.update({
      where: { id: ride2.id },
      data: { status: "OFFERED" },
    });
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride2.id}/accept`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(409);

    // Cleanup for later tests.
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride2.id}/cancel`)
      .set("authorization", `Bearer ${p4.token}`)
      .send({})
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride1.id}/arrived`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride1.id}/start`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride1.id}/complete`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);
  });

  it("keeps a second driver from taking a ride offered to another driver", async () => {
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });
    const passenger = await registerAndApprove(app, world, "p5@test.local");
    const driverA = await makeDriver(app, world, "d4@test.local");
    const driverB = await makeDriver(app, world, "d5@test.local", {
      lat: 42.71,
      lng: 23.33,
    });

    const ride = await requestRide(app, passenger.token);
    const assignment = await matching.offerToNextDriver(ride.id);
    expect(assignment?.driverProfileId).toBe(driverA.profileId);

    // Driver B has no offer for this ride.
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/accept`)
      .set("authorization", `Bearer ${driverB.token}`)
      .expect(409);

    // A rejects; the offer moves on to B.
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/reject`)
      .set("authorization", `Bearer ${driverA.token}`)
      .expect(200);
    const next = await prisma.rideAssignment.findUnique({
      where: {
        rideId_driverProfileId: {
          rideId: ride.id,
          driverProfileId: driverB.profileId,
        },
      },
    });
    expect(next?.status).toBe("OFFERED");

    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/accept`)
      .set("authorization", `Bearer ${driverB.token}`)
      .expect(200);

    // Cleanup.
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/start`)
      .set("authorization", `Bearer ${driverB.token}`)
      .expect(409); // must arrive first
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/arrived`)
      .set("authorization", `Bearer ${driverB.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/start`)
      .set("authorization", `Bearer ${driverB.token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/complete`)
      .set("authorization", `Bearer ${driverB.token}`)
      .expect(200);
  });

  it("hides rides from non-participants", async () => {
    const p6 = await registerAndApprove(app, world, "p6@test.local");
    const stranger = await registerAndApprove(app, world, "p7@test.local");
    const ride = await requestRide(app, p6.token);
    await request(app.getHttpServer())
      .get(`/v1/rides/${ride.id}`)
      .set("authorization", `Bearer ${stranger.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/cancel`)
      .set("authorization", `Bearer ${stranger.token}`)
      .send({})
      .expect(404);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/cancel`)
      .set("authorization", `Bearer ${p6.token}`)
      .send({})
      .expect(200);
  });

  it("blocks suspended members from requesting rides", async () => {
    const member = await registerAndApprove(app, world, "p8@test.local");
    const membership = await prisma.communityMembership.findFirstOrThrow({
      where: { userId: member.userId },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/members/${membership.id}/suspend`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ reason: "test" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/v1/rides/estimate")
      .set("authorization", `Bearer ${member.token}`)
      .send({ pickup: SOFIA, dropoff: NDK })
      .expect(403);
  });

  it("never matches unverified or far-away drivers", async () => {
    const passenger = await registerAndApprove(app, world, "p9@test.local");
    // Isolation: take all drivers from earlier tests offline.
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });

    // Fresh driver whose verification is withdrawn after setup.
    const driver = await makeDriver(app, world, "d6@test.local", DRIVER_NEARBY);
    await request(app.getHttpServer())
      .post(`/v1/admin/drivers/${driver.profileId}/verification`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ status: "SUSPENDED" })
      .expect(200);

    // Far-away driver, approved and online but ~50 km out.
    await makeDriver(app, world, "d7@test.local", DRIVER_FAR);

    const ride = await requestRide(app, passenger.token);
    const none = await matching.offerToNextDriver(ride.id);
    expect(none).toBeNull();
    const rideRow = await prisma.ride.findUniqueOrThrow({
      where: { id: ride.id },
    });
    expect(rideRow.status).toBe("SEARCHING");

    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/cancel`)
      .set("authorization", `Bearer ${passenger.token}`)
      .send({})
      .expect(200);
  });

  it("rejects stale fare estimates and mismatched points", async () => {
    const passenger = await registerAndApprove(app, world, "p10@test.local");
    const est = await makeEstimate(app, passenger.token);

    // Mismatched pickup (moved ~2 km).
    await request(app.getHttpServer())
      .post("/v1/rides")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: { lat: 42.72, lng: 23.34 },
        pickupAddress: "elsewhere",
        dropoff: NDK,
        dropoffAddress: "NDK",
        estimateId: est.estimateId,
      })
      .expect(400);

    // Expired estimate.
    await prisma.$executeRawUnsafe(
      `UPDATE "PricingSnapshot" SET data = jsonb_set(data, '{expiresAt}', to_jsonb(to_char(NOW() - interval '1 minute', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) WHERE id = '${est.estimateId}'`,
    );
    await request(app.getHttpServer())
      .post("/v1/rides")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: SOFIA,
        pickupAddress: "pl. Nezavisimost 1",
        dropoff: NDK,
        dropoffAddress: "NDK",
        estimateId: est.estimateId,
      })
      .expect(400);
  });

  it("prevents a passenger from holding two active rides", async () => {
    const passenger = await registerAndApprove(app, world, "p11@test.local");
    const ride = await requestRide(app, passenger.token);
    const est = await makeEstimate(app, passenger.token);
    await request(app.getHttpServer())
      .post("/v1/rides")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: SOFIA,
        pickupAddress: "pl. Nezavisimost 1",
        dropoff: NDK,
        dropoffAddress: "NDK",
        estimateId: est.estimateId,
      })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/v1/rides/${ride.id}/cancel`)
      .set("authorization", `Bearer ${passenger.token}`)
      .send({})
      .expect(200);
  });
});
