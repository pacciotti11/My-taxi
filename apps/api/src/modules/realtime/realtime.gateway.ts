import { Logger, OnModuleInit } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Role } from "@privateride/shared";
import { LocationUpdateSchema } from "@privateride/validation";
import type { Server, Socket } from "socket.io";
import { PrismaService } from "../../common/prisma.service";
import type { AccessTokenPayload, AuthenticatedUser } from "../../common/types";
import { loadEnv } from "../../config/env";
import { DriversService } from "../drivers/drivers.service";
import { RideEventsService } from "./ride-events.service";

interface SocketData {
  user?: AuthenticatedUser;
  driverProfileId?: string;
  /** Resolves when connection-time authentication has finished. */
  authReady?: Promise<void>;
}

const rideRoom = (rideId: string) => `ride:${rideId}`;
const driverRoom = (driverProfileId: string) => `driver:${driverProfileId}`;

@WebSocketGateway({ namespace: "/realtime", cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly events: RideEventsService,
    private readonly drivers: DriversService,
  ) {}

  onModuleInit(): void {
    // Fan events out to the rooms this replica serves.
    this.events.onEvent((event) => {
      if (event.type === "status") {
        this.server.to(rideRoom(event.rideId)).emit("ride:status", event);
      } else if (event.type === "location") {
        this.server.to(rideRoom(event.rideId)).emit("driver:location", {
          rideId: event.rideId,
          lat: event.lat,
          lng: event.lng,
          headingDeg: event.headingDeg,
          recordedAt: event.recordedAt,
        });
      } else if (event.type === "offer") {
        this.server
          .to(driverRoom(event.driverProfileId))
          .emit("ride:offer", event);
      }
    });
  }

  /**
   * Authentication happens at connection time; failures disconnect.
   * Clients may emit messages before this async work finishes, so the
   * promise is stored synchronously and every handler awaits it.
   */
  handleConnection(socket: Socket): void {
    const ready = this.authenticate(socket);
    (socket.data as SocketData).authReady = ready.catch(() => undefined);
  }

  private async authenticate(socket: Socket): Promise<void> {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.headers.authorization === "string"
          ? socket.handshake.headers.authorization.replace(/^Bearer /, "")
          : undefined);
      if (!token) throw new Error("missing token");
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: loadEnv().JWT_ACCESS_SECRET,
      });
      if (payload.type !== "access") throw new Error("wrong token type");

      const user = await this.prisma.user.findFirst({
        where: { id: payload.sub, deletedAt: null },
        select: {
          id: true,
          roles: { select: { role: { select: { name: true } } } },
          memberships: { select: { communityId: true, status: true }, take: 1 },
          driverProfile: { select: { id: true } },
        },
      });
      if (!user) throw new Error("unknown user");
      const membership = user.memberships[0] ?? null;
      if (membership?.status !== "ACTIVE") throw new Error("not active member");

      const data = socket.data as SocketData;
      data.user = {
        id: user.id,
        roles: user.roles.map((r) => r.role.name as Role),
        membershipStatus: membership.status,
        communityId: membership.communityId,
      };
      data.driverProfileId = user.driverProfile?.id;
      if (user.driverProfile) {
        await socket.join(driverRoom(user.driverProfile.id));
      }
    } catch (e) {
      this.logger.debug(`Socket rejected: ${String(e)}`);
      socket.emit("error", { message: "Unauthorized" });
      socket.disconnect(true);
      throw e;
    }
  }

  private async resolveUser(socket: Socket): Promise<SocketData | null> {
    const data = socket.data as SocketData;
    await data.authReady;
    return data.user ? data : null;
  }

  @SubscribeMessage("ride:subscribe")
  async subscribeRide(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { rideId?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const data = await this.resolveUser(socket);
    if (!data?.user) return { ok: false, error: "unauthenticated" };
    const rideId = body?.rideId;
    if (!rideId || typeof rideId !== "string") {
      return { ok: false, error: "rideId required" };
    }
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        passengerId: true,
        communityId: true,
        driver: { select: { userId: true } },
      },
    });
    if (!ride) return { ok: false, error: "not found" };
    const u = data.user!;
    const allowed =
      ride.passengerId === u.id ||
      ride.driver?.userId === u.id ||
      u.roles.includes(Role.SUPER_ADMIN) ||
      (u.roles.includes(Role.COMMUNITY_ADMIN) &&
        u.communityId === ride.communityId);
    if (!allowed) return { ok: false, error: "not found" };
    await socket.join(rideRoom(rideId));
    return { ok: true };
  }

  @SubscribeMessage("ride:unsubscribe")
  async unsubscribeRide(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { rideId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.rideId) await socket.leave(rideRoom(body.rideId));
    return { ok: true };
  }

  /** Drivers stream GPS through the socket; same validation as the REST path. */
  @SubscribeMessage("location:update")
  async locationUpdate(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    const data = await this.resolveUser(socket);
    if (!data?.user) return { ok: false, error: "unauthenticated" };
    if (!data.driverProfileId || !data.user.roles.includes(Role.DRIVER)) {
      return { ok: false, error: "drivers only" };
    }
    const parsed = LocationUpdateSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: "invalid payload" };
    try {
      const result = await this.drivers.ingestLocation(data.user, parsed.data);
      return { ok: result.accepted !== false };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
