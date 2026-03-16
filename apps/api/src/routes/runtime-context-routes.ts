import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { runtimeContextResponseSchema } from "@nexu/shared";
import type { AppBindings } from "../types.js";

const runtimeContextRoute = createRoute({
  method: "get",
  path: "/api/v1/runtime/context",
  tags: ["Runtime"],
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimeContextResponseSchema },
      },
      description: "Desktop runtime context",
    },
    401: {
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
      description: "Unauthorized",
    },
  },
});

export function registerRuntimeContextRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(runtimeContextRoute, async (c) => {
    const isDesktopRuntime = process.env.NEXU_DESKTOP_RUNTIME === "true";
    const gatewayPoolId = isDesktopRuntime
      ? (process.env.NEXU_GATEWAY_POOL_ID ?? "desktop-local-pool")
      : null;

    return c.json(
      {
        isDesktopRuntime,
        gatewayPoolId,
      },
      200,
    );
  });
}
