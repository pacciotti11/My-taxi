import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createInvitation,
  prisma,
  registerAndApprove,
  registerPayload,
  seedBase,
  truncateAll,
  TestWorld,
} from "./helpers";

describe("Membership & auth (e2e)", () => {
  let app: INestApplication;
  let world: TestWorld;

  beforeAll(async () => {
    await truncateAll();
    app = await createApp();
    world = await seedBase(app);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("rejects registration without a valid invitation", async () => {
    await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send(registerPayload("PR-DOESNOTEXIST", "nobody@test.local"))
      .expect(400);
  });

  it("rejects an expired invitation", async () => {
    const { id, code } = await createInvitation(app, world.adminToken);
    await prisma.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send(registerPayload(code, "expired@test.local"))
      .expect(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it("rejects a revoked invitation", async () => {
    const { id, code } = await createInvitation(app, world.adminToken);
    await request(app.getHttpServer())
      .delete(`/v1/admin/invitations/${id}`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send(registerPayload(code, "revoked@test.local"))
      .expect(400);
  });

  it("rejects an invitation issued for a different email", async () => {
    const { code } = await createInvitation(app, world.adminToken, {
      invitedEmail: "only.this@test.local",
    });
    await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send(registerPayload(code, "someone.else@test.local"))
      .expect(400);
  });

  it("allows exactly one registration on a single-use invitation under concurrency", async () => {
    const { code } = await createInvitation(app, world.adminToken);
    const attempts = await Promise.all(
      [1, 2, 3].map((i) =>
        request(app.getHttpServer())
          .post("/v1/auth/register")
          .send(registerPayload(code, `race${i}@test.local`)),
      ),
    );
    const succeeded = attempts.filter((r) => r.status === 201);
    const failed = attempts.filter((r) => r.status === 400);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(2);
  });

  it("registers as PENDING_APPROVAL and withholds tokens until approved", async () => {
    const { code } = await createInvitation(app, world.adminToken);
    const res = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send(registerPayload(code, "pending@test.local"))
      .expect(201);
    expect(res.body.user.membershipStatus).toBe("PENDING_APPROVAL");
    expect(res.body.tokens).toBeNull();
  });

  it("rejects login with a wrong password", async () => {
    await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "admin@test.local", password: "WrongPass123" })
      .expect(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const member = await registerAndApprove(app, world, "rotate@test.local");
    const login = await request(app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "rotate@test.local", password: "Parola1234X" })
      .expect(200);
    const firstRefresh = login.body.tokens.refreshToken;

    const rotated = await request(app.getHttpServer())
      .post("/v1/auth/refresh")
      .send({ refreshToken: firstRefresh })
      .expect(200);
    const secondRefresh = rotated.body.refreshToken;
    expect(secondRefresh).not.toBe(firstRefresh);

    // Reusing the first (already rotated) token is treated as theft...
    await request(app.getHttpServer())
      .post("/v1/auth/refresh")
      .send({ refreshToken: firstRefresh })
      .expect(401);
    // ...and kills the whole family, including the newest token.
    await request(app.getHttpServer())
      .post("/v1/auth/refresh")
      .send({ refreshToken: secondRefresh })
      .expect(401);
    expect(member.userId).toBeTruthy();
  });

  it("blocks admin endpoints for passengers (server-side RBAC)", async () => {
    const member = await registerAndApprove(app, world, "rbac@test.local");
    await request(app.getHttpServer())
      .post("/v1/admin/invitations")
      .set("authorization", `Bearer ${member.token}`)
      .send({ role: "PASSENGER" })
      .expect(403);
    await request(app.getHttpServer())
      .get("/v1/admin/members")
      .set("authorization", `Bearer ${member.token}`)
      .expect(403);
  });

  it("blocks a community admin from managing another community's members", async () => {
    const otherCommunity = await prisma.community.create({
      data: { name: "Other Community" },
    });
    const foreignAdmin = await registerAndApprove(
      app,
      world,
      "foreign.admin@test.local",
      "COMMUNITY_ADMIN",
    );
    // Move the foreign admin's membership to the other community.
    await prisma.communityMembership.updateMany({
      where: { userId: foreignAdmin.userId },
      data: { communityId: otherCommunity.id },
    });

    const victim = await registerAndApprove(app, world, "victim@test.local");
    const victimMembership = await prisma.communityMembership.findFirstOrThrow({
      where: { userId: victim.userId },
    });

    await request(app.getHttpServer())
      .post(`/v1/admin/members/${victimMembership.id}/suspend`)
      .set("authorization", `Bearer ${foreignAdmin.token}`)
      .send({ reason: "should not work" })
      .expect(403);
  });

  it("suspends a member and reflects it in authorization context", async () => {
    const member = await registerAndApprove(app, world, "suspend@test.local");
    const membership = await prisma.communityMembership.findFirstOrThrow({
      where: { userId: member.userId },
    });
    await request(app.getHttpServer())
      .post(`/v1/admin/members/${membership.id}/suspend`)
      .set("authorization", `Bearer ${world.adminToken}`)
      .send({ reason: "test suspension" })
      .expect(201);

    const me = await request(app.getHttpServer())
      .get("/v1/users/me")
      .set("authorization", `Bearer ${member.token}`)
      .expect(200);
    expect(me.body.memberships[0].status).toBe("SUSPENDED");
  });

  it("requires authentication for protected endpoints", async () => {
    await request(app.getHttpServer()).get("/v1/users/me").expect(401);
  });
});
