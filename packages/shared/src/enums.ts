// Mirrors the Prisma enums. Kept here so mobile/admin apps can depend on
// these values without pulling in the Prisma client.

export const Role = {
  PASSENGER: "PASSENGER",
  DRIVER: "DRIVER",
  COMMUNITY_ADMIN: "COMMUNITY_ADMIN",
  SUPER_ADMIN: "SUPER_ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const MembershipStatus = {
  INVITED: "INVITED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  REJECTED: "REJECTED",
  DEACTIVATED: "DEACTIVATED",
} as const;
export type MembershipStatus =
  (typeof MembershipStatus)[keyof typeof MembershipStatus];

export const RideStatus = {
  REQUESTED: "REQUESTED",
  SEARCHING: "SEARCHING",
  OFFERED: "OFFERED",
  ACCEPTED: "ACCEPTED",
  DRIVER_ARRIVING: "DRIVER_ARRIVING",
  DRIVER_ARRIVED: "DRIVER_ARRIVED",
  IN_PROGRESS: "IN_PROGRESS",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
} as const;
export type RideStatus = (typeof RideStatus)[keyof typeof RideStatus];

export const DriverVerificationStatus = {
  UNSUBMITTED: "UNSUBMITTED",
  PENDING_REVIEW: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  UPDATE_REQUESTED: "UPDATE_REQUESTED",
  SUSPENDED: "SUSPENDED",
} as const;
export type DriverVerificationStatus =
  (typeof DriverVerificationStatus)[keyof typeof DriverVerificationStatus];

export const VehicleCategory = {
  STANDARD: "STANDARD",
  COMFORT: "COMFORT",
  VAN: "VAN",
} as const;
export type VehicleCategory =
  (typeof VehicleCategory)[keyof typeof VehicleCategory];

export const PaymentStatus = {
  REQUIRES_AUTHORIZATION: "REQUIRES_AUTHORIZATION",
  AUTHORIZED: "AUTHORIZED",
  CAPTURED: "CAPTURED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const Currency = {
  BGN: "BGN",
  EUR: "EUR",
} as const;
export type Currency = (typeof Currency)[keyof typeof Currency];
