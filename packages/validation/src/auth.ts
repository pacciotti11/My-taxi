import { z } from "zod";

export const PasswordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(128)
  .refine((v) => /[a-z]/.test(v) && /[A-Z0-9]/.test(v), {
    message: "Password must mix lower case with upper case or digits",
  });

export const RegisterSchema = z.object({
  invitationCode: z.string().min(6).max(64),
  email: z.string().email().toLowerCase(),
  password: PasswordSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164, e.g. +359881234567")
    .optional(),
  locale: z.enum(["bg", "en"]).default("bg"),
  acceptTerms: z.literal(true, {
    errorMap: () => ({ message: "Terms must be accepted" }),
  }),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(20).max(256),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

export const VerifyEmailSchema = z.object({
  token: z.string().min(10),
});
export type VerifyEmailInput = z.infer<typeof VerifyEmailSchema>;
