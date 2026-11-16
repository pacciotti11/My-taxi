import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  DocumentStatus,
  DriverVerificationStatus,
} from "@privateride/database";
import { Role } from "@privateride/shared";
import {
  AvailabilitySchema,
  CreateDriverProfileSchema,
  CreateVehicleSchema,
  LocationUpdateSchema,
  type AvailabilityInput,
  type CreateDriverProfileInput,
  type CreateVehicleInput,
  type LocationUpdateInput,
} from "@privateride/validation";
import { z } from "zod";
import {
  CurrentUser,
  RequireActiveMember,
  Roles,
} from "../../common/guards/decorators";
import type { AuthenticatedUser } from "../../common/types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { DriversService } from "./drivers.service";

@RequireActiveMember()
@Roles(Role.DRIVER)
@Controller({ path: "drivers", version: "1" })
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.drivers.getOwnProfile(user.id);
  }

  @Post("profile")
  createProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateDriverProfileSchema))
    body: CreateDriverProfileInput,
  ) {
    return this.drivers.createProfile(user, body);
  }

  @Post("vehicles")
  addVehicle(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateVehicleSchema)) body: CreateVehicleInput,
  ) {
    return this.drivers.addVehicle(user, body);
  }

  @Post("availability")
  @HttpCode(200)
  setAvailability(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(AvailabilitySchema)) body: AvailabilityInput,
  ) {
    return this.drivers.setAvailability(user, body.online);
  }

  @Post("location")
  @HttpCode(200)
  ingestLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(LocationUpdateSchema))
    body: LocationUpdateInput,
  ) {
    return this.drivers.ingestLocation(user, body);
  }
}

const DriverVerificationDecisionSchema = z.object({
  status: z.nativeEnum(DriverVerificationStatus),
  note: z.string().max(500).optional(),
});
const VehicleVerificationDecisionSchema = z.object({
  status: z.nativeEnum(DocumentStatus),
  active: z.boolean().optional(),
});

@Roles(Role.COMMUNITY_ADMIN, Role.SUPER_ADMIN)
@Controller({ path: "admin/drivers", version: "1" })
export class AdminDriversController {
  constructor(private readonly drivers: DriversService) {}

  @Post(":id/verification")
  @HttpCode(200)
  setDriverVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DriverVerificationDecisionSchema))
    body: { status: DriverVerificationStatus; note?: string },
  ) {
    return this.drivers.adminSetDriverVerification(
      user,
      id,
      body.status,
      body.note,
    );
  }

  @Post("vehicles/:id/verification")
  @HttpCode(200)
  setVehicleVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(VehicleVerificationDecisionSchema))
    body: { status: DocumentStatus; active?: boolean },
  ) {
    return this.drivers.adminSetVehicleVerification(
      user,
      id,
      body.status,
      body.active,
    );
  }
}
