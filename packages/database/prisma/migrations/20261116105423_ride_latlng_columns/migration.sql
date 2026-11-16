-- Add numeric coordinate columns (used by application logic); geography
-- columns become nullable and are populated via SQL in the same transaction
-- as ride creation. GiST indexes and FKs are intentionally left untouched.
ALTER TABLE "Ride"
  ADD COLUMN "pickupLat" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "pickupLng" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "dropoffLat" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "dropoffLng" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ALTER COLUMN "pickupPoint" DROP NOT NULL,
  ALTER COLUMN "dropoffPoint" DROP NOT NULL;
ALTER TABLE "Ride"
  ALTER COLUMN "pickupLat" DROP DEFAULT,
  ALTER COLUMN "pickupLng" DROP DEFAULT,
  ALTER COLUMN "dropoffLat" DROP DEFAULT,
  ALTER COLUMN "dropoffLng" DROP DEFAULT;
