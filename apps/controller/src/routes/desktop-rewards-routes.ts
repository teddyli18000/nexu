import { type OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  claimDesktopRewardRequestSchema,
  claimDesktopRewardResponseSchema,
  desktopRewardsStatusSchema,
} from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import type { ControllerBindings } from "../types.js";

export function registerDesktopRewardsRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/internal/desktop/rewards",
      tags: ["Desktop"],
      responses: {
        200: {
          content: {
            "application/json": { schema: desktopRewardsStatusSchema },
          },
          description: "Desktop rewards status",
        },
      },
    }),
    async (c) =>
      c.json(await container.configStore.getDesktopRewardsStatus(), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/api/internal/desktop/rewards/claim",
      tags: ["Desktop"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: claimDesktopRewardRequestSchema,
            },
          },
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: claimDesktopRewardResponseSchema },
          },
          description: "Claim a desktop reward",
        },
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      return c.json(
        await container.configStore.claimDesktopReward(body.taskId),
        200,
      );
    },
  );
}
