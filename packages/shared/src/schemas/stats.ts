import { z } from "zod";

export const userCountResponseSchema = z.object({
  userCount: z.number().int().nonnegative(),
});

export type UserCountResponse = z.infer<typeof userCountResponseSchema>;
