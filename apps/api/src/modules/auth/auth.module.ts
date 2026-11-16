import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuditService } from "../../common/audit.service";
import { PrismaService } from "../../common/prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";

@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, TokenService, PrismaService, AuditService],
  exports: [TokenService],
})
export class AuthModule {}
