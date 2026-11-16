# PrivateRide — Security & GDPR

## Implemented (Milestone 1)
- **Passwords**: argon2id (19 MiB, t=2), constant-time dummy verification for
  unknown emails to flatten timing.
- **Tokens**: 15-min access JWT; opaque refresh tokens stored as SHA-256
  hashes, rotated on every refresh; reuse detection revokes the entire token
  family; logout and account-deletion revoke all sessions.
- **RBAC**: global guard; roles and membership status re-read from the DB on
  every request (suspension is effective immediately); community admins are
  hard-scoped to their own community; SUPER_ADMIN audited like everyone.
- **Invitations**: only hashes stored, single-use by default, expiring,
  revocable, optionally email-bound; race-safe consumption.
- **Validation**: all input through shared Zod schemas; Prisma parameterized
  queries (no string SQL with user input).
- **Rate limiting**: global 120/min; auth endpoints 5–20/min.
- **Headers**: helmet defaults.
- **Audit**: `AuditLog` rows for registration, invitation and membership
  actions with actor, IP, user agent.

## Planned (Milestones 5–7)
- Webhook signature verification + idempotent processing (schema ready:
  `WebhookEvent` unique per provider event id).
- Secrets via environment / managed secret store; none committed.
- Encryption at rest: use managed Postgres with disk encryption.
- Brute-force lockouts beyond rate limiting; session device listing.

## GDPR position (not legal advice)
- **Controller**: the community operator. The position of this document: the
  software gives the operator tools; it does not by itself make the
  operation lawful.
- **Data minimization**: GPS traces are kept per ride, not forever; the
  retention job (M7) prunes `RideLocation` after a configurable window
  (default target: 90 days) and `AuditLog`/`RefreshToken` on schedule.
- **Rights**: account deletion request flow exists (`deletionRequestedAt`,
  immediate session revocation); export + hard anonymization job lands in M7.
- **Consent records**: `termsAcceptedAt` / `privacyAcceptedAt` captured at
  registration; location permission consent is collected on-device (M2).

## ⚠️ Requires professional review before any real launch
This platform carries passengers for money in Bulgaria/EU. Software cannot
make that legal by itself. Before pilot launch, obtain professional review
of at least:
- **Transport licensing**: Bulgarian Автомобилни превози act — whether a
  private-community model is exempt or needs taxi/TRP licensing per driver.
- **Payments**: whether the operator acts as a payment intermediary
  (PSD2 agent status), Stripe Connect eligibility for BG entities, invoicing.
- **Tax**: VAT on rides/commission, driver income reporting (НАП), fiscal
  receipt requirements (Наредба Н-18 applicability).
- **Insurance**: passenger-carrying insurance obligations per vehicle.
- **GDPR**: DPIA for systematic location tracking, processor agreements
  (hosting, maps, payments, push), breach response plan.
- **Consumer protection**: pricing transparency and cancellation terms.
