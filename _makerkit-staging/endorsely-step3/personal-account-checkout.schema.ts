import * as z from 'zod';

export const PersonalAccountCheckoutSchema = z.object({
  planId: z.string().min(1),
  productId: z.string().min(1),
  // Endorsely affiliate referral ID (read from window.endorsely_referral)
  referralId: z.string().max(128).optional(),
});
