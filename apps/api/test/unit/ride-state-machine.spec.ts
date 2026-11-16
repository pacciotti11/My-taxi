import { describe, expect, it } from "vitest";
import {
  canTransition,
  DRIVER_ACTIVE_RIDE_STATUSES,
  RIDE_TRANSITIONS,
  RideStatus,
  TERMINAL_RIDE_STATUSES,
} from "@privateride/shared";

describe("ride state machine", () => {
  it("allows the happy path end to end", () => {
    const path: RideStatus[] = [
      RideStatus.REQUESTED,
      RideStatus.SEARCHING,
      RideStatus.OFFERED,
      RideStatus.ACCEPTED,
      RideStatus.DRIVER_ARRIVING,
      RideStatus.DRIVER_ARRIVED,
      RideStatus.IN_PROGRESS,
      RideStatus.PAYMENT_PENDING,
      RideStatus.COMPLETED,
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("forbids skipping states", () => {
    expect(canTransition(RideStatus.REQUESTED, RideStatus.IN_PROGRESS)).toBe(false);
    expect(canTransition(RideStatus.ACCEPTED, RideStatus.COMPLETED)).toBe(false);
    expect(canTransition(RideStatus.SEARCHING, RideStatus.ACCEPTED)).toBe(false);
    // A ride that never started cannot be completed by a driver.
    expect(canTransition(RideStatus.DRIVER_ARRIVED, RideStatus.PAYMENT_PENDING)).toBe(false);
  });

  it("terminal states have no outgoing transitions", () => {
    for (const status of TERMINAL_RIDE_STATUSES) {
      expect(RIDE_TRANSITIONS[status]).toHaveLength(0);
    }
  });

  it("cancellation is impossible once the ride is in progress", () => {
    expect(canTransition(RideStatus.IN_PROGRESS, RideStatus.CANCELLED)).toBe(false);
  });

  it("driver-occupying statuses are exactly the assigned non-terminal ones", () => {
    expect(DRIVER_ACTIVE_RIDE_STATUSES).toEqual([
      RideStatus.ACCEPTED,
      RideStatus.DRIVER_ARRIVING,
      RideStatus.DRIVER_ARRIVED,
      RideStatus.IN_PROGRESS,
      RideStatus.PAYMENT_PENDING,
    ]);
  });
});
