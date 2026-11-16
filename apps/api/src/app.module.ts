import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditService } from "./common/audit.service";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PrismaService } from "./common/prisma.service";
import { RedisService } from "./common/redis.service";
import { AuthModule } from "./modules/auth/auth.module";
import {
  AdminDriversController,
  DriversController,
} from "./modules/drivers/drivers.controller";
import { DriversService } from "./modules/drivers/drivers.service";
import { HealthController } from "./modules/health/health.controller";
import { AdminMembershipController } from "./modules/invitations/invitations.controller";
import { InvitationsService } from "./modules/invitations/invitations.service";
import { MembersService } from "./modules/invitations/members.service";
import { MapsService } from "./modules/maps/maps.service";
import { PricingService } from "./modules/pricing/pricing.service";
import { MatchingQueue } from "./modules/rides/matching.queue";
import { MatchingService } from "./modules/rides/matching.service";
import { RidesController } from "./modules/rides/rides.controller";
import { RidesService } from "./modules/rides/rides.service";
import { UsersController } from "./modules/users/users.controller";

@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === "test",
    }),
  ],
  controllers: [
    HealthController,
    UsersController,
    AdminMembershipController,
    DriversController,
    AdminDriversController,
    RidesController,
  ],
  providers: [
    PrismaService,
    RedisService,
    AuditService,
    InvitationsService,
    MembersService,
    DriversService,
    MapsService,
    PricingService,
    RidesService,
    MatchingService,
    MatchingQueue,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
