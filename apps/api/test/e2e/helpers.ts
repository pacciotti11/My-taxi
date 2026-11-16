import { INestApplication, VersioningType } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@privateride/database";
import * as argon2 from "argon2";
import request from "supertest";
import { AppModule } from "../../src/app.module";

export const prisma = new PrismaClient();

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  return app;
}

/** Order matters because of FK constraints; CASCADE keeps it simple. */
export async function truncateAll(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "RefreshToken", "Notification", "DeviceToken",
      "SupportTicket", "Rating", "FinancialLedgerEntry", "Refund",
      "PaymentAttempt", "Payment", "PaymentMethod", "Payout",
      "RideLocation", "RideAssignment", "RideStatusHistory", "Ride",
      "PricingSnapshot", "PricingRule", "DriverLocation", "DriverDocument",
      "Vehicle", "DriverProfile", "Invitation", "CommunityMembership",
      "UserRole", "User", "Community", "WebhookEvent", "IdempotencyKey"
    RESTART IDENTITY CASCADE
  `);
}

export interface TestWorld {
  communityId: string;
  adminToken: string;
  adminId: string;
}

export async function seedBase(app: INestApplication): Promise<TestWorld> {
  for (const name of [
    "PASSENGER",
    "DRIVER",
    "COMMUNITY_ADMIN",
    "SUPER_ADMIN",
  ] as const) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
  }
  const community = await prisma.community.create({
    data: { name: "Test Community", defaultCurrency: "BGN" },
  });
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: "SUPER_ADMIN" },
  });
  const admin = await prisma.user.create({
    data: {
      email: "admin@test.local",
      passwordHash: await argon2.hash("AdminPass123!", {
        type: argon2.argon2id,
      }),
      firstName: "Admin",
      lastName: "Test",
      roles: { create: { roleId: role.id } },
      memberships: {
        create: { communityId: community.id, status: "ACTIVE" },
      },
    },
  });
  const login = await request(app.getHttpServer())
    .post("/v1/auth/login")
    .send({ email: "admin@test.local", password: "AdminPass123!" })
    .expect(200);
  return {
    communityId: community.id,
    adminId: admin.id,
    adminToken: login.body.tokens.accessToken,
  };
}

export async function createInvitation(
  app: INestApplication,
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; code: string }> {
  const res = await request(app.getHttpServer())
    .post("/v1/admin/invitations")
    .set("authorization", `Bearer ${adminToken}`)
    .send({ role: "PASSENGER", ...overrides })
    .expect(201);
  return { id: res.body.id, code: res.body.code };
}

export function registerPayload(code: string, email: string) {
  return {
    invitationCode: code,
    email,
    password: "Parola1234X",
    firstName: "Test",
    lastName: "User",
    acceptTerms: true,
  };
}

export async function registerAndApprove(
  app: INestApplication,
  world: TestWorld,
  email: string,
  role: "PASSENGER" | "DRIVER" | "COMMUNITY_ADMIN" = "PASSENGER",
): Promise<{ userId: string; token: string }> {
  const { code } = await createInvitation(app, world.adminToken, { role });
  const reg = await request(app.getHttpServer())
    .post("/v1/auth/register")
    .send(registerPayload(code, email))
    .expect(201);
  const membership = await prisma.communityMembership.findFirstOrThrow({
    where: { userId: reg.body.user.id },
  });
  await request(app.getHttpServer())
    .post(`/v1/admin/members/${membership.id}/approve`)
    .set("authorization", `Bearer ${world.adminToken}`)
    .send({})
    .expect(201);
  const login = await request(app.getHttpServer())
    .post("/v1/auth/login")
    .send({ email, password: "Parola1234X" })
    .expect(200);
  return { userId: reg.body.user.id, token: login.body.tokens.accessToken };
}
