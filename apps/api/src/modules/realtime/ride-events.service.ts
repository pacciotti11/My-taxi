import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import Redis from "ioredis";
import { loadEnv } from "../../config/env";

export type RideEvent =
  | {
      type: "status";
      rideId: string;
      status: string;
      at: string;
    }
  | {
      type: "location";
      rideId: string;
      driverProfileId: string;
      lat: number;
      lng: number;
      headingDeg?: number;
      recordedAt: string;
    }
  | {
      type: "offer";
      rideId: string;
      driverProfileId: string;
      expiresAt: string;
    };

const CHANNEL = "privateride:ride-events";

/**
 * Redis pub/sub bridge between domain services and the WebSocket gateway.
 * Keeps the two decoupled and works unchanged when the API scales to
 * multiple replicas (every replica receives every event and serves its own
 * connected sockets).
 */
@Injectable()
export class RideEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RideEventsService.name);
  private readonly pub: Redis;
  private readonly sub: Redis;
  private readonly handlers = new Set<(event: RideEvent) => void>();

  constructor() {
    const url = loadEnv().REDIS_URL;
    this.pub = new Redis(url, { maxRetriesPerRequest: 2 });
    this.sub = new Redis(url, { maxRetriesPerRequest: 2 });
  }

  async onModuleInit(): Promise<void> {
    await this.sub.subscribe(CHANNEL);
    this.sub.on("message", (_channel, message) => {
      try {
        const event = JSON.parse(message) as RideEvent;
        for (const handler of this.handlers) handler(event);
      } catch (e) {
        this.logger.warn(`Dropped malformed ride event: ${String(e)}`);
      }
    });
  }

  async publish(event: RideEvent): Promise<void> {
    await this.pub.publish(CHANNEL, JSON.stringify(event));
  }

  onEvent(handler: (event: RideEvent) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
  }
}
