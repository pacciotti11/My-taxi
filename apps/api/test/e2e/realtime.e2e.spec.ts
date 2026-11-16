import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { io, Socket } from "socket.io-client";
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

function connect(baseUrl: string, token?: string): Socket {
  return io(`${baseUrl}/realtime`, {
    transports: ["websocket"],
    auth: token ? { token } : {},
    reconnection: false,
  });
}

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout waiting for ${event}`)),
      timeoutMs,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`no ack for ${event}`)),
      5000,
    );
    socket.once("exception", (err: unknown) => {
      clearTimeout(timer);
      reject(new Error(`server exception on ${event}: ${JSON.stringify(err)}`));
    });
    socket.emit(event, payload, (res: T) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

describe("Realtime gateway (e2e)", () => {
  let app: INestApplication;
  let world: TestWorld;
  let baseUrl: string;
  let matching: MatchingService;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await truncateAll();
    app = await createApp();
    await app.listen(0);
    const url = await app.getUrl();
    baseUrl = url.replace("[::1]", "127.0.0.1").replace(/\/$/, "");
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
      },
    });
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  async function setupRideWithDriver() {
    // Isolation: only this test's driver may be matchable.
    await prisma.driverProfile.updateMany({ data: { isOnline: false } });
    const passenger = await registerAndApprove(app, world, `rt-p${Date.now()}@test.local`);
    const driver = await registerAndApprove(app, world, `rt-d${Date.now()}@test.local`, "DRIVER");

    await request(app.getHttpServer())
      .post("/v1/drivers/profile")
      .set("authorization", `Bearer ${driver.token}`)
      .send({ licenseNumber: "B7654321" })
      .expect(201);
    const vehicle = await request(app.getHttpServer())
      .post("/v1/drivers/vehicles")
      .set("authorization", `Bearer ${driver.token}`)
      .send({
        make: "Dacia",
        model: "Logan",
        color: "white",
        registrationNumber: `CA${Math.floor(Math.random() * 9000) + 1000}XX`,
      })
      .expect(201);
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { userId: driver.userId },
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
      .set("authorization", `Bearer ${driver.token}`)
      .send({ online: true })
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/drivers/location")
      .set("authorization", `Bearer ${driver.token}`)
      .send({ ...SOFIA, accuracyM: 8, recordedAt: new Date().toISOString() })
      .expect(200);

    const est = await request(app.getHttpServer())
      .post("/v1/rides/estimate")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({ pickup: SOFIA, dropoff: NDK })
      .expect(200);
    const ride = await request(app.getHttpServer())
      .post("/v1/rides")
      .set("authorization", `Bearer ${passenger.token}`)
      .send({
        pickup: SOFIA,
        pickupAddress: "Center",
        dropoff: NDK,
        dropoffAddress: "NDK",
        estimateId: est.body.estimateId,
      })
      .expect(201);
    return { passenger, driver, rideId: ride.body.id as string, profileId: profile.id };
  }

  it("rejects unauthenticated socket connections", async () => {
    const socket = connect(baseUrl);
    sockets.push(socket);
    await waitFor(socket, "error");
  });

  it("delivers an offer event to the driver's personal room", async () => {
    const { driver, rideId, profileId } = await setupRideWithDriver();
    const socket = connect(baseUrl, driver.token);
    sockets.push(socket);
    await waitFor(socket, "connect");
    // Give the join a beat before publishing.
    await new Promise((r) => setTimeout(r, 150));

    const [offer] = await Promise.all([
      waitFor<{ rideId: string; driverProfileId: string }>(socket, "ride:offer"),
      matching.offerToNextDriver(rideId),
    ]);
    expect(offer.rideId).toBe(rideId);
    expect(offer.driverProfileId).toBe(profileId);
  });

  it("streams driver locations and status changes to authorized ride subscribers only", async () => {
    const { passenger, driver, rideId } = await setupRideWithDriver();
    await matching.offerToNextDriver(rideId);
    await request(app.getHttpServer())
      .post(`/v1/rides/${rideId}/accept`)
      .set("authorization", `Bearer ${driver.token}`)
      .expect(200);

    const passengerSocket = connect(baseUrl, passenger.token);
    const driverSocket = connect(baseUrl, driver.token);
    sockets.push(passengerSocket, driverSocket);
    await waitFor(passengerSocket, "connect");
    await waitFor(driverSocket, "connect");

    const sub = await emitAck<{ ok: boolean }>(passengerSocket, "ride:subscribe", {
      rideId,
    });
    expect(sub.ok).toBe(true);

    // A stranger (another approved member) cannot subscribe.
    const stranger = await registerAndApprove(
      app,
      world,
      `rt-s${Date.now()}@test.local`,
    );
    const strangerSocket = connect(baseUrl, stranger.token);
    sockets.push(strangerSocket);
    await waitFor(strangerSocket, "connect");
    const denied = await emitAck<{ ok: boolean }>(
      strangerSocket,
      "ride:subscribe",
      { rideId },
    );
    expect(denied.ok).toBe(false);

    // Driver streams a location through the socket; passenger receives it.
    const [loc, ack] = await Promise.all([
      waitFor<{ lat: number; lng: number }>(passengerSocket, "driver:location"),
      emitAck<{ ok: boolean }>(driverSocket, "location:update", {
        lat: 42.699,
        lng: 23.323,
        accuracyM: 9,
        recordedAt: new Date().toISOString(),
      }),
    ]);
    expect(ack.ok).toBe(true);
    expect(loc.lat).toBeCloseTo(42.699, 3);

    // The trace point was persisted.
    const traceCount = await prisma.rideLocation.count({ where: { rideId } });
    expect(traceCount).toBe(1);

    // REST-driven transition reaches the subscriber as a status event.
    const [status] = await Promise.all([
      waitFor<{ status: string }>(passengerSocket, "ride:status"),
      request(app.getHttpServer())
        .post(`/v1/rides/${rideId}/arrived`)
        .set("authorization", `Bearer ${driver.token}`)
        .expect(200),
    ]);
    expect(status.status).toBe("DRIVER_ARRIVED");
  });
});
