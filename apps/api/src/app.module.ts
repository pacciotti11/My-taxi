import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AuditService } from "./common/audit.service";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PrismaService } from "./common/prisma.service";
import { RedisService } from "./common/redis.service";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthController } from "./modules/health/health.controller";
import { AdminMembershipController } from "./modules/invitations/invitations.controller";
import { InvitationsService } from "./modules/invitations/invitations.service";
import { MembersService } from "./modules/invitations/members.service";
import { UsersController } from "./modules/users/users.controller";

@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === "test",
    }),
  ],
  controllers: [HealthController, UsersController, AdminMembershipController],
  providers: [
    PrismaService,
    RedisService,
    AuditService,
    InvitationsService,
    MembersService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
