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

## Milestone 3 — Ride engine & matching ✅
- Transactional ride state machine (row locks, status history, shared
  transition map); estimates with immutable pricing snapshots; final fare
  recomputed from actual duration on completion
- Driver onboarding (profile, vehicles, admin verification), availability,
  location ingestion with accuracy/staleness validation
- PostGIS matching with radius expansion (3/5/10 km), offers with expiry,
  accept/reject/timeout, BullMQ coordination worker

## Milestone 4 — Real-time ✅
- Redis pub/sub event bridge → Socket.IO gateway (`/realtime`), JWT auth at
  handshake, room isolation (ride rooms + per-driver offer rooms)
- GPS streaming over socket or REST; RideLocation traces during active rides

## Milestone 5 — Payments ✅
- PaymentProvider interface; sandbox provider (test mode); Stripe adapter
  written but UNVERIFIED without real credentials
- Authorize before matching → capture on completion → COMPLETED, with
  PAYMENT_FAILED + retry (re-authorization) path
- Double-entry ledger in minor units, unique idempotency keys; refunds;
  sandbox payouts; signature-verified idempotent webhooks

## Milestone 6 — Admin dashboard ✅ (core)
- Next.js + Tailwind (shadcn/ui deliberately skipped for now — plain
  Tailwind components keep the build dependency-light; revisit if desired)
- Login, overview stats, members approve/suspend/reject, invitations
  create/revoke, driver + vehicle verification, rides monitor (10 s poll),
  payments + refunds. Verified live against the API with Playwright.
- Token in localStorage — acceptable for a trusted-admin MVP; move to
  httpOnly cookie sessions before exposure beyond trusted admins.

## Milestone 2 — Mobile app 🔄 (functional scaffold, NOT device-tested)
- Expo SDK 52 + expo-router + TypeScript (strict, typecheck passes)
- bg/en i18n (bg default), secure token storage with refresh rotation
- Passenger: estimate → request → live driver tracking via socket →
  completion → retry payment; resume of active ride on app restart
- Driver: online toggle with foreground GPS streaming, offers (socket push),
  accept/reject, arrived/start/complete, earnings
- Payment methods: sandbox token registration (real flow = provider-hosted
  sheet, e.g. Stripe PaymentSheet)
- Map is a placeholder component: react-native-maps + geocoding require an
  Expo development build and a maps provider key (M8); screens are built so
  the map drops in without flow changes

## Milestones 7/8 — Hardening & staging ⬜ (remaining)
- Ratings endpoints, notifications delivery (BullMQ workers, Expo push),
  email/SMS providers, GDPR export + anonymization jobs, GPS retention job
- Background location (dev build), address autocomplete/geocoding provider
- Device builds via EAS, TestFlight / Play internal testing
- Staging deploy, Sentry/OTel wiring, backups
- CI exists (.github/workflows/ci.yml: build, migrate, 35 API tests, admin
  build, mobile typecheck)

## Known caveats
- Prisma cannot declare GiST indexes on `Unsupported` geography columns, so
  `prisma migrate dev` reports them as drift. **Never auto-apply a migration
  that drops `*_gist` indexes** — review every generated migration.
- Email/SMS delivery is stubbed until SMTP / SMS credentials are configured.
- Payment provider runs in sandbox mode until Stripe credentials exist.
