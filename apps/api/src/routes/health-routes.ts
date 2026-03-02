import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "../types.js";

const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.number().int(),
});

const getHealthRoute = createRoute({
  method: "get",
  path: "/health",
  tags: ["Health"],
  responses: {
    200: {
      content: {
        "application/json": { schema: healthResponseSchema },
      },
      description: "Service health check",
    },
  },
});

export function registerHealthRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getHealthRoute, async (c) => {
    return c.json(
      {
        status: "ok",
        timestamp: Date.now(),
      },
      200,
    );
  });
}
