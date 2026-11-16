import { z } from "zod";

export const GeoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

export const FareEstimateSchema = z.object({
  pickup: GeoPointSchema,
  dropoff: GeoPointSchema,
  vehicleCategory: z.enum(["STANDARD", "COMFORT", "VAN"]).default("STANDARD"),
});
export type FareEstimateInput = z.infer<typeof FareEstimateSchema>;

export const RequestRideSchema = z.object({
  pickup: GeoPointSchema,
  pickupAddress: z.string().min(1).max(300),
  dropoff: GeoPointSchema,
  dropoffAddress: z.string().min(1).max(300),
  vehicleCategory: z.enum(["STANDARD", "COMFORT", "VAN"]).default("STANDARD"),
  estimateId: z.string().uuid(),
});
export type RequestRideInput = z.infer<typeof RequestRideSchema>;

export const CancelRideSchema = z.object({
  reason: z.string().max(300).optional(),
});
export type CancelRideInput = z.infer<typeof CancelRideSchema>;

export const LocationUpdateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10000).optional(),
  speedMps: z.number().min(0).max(100).optional(),
  headingDeg: z.number().min(0).max(360).optional(),
  recordedAt: z.coerce.date(),
});
export type LocationUpdateInput = z.infer<typeof LocationUpdateSchema>;
