import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../../common/guards/decorators";
import { PrismaService } from "../../common/prisma.service";
import { RedisService } from "../../common/redis.service";

@Controller({ path: "health", version: "1" })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get()
  async health() {
    const checks: Record<string, "ok" | "down"> = { db: "down", redis: "down" };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = "ok";
    } catch {
      /* reported below */
    }
    try {
      if ((await this.redis.client.ping()) === "PONG") checks.redis = "ok";
    } catch {
      /* reported below */
    }
    const healthy = Object.values(checks).every((v) => v === "ok");
    if (!healthy) throw new ServiceUnavailableException({ checks });
    return { status: "ok", checks };
  }
}
