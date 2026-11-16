# PrivateRide — Architecture

## Shape
Modular monolith in a TypeScript monorepo. One deployable API (NestJS),
one admin web app (Next.js), one mobile app (Expo), shared packages for
contracts. Microservices are deliberately avoided until a measured scaling
need exists.

```
apps/
  api/      NestJS modular monolith (REST /v1, Socket.IO, BullMQ workers)
  admin/    Next.js dashboard (M6)
  mobile/   Expo React Native app (M2)
packages/
  database/   Prisma schema + client + migrations (PostgreSQL + PostGIS)
  shared/     Domain enums, ride state machine, constants (no runtime deps)
  validation/ Zod schemas shared by API and clients
  config/     Base tsconfig
docker/       docker-compose for local Postgres+PostGIS and Redis
```

## Key decisions

**Single source of truth = PostgreSQL.** Redis holds only ephemeral
coordination state (driver availability, latest GPS fix, matching locks).
Financial and ride-assignment correctness never depends on Redis alone.

**Invariants live in the database.** Partial unique indexes guarantee at most
one active ride per driver and per passenger; CHECK constraints guard money
and rating ranges. Application code treats constraint violations as expected
race outcomes, not errors to hide.

**Ride state machine.** `packages/shared/src/ride-state-machine.ts` is the
only legal-transition map. The API performs transitions inside transactions,
appends `RideStatusHistory`, and emits events. Terminal states have no exits.

**AuthN/AuthZ.** Stateless access JWT (15 min) carries only `sub` + roles;
every request re-resolves roles and membership status from the DB so
suspensions apply immediately. Refresh tokens are opaque 384-bit values,
stored hashed, rotated on every use; reuse of a rotated token revokes the
whole token family. RBAC and community scoping are enforced server-side in
guards and services — never in clients.

**Invitations.** Only SHA-256 hashes of codes are stored; the raw code is
returned exactly once at creation. Consumption uses a guarded conditional
update inside the registration transaction, so concurrent use of a
single-use code admits exactly one account (covered by an e2e race test).

**Money.** Integer minor units everywhere (`amountMinor`). The ledger is
double-entry (`debitAccount`/`creditAccount`) with a unique
`idempotencyKey` per financial event, so duplicate webhooks cannot book twice.

**Payments.** `PaymentProvider` interface with a sandbox implementation;
Stripe Connect is the primary real candidate, pending business-eligibility
verification for Bulgaria (BGN/EUR, connected accounts, payout rails).
Webhooks are signature-verified, persisted in `WebhookEvent`
(unique per provider event id), and processed idempotently.

**Geo.** PostGIS `geography(Point,4326)` columns with GiST indexes; matching
uses `ST_DWithin` with expanding radii (3→5→10 km). Live locations: Redis;
durable last-known driver location: `DriverLocation`; per-ride traces:
`RideLocation` with a retention policy (see SECURITY.md).

## Request flow (ride request, M3)
1. `POST /v1/rides/estimate` → pricing engine computes fare, stores
   `PricingSnapshot`, returns estimate id.
2. `POST /v1/rides` (active member, passenger) → creates ride REQUESTED →
   SEARCHING, enqueues matching job.
3. Matching worker queries PostGIS for eligible drivers (verified, online,
   no active ride, in radius), creates `RideAssignment` offers with expiry.
4. Driver accepts → transactional transition SEARCHING/OFFERED → ACCEPTED;
   the partial unique index makes double-assignment impossible.
5. Socket.IO rooms (`ride:<id>`) stream driver location to authorized
   participants only.
