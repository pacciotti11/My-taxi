import {
  Body,
  Controller,
  HttpCode,
  Ip,
  Post,
  Headers,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
  VerifyEmailSchema,
  type LoginInput,
  type RefreshInput,
  type RegisterInput,
  type VerifyEmailInput,
} from "@privateride/validation";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { CurrentUser, Public } from "../../common/guards/decorators";
import type { AuthenticatedUser } from "../../common/types";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";

@Controller({ path: "auth", version: "1" })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("register")
  register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Ip() ip: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.auth.register(body, { ip, userAgent });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post("login")
  login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Ip() ip: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    return this.auth.login(body, { ip, userAgent });
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post("refresh")
  async refresh(
    @Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput,
    @Ip() ip: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    const { pair } = await this.tokens.rotate(body.refreshToken, {
      ip,
      userAgent,
    });
    return pair;
  }

  @Public()
  @HttpCode(204)
  @Post("logout")
  async logout(@Body(new ZodValidationPipe(RefreshSchema)) body: RefreshInput) {
    await this.tokens.revokeFamilyByToken(body.refreshToken);
  }

  @Public()
  @HttpCode(200)
  @Post("verify-email")
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: VerifyEmailInput,
  ) {
    await this.auth.verifyEmail(body.token);
    return { verified: true };
  }

  @HttpCode(202)
  @Post("request-deletion")
  async requestDeletion(@CurrentUser() user: AuthenticatedUser) {
    await this.auth.requestAccountDeletion(user.id);
    return { status: "deletion_requested" };
  }
}
