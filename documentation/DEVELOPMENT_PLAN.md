# PrivateRide — Development Plan

Status legend: ✅ done · 🔄 in progress · ⬜ not started

## Milestone 1 — Foundation ✅
- ✅ pnpm + Turborepo monorepo (`apps/*`, `packages/*`)
- ✅ PostgreSQL 16 + PostGIS 3.4, Redis 7 (local services + docker-compose)
- ✅ Prisma schema: all 27 entities, UUID PKs, FKs, soft deletion, timestamps
- ✅ Migration SQL: partial unique indexes (one active ride per driver AND per
  passenger), CHECK constraints (rating 1–5, non-negative money, invitation
  use limits), GiST spatial indexes, `DriverLocation` table
- ✅ NestJS API: Auth, Users, Invitations/Members (admin), Health
- ✅ Invitation-only registration: hashed single/multi-use codes, expiry,
  revocation, per-email binding, race-safe guarded increment
- ✅ Auth: argon2id, access JWT (15 min) + refresh rotation with family reuse
  detection, logout, email-verification tokens, account deletion request
- ✅ RBAC: global guard, DB-backed role + membership resolution per request,
  community scoping for admins
- ✅ Audit logging for admin and auth actions
- ✅ Tests: 17 passing (e2e invitation lifecycle incl. concurrency race,
  refresh reuse, RBAC, cross-community isolation; unit ride state machine)

## Milestone 3 — Ride engine & matching 🔄
- Ride lifecycle state machine (transactional transitions, status history)
- Fare estimates with pricing snapshots
- PostGIS matching with radius expansion, offers with expiry
- One-active-ride invariants (already enforced by DB)

## Milestone 4 — Real-time ⬜
- Socket.IO gateway (authenticated), ride rooms, location ingestion,
  Redis latest-location, stale detection

## Milestone 5 — Payments ⬜
- PaymentProvider interface, sandbox provider, Stripe Connect adapter stub
- Financial ledger (double-entry, minor units), idempotent webhooks

## Milestone 2/6 — Mobile & Admin ⬜
- Expo app (bg/en, passenger + driver flows)
- Next.js admin dashboard

## Milestones 7/8 — Hardening & staging ⬜
- GDPR workflows (export, deletion), retention jobs
- CI/CD, staging deploy, device builds (requires Apple/Google accounts)

## Known caveats
- Prisma cannot declare GiST indexes on `Unsupported` geography columns, so
  `prisma migrate dev` reports them as drift. **Never auto-apply a migration
  that drops `*_gist` indexes** — review every generated migration.
- Email/SMS delivery is stubbed until SMTP / SMS credentials are configured.
- Payment provider runs in sandbox mode until Stripe credentials exist.
