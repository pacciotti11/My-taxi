import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { MembershipStatus as DbMembershipStatus } from "@privateride/database";
import { Role } from "@privateride/shared";
import {
  CreateInvitationSchema,
  MembershipDecisionSchema,
  type CreateInvitationInput,
  type MembershipDecisionInput,
} from "@privateride/validation";
import { CurrentUser, Roles } from "../../common/guards/decorators";
import type { AuthenticatedUser } from "../../common/types";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { InvitationsService } from "./invitations.service";
import { MembersService } from "./members.service";

@Roles(Role.COMMUNITY_ADMIN, Role.SUPER_ADMIN)
@Controller({ path: "admin", version: "1" })
export class AdminMembershipController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly members: MembersService,
  ) {}

  // --- Invitations ---

  @Post("invitations")
  createInvitation(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateInvitationSchema))
    body: CreateInvitationInput,
    @Query("communityId") communityId?: string,
  ) {
    return this.invitations.create(actor, body, communityId);
  }

  @Get("invitations")
  listInvitations(
    @CurrentUser() actor: AuthenticatedUser,
    @Query("communityId") communityId?: string,
  ) {
    return this.invitations.list(actor, communityId);
  }

  @Delete("invitations/:id")
  revokeInvitation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.invitations.revoke(actor, id);
  }

  // --- Membership management ---

  @Get("members")
  listMembers(
    @CurrentUser() actor: AuthenticatedUser,
    @Query("status") status?: string,
  ) {
    const parsed =
      status && status in DbMembershipStatus
        ? (status as DbMembershipStatus)
        : undefined;
    return this.members.list(actor, { status: parsed });
  }

  @Post("members/:id/approve")
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.members.approve(actor, id);
  }

  @Post("members/:id/reject")
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MembershipDecisionSchema))
    body: MembershipDecisionInput,
  ) {
    return this.members.reject(actor, id, body.reason);
  }

  @Post("members/:id/suspend")
  suspend(
    @CurrentUser() actor: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(MembershipDecisionSchema))
    body: MembershipDecisionInput,
  ) {
    return this.members.suspend(actor, id, body.reason);
  }
}
