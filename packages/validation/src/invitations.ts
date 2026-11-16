import { z } from "zod";

export const CreateInvitationSchema = z.object({
  role: z.enum(["PASSENGER", "DRIVER", "COMMUNITY_ADMIN"]).default("PASSENGER"),
  invitedEmail: z.string().email().toLowerCase().optional(),
  maxUses: z.number().int().min(1).max(100).default(1),
  ttlHours: z.number().int().min(1).max(24 * 30).default(72),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;

export const MembershipDecisionSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type MembershipDecisionInput = z.infer<typeof MembershipDecisionSchema>;
