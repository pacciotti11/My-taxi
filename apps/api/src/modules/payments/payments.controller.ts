import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { Role } from "@privateride/shared";
import { z } from "zod";
import {
  CurrentUser,
  RequireActiveMember,
  Roles,
} from "../../common/guards/decorators";
import type { AuthenticatedUser } from "../../common/types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { PaymentsService } from "./payments.service";
import { PayoutsService } from "./payouts.service";

const AddMethodSchema = z.object({
  token: z.string().min(3).max(200),
  brand: z.string().max(30).optional(),
  last4: z.string().regex(/^\d{4}$/).optional(),
});

const RefundSchema = z.object({
  amountMinor: z.number().int().positive(),
  reason: z.string().max(300).optional(),
});

@RequireActiveMember()
@Controller({ path: "payments", version: "1" })
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("methods")
  addMethod(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(AddMethodSchema))
    body: z.infer<typeof AddMethodSchema>,
  ) {
    return this.payments.addMethod(user, body);
  }

  @Get("methods")
  listMethods(@CurrentUser() user: AuthenticatedUser) {
    return this.payments.listMethods(user);
  }

  @Post("methods/:id/default")
  @HttpCode(200)
  setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.payments.setDefaultMethod(user, id);
  }

  @Delete("methods/:id")
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.payments.removeMethod(user, id);
  }
}

@Roles(Role.COMMUNITY_ADMIN, Role.SUPER_ADMIN)
@Controller({ path: "admin/payments", version: "1" })
export class AdminPaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
  ) {}

  @Post(":id/refund")
  @HttpCode(200)
  refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(RefundSchema))
    body: z.infer<typeof RefundSchema>,
  ) {
    return this.payments.refund(user, id, body.amountMinor, body.reason);
  }

  @Post("payouts/:driverProfileId")
  payout(
    @CurrentUser() user: AuthenticatedUser,
    @Param("driverProfileId", ParseUUIDPipe) driverProfileId: string,
  ) {
    return this.payouts.createPayout(user, driverProfileId);
  }
}
