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
import { LedgerService } from "./modules/payments/ledger.service";
import {
  AdminPaymentsController,
  PaymentsController,
} from "./modules/payments/payments.controller";
import { PaymentsService } from "./modules/payments/payments.service";
import { PayoutsService } from "./modules/payments/payouts.service";
import { PAYMENT_PROVIDER } from "./modules/payments/payment-provider.interface";
import { SandboxPaymentProvider } from "./modules/payments/sandbox.provider";
import { StripePaymentProvider } from "./modules/payments/stripe.provider";
import { WebhooksController } from "./modules/payments/webhooks.controller";
import { loadEnv } from "./config/env";
import { RealtimeGateway } from "./modules/realtime/realtime.gateway";
import { RideEventsService } from "./modules/realtime/ride-events.service";
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
    PaymentsController,
    AdminPaymentsController,
    WebhooksController,
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
    RideEventsService,
    RealtimeGateway,
    LedgerService,
    PaymentsService,
    PayoutsService,
    SandboxPaymentProvider,
    StripePaymentProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [SandboxPaymentProvider, StripePaymentProvider],
      useFactory: (
        sandbox: SandboxPaymentProvider,
        stripe: StripePaymentProvider,
      ) => (loadEnv().PAYMENT_PROVIDER === "stripe" ? stripe : sandbox),
    },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
