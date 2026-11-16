# PrivateRide API (v1)

Interactive documentation: Swagger UI at `/docs` (non-production).
All endpoints are JSON over HTTPS, versioned under `/v1`, authenticated with
`Authorization: Bearer <access JWT>` unless marked public. Role requirements
are enforced server-side; "active member" means an ACTIVE community
membership.

## Auth (public)
| Method | Path | Notes |
|---|---|---|
| POST | /v1/auth/register | invitation code required; account starts PENDING_APPROVAL, no tokens |
| POST | /v1/auth/login | returns user + access/refresh tokens |
| POST | /v1/auth/refresh | rotates the refresh token; reuse revokes the family |
| POST | /v1/auth/logout | revokes the token family |
| POST | /v1/auth/verify-email | consumes an email-verification token |
| POST | /v1/auth/request-deletion | (auth) GDPR deletion request; revokes sessions |

## Users
| GET | /v1/users/me | profile, memberships, driver profile, roles |

## Rides (active member)
| POST | /v1/rides/estimate | fare estimate; creates immutable pricing snapshot |
| POST | /v1/rides | request ride (payment authorized before matching) |
| GET | /v1/rides | my rides (as passenger or driver) |
| GET | /v1/rides/:id | details; participants and community admins only |
| POST | /v1/rides/:id/cancel | passenger cancel (legal statuses only) |
| POST | /v1/rides/:id/retry-payment | settle a PAYMENT_FAILED ride |
| GET | /v1/rides/:id/receipt | breakdown after settlement |
| GET | /v1/rides/offers | (driver) pending offers |
| POST | /v1/rides/:id/accept·reject·arrived·start·complete | (driver) lifecycle |

## Drivers (active member, DRIVER)
| GET | /v1/drivers/me · /v1/drivers/earnings |
| POST | /v1/drivers/profile · /v1/drivers/vehicles |
| POST | /v1/drivers/availability | go online/offline |
| POST | /v1/drivers/location | GPS ingestion (also via WebSocket) |

## Payments (active member)
| POST/GET | /v1/payments/methods | tokenized methods only |
| POST | /v1/payments/methods/:id/default · DELETE /v1/payments/methods/:id |

## Admin (COMMUNITY_ADMIN / SUPER_ADMIN)
| POST/GET | /v1/admin/invitations · DELETE /v1/admin/invitations/:id |
| GET | /v1/admin/members?status= · POST /v1/admin/members/:id/approve·reject·suspend |
| POST | /v1/admin/drivers/:id/verification · /v1/admin/drivers/vehicles/:id/verification |
| GET | /v1/admin/overview · /overview/rides · /overview/payments · /overview/drivers |
| POST | /v1/admin/payments/:id/refund · /v1/admin/payments/payouts/:driverProfileId |

## Webhooks (public, signature-verified)
| POST | /v1/webhooks/payments | idempotent by provider event id |

## WebSocket — namespace `/realtime` (Socket.IO)
Handshake: `auth.token` = access JWT; non-active members are disconnected.
- `ride:subscribe { rideId }` → ack `{ok}`; participants/admins only
- `location:update {lat,lng,accuracyM?,speedMps?,headingDeg?,recordedAt}` (drivers)
- Server events: `ride:status`, `driver:location`, `ride:offer`
