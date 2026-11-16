/** Matching radius expansion steps, in meters. Admin-configurable per community. */
export const DEFAULT_MATCHING_RADII_METERS = [3000, 5000, 10000] as const;

/** Seconds a driver has to respond to an offer before it moves on. */
export const DEFAULT_OFFER_TIMEOUT_SECONDS = 20;

/** Seconds a ride may stay in SEARCHING before expiring. */
export const DEFAULT_SEARCH_TIMEOUT_SECONDS = 180;

/** Default invitation validity window. */
export const DEFAULT_INVITATION_TTL_HOURS = 72;

/** A GPS fix older than this is considered stale for matching. */
export const LOCATION_STALE_AFTER_SECONDS = 60;

/** Max accepted horizontal accuracy (meters) for a location update. */
export const LOCATION_MAX_ACCURACY_METERS = 100;

export const SUPPORTED_LOCALES = ["bg", "en"] as const;
export const DEFAULT_LOCALE = "bg";
