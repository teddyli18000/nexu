import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { userCountResponseSchema } from "@nexu/shared";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

const getUserCountRoute = createRoute({
  method: "get",
  path: "/api/v1/stats/user-count",
  tags: ["Stats"],
  responses: {
    200: {
      content: {
        "application/json": { schema: userCountResponseSchema },
      },
      description: "Total user count",
    },
  },
});

export function registerStatsRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getUserCountRoute, async (c) => {
    const [result] = await db
      .select({ userCount: sql<number>`count(*)::int` })
      .from(users);

    return c.json(
      {
        userCount: result?.userCount ?? 0,
      },
      200,
    );
  });
}
