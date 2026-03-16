import { z } from "zod";

export const runtimeContextResponseSchema = z.object({
  isDesktopRuntime: z.boolean(),
  gatewayPoolId: z.string().nullable(),
});

export type RuntimeContextResponse = z.infer<
  typeof runtimeContextResponseSchema
>;
