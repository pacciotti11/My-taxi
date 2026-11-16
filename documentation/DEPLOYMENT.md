# PrivateRide — Development & Deployment

## Local development

Prerequisites: Node 22+, pnpm 10+, Docker (or local PostgreSQL 16 + PostGIS
and Redis 7).

```bash
pnpm install
docker compose -f docker/docker-compose.yml up -d
cp .env.example packages/database/.env   # edit secrets
cp packages/database/.env apps/api/.env
pnpm db:migrate        # applies migrations (needs a superuser for CREATE EXTENSION postgis once)
pnpm db:seed           # roles, community, pricing rule, super admin, demo invitation
pnpm build
node apps/api/dist/main.js   # or: pnpm --filter @privateride/api dev
```

- API: http://localhost:3000/v1 — Swagger at /docs (non-production only)
- Seeded admin: `admin@privateride.local` / `Admin12345!dev` (dev only — the
  seed reads SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD; always override outside
  local dev)

## Tests

```bash
pnpm --filter @privateride/api test
```

E2E tests use the `privateride_test` database (created automatically) and a
live Redis. Suites run sequentially against a shared schema.

## Migrations

`pnpm db:migrate` in dev; `prisma migrate deploy` in CI/production.
**Review every generated migration**: Prisma does not model the GiST indexes
on geography columns and will propose dropping them (see DEVELOPMENT_PLAN
caveats).

## Production (target shape)
- Managed PostgreSQL with PostGIS (e.g. AWS RDS, Supabase, Crunchy) with
  automated backups + PITR; managed Redis (e.g. Upstash, Elasticache).
- API as a container (Dockerfile lands with CI in M8); horizontal scaling
  behind a load balancer; Socket.IO with the Redis adapter when >1 replica.
- Secrets from the platform's secret manager; never in the repo.
- Sentry DSN + OpenTelemetry exporter via env (wired in M8).
- Separate dev / staging / production environments and databases.

## Mobile distribution (M8)
Expo development builds (not Expo Go — background location and maps need
native config), EAS Build → TestFlight / Play internal testing. Requires
Apple Developer and Google Play accounts.
