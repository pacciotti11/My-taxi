-- One active ride per driver: a driver may hold at most one ride in a
-- non-terminal, assigned status. Enforced by the database, not application code.
CREATE UNIQUE INDEX "Ride_one_active_per_driver"
  ON "Ride" ("driverId")
  WHERE "driverId" IS NOT NULL
    AND "status" IN ('ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'PAYMENT_PENDING');

-- A passenger may hold at most one non-terminal ride.
CREATE UNIQUE INDEX "Ride_one_active_per_passenger"
  ON "Ride" ("passengerId")
  WHERE "status" IN ('REQUESTED', 'SEARCHING', 'OFFERED', 'ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'PAYMENT_PENDING');

-- Rating scores are 1..5.
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_score_range" CHECK ("score" BETWEEN 1 AND 5);

-- Monetary amounts are non-negative.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonneg" CHECK ("amountMinor" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "FinancialLedgerEntry" ADD CONSTRAINT "Ledger_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amountMinor" > 0);

-- Invitations cannot be over-used.
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_uses_within_limit" CHECK ("usedCount" <= "maxUses");

-- Spatial indexes for matching and geofencing.
CREATE INDEX "Ride_pickupPoint_gist" ON "Ride" USING GIST ("pickupPoint");
CREATE INDEX "RideLocation_point_gist" ON "RideLocation" USING GIST ("point");
CREATE INDEX "Community_serviceAreaCenter_gist" ON "Community" USING GIST ("serviceAreaCenter");

-- Latest driver locations live in Redis; this table stores the durable
-- per-driver last-known location for matching after restarts.
CREATE TABLE "DriverLocation" (
  "driverProfileId" UUID PRIMARY KEY REFERENCES "DriverProfile"("id") ON DELETE CASCADE,
  "point" geography(Point, 4326) NOT NULL,
  "accuracyM" DOUBLE PRECISION,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DriverLocation_point_gist" ON "DriverLocation" USING GIST ("point");
