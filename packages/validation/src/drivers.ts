import { z } from "zod";

export const CreateDriverProfileSchema = z.object({
  licenseNumber: z.string().min(3).max(50),
});
export type CreateDriverProfileInput = z.infer<typeof CreateDriverProfileSchema>;

export const CreateVehicleSchema = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  color: z.string().min(1).max(30),
  registrationNumber: z
    .string()
    .min(2)
    .max(12)
    .transform((v) => v.toUpperCase().replace(/\s/g, "")),
  category: z.enum(["STANDARD", "COMFORT", "VAN"]).default("STANDARD"),
  seats: z.number().int().min(1).max(8).default(4),
});
export type CreateVehicleInput = z.infer<typeof CreateVehicleSchema>;

export const AvailabilitySchema = z.object({
  online: z.boolean(),
});
export type AvailabilityInput = z.infer<typeof AvailabilitySchema>;
