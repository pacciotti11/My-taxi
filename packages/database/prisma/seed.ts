import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  // Roles
  for (const name of [
    "PASSENGER",
    "DRIVER",
    "COMMUNITY_ADMIN",
    "SUPER_ADMIN",
  ] as const) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  // Default community (Sofia)
  const community = await prisma.community.upsert({
    where: { name: "PrivateRide Sofia" },
    update: {},
    create: {
      name: "PrivateRide Sofia",
      description: "Pilot community, Sofia",
      defaultCurrency: "BGN",
      serviceAreaRadiusM: 30000,
    },
  });
  await prisma.$executeRaw`
    UPDATE "Community"
    SET "serviceAreaCenter" = ST_SetSRID(ST_MakePoint(23.3219, 42.6977), 4326)::geography
    WHERE id = ${community.id}::uuid AND "serviceAreaCenter" IS NULL
  `;

  // Baseline pricing rule for STANDARD/BGN
  await prisma.pricingRule.upsert({
    where: {
      communityId_vehicleCategory_currency_version: {
        communityId: community.id,
        vehicleCategory: "STANDARD",
        currency: "BGN",
        version: 1,
      },
    },
    update: {},
    create: {
      communityId: community.id,
      vehicleCategory: "STANDARD",
      currency: "BGN",
      version: 1,
      baseFareMinor: 200, // 2.00 BGN
      perKmMinor: 120, // 1.20 BGN/km
      perMinuteMinor: 20, // 0.20 BGN/min
      minimumFareMinor: 500, // 5.00 BGN
      cancellationFeeMinor: 300,
      commissionPercent: 10,
    },
  });

  // Super admin — dev credentials; MUST be rotated outside local dev.
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@privateride.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "Admin12345!dev";
  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "SUPER_ADMIN" },
  });
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      emailVerifiedAt: new Date(),
      passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
      firstName: "Platform",
      lastName: "Admin",
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      roles: { create: { roleId: superAdminRole.id } },
      memberships: {
        create: {
          communityId: community.id,
          status: "ACTIVE",
          approvedAt: new Date(),
        },
      },
    },
  });

  // One demo invitation so the first registration can be exercised manually.
  const rawCode = "PR-" + randomBytes(8).toString("hex").toUpperCase();
  const codeHash = createHash("sha256").update(rawCode).digest("hex");
  const existing = await prisma.invitation.findUnique({ where: { codeHash } });
  if (!existing) {
    await prisma.invitation.create({
      data: {
        communityId: community.id,
        codeHash,
        role: "PASSENGER",
        maxUses: 1,
        expiresAt: new Date(Date.now() + 72 * 3_600_000),
        invitedById: admin.id,
      },
    });
    console.log(`Seeded demo invitation code: ${rawCode}`);
  }

  console.log(`Seed complete. Admin: ${email} (community ${community.name})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
