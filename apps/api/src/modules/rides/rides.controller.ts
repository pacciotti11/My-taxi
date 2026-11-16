import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { Role } from "@privateride/shared";
import {
  CancelRideSchema,
  FareEstimateSchema,
  RequestRideSchema,
  type CancelRideInput,
  type FareEstimateInput,
  type RequestRideInput,
} from "@privateride/validation";
import {
  CurrentUser,
  RequireActiveMember,
  Roles,
} from "../../common/guards/decorators";
import type { AuthenticatedUser } from "../../common/types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PricingService } from "../pricing/pricing.service";
import { MatchingQueue } from "./matching.queue";
import { MatchingService } from "./matching.service";
import { RidesService } from "./rides.service";

@RequireActiveMember()
@Controller({ path: "rides", version: "1" })
export class RidesController {
  constructor(
    private readonly rides: RidesService,
    private readonly matching: MatchingService,
    private readonly queue: MatchingQueue,
    private readonly pricing: PricingService,
  ) {}

  // --- Passenger ---

  @Post("estimate")
  @HttpCode(200)
  estimate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(FareEstimateSchema)) body: FareEstimateInput,
  ) {
    return this.pricing.estimate(user.communityId!, body);
  }

  @Post()
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(RequestRideSchema)) body: RequestRideInput,
  ) {
    const ride = await this.rides.requestRide(user, body);
    await this.queue.startSearch(ride.id);
    return ride;
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.rides.listMyRides(user);
  }

  @Get("offers")
  @Roles(Role.DRIVER)
  offers(@CurrentUser() user: AuthenticatedUser) {
    return this.matching.myOffers(user);
  }

  @Get(":id")
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.rides.getRideForParticipant(user, id);
  }

  @Post(":id/cancel")
  @HttpCode(200)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(CancelRideSchema)) body: CancelRideInput,
  ) {
    return this.rides.cancelByPassenger(user, id, body);
  }

  // --- Driver ---

  @Post(":id/accept")
  @Roles(Role.DRIVER)
  @HttpCode(200)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.matching.acceptOffer(user, id);
  }

  @Post(":id/reject")
  @Roles(Role.DRIVER)
  @HttpCode(200)
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const next = await this.matching.rejectOffer(user, id);
    if (next) await this.queue.scheduleOfferTimeout(next.id);
    return { rejected: true };
  }

  @Post(":id/arrived")
  @Roles(Role.DRIVER)
  @HttpCode(200)
  arrived(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.rides.driverArrived(user, id);
  }

  @Post(":id/start")
  @Roles(Role.DRIVER)
  @HttpCode(200)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.rides.startRide(user, id);
  }

  @Post(":id/complete")
  @Roles(Role.DRIVER)
  @HttpCode(200)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.rides.completeRide(user, id);
  }
}
