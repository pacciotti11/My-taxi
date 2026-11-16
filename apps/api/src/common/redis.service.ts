import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { loadEnv } from "../config/env";

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor() {
    this.client = new Redis(loadEnv().REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: false,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }
}
