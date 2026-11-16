import { RideStatus } from "./enums";

/**
 * The single source of truth for which ride status transitions are legal.
 * The backend enforces this map inside a transaction; nothing else may
 * change a ride's status.
 */
export const RIDE_TRANSITIONS: Readonly<Record<RideStatus, readonly RideStatus[]>> = {
  REQUESTED: [RideStatus.SEARCHING, RideStatus.CANCELLED, RideStatus.EXPIRED],
  SEARCHING: [RideStatus.OFFERED, RideStatus.CANCELLED, RideStatus.EXPIRED],
  OFFERED: [
    RideStatus.ACCEPTED,
    RideStatus.SEARCHING, // driver rejected or timed out -> keep searching
    RideStatus.CANCELLED,
    RideStatus.EXPIRED,
  ],
  ACCEPTED: [RideStatus.DRIVER_ARRIVING, RideStatus.CANCELLED],
  DRIVER_ARRIVING: [RideStatus.DRIVER_ARRIVED, RideStatus.CANCELLED],
  DRIVER_ARRIVED: [RideStatus.IN_PROGRESS, RideStatus.CANCELLED],
  IN_PROGRESS: [RideStatus.PAYMENT_PENDING],
  PAYMENT_PENDING: [RideStatus.COMPLETED, RideStatus.PAYMENT_FAILED],
  PAYMENT_FAILED: [RideStatus.PAYMENT_PENDING, RideStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
} as const;

export const TERMINAL_RIDE_STATUSES: readonly RideStatus[] = [
  RideStatus.COMPLETED,
  RideStatus.CANCELLED,
  RideStatus.EXPIRED,
];

/** Statuses in which a driver counts as occupied (one-active-ride invariant). */
export const DRIVER_ACTIVE_RIDE_STATUSES: readonly RideStatus[] = [
  RideStatus.ACCEPTED,
  RideStatus.DRIVER_ARRIVING,
  RideStatus.DRIVER_ARRIVED,
  RideStatus.IN_PROGRESS,
  RideStatus.PAYMENT_PENDING,
];

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from]?.includes(to) ?? false;
}
