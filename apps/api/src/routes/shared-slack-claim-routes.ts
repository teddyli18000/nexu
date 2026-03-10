import crypto from "node:crypto";
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  generateClaimKeyResponseSchema,
  generateClaimKeySchema,
  resolveClaimKeyQuerySchema,
  resolveClaimKeyResponseSchema,
  sharedSlackClaimResponseSchema,
  sharedSlackClaimSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { db } from "../db/index.js";
import { slackClaimKeys, slackUserClaims, users } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

const CLAIM_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Internal: generate claim key (called by gateway) ──

const generateClaimKeyRoute = createRoute({
  method: "post",
  path: "/api/internal/shared-slack/claim-key",
  tags: ["Shared Slack App"],
  request: {
    body: {
      content: { "application/json": { schema: generateClaimKeySchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: generateClaimKeyResponseSchema },
      },
      description: "Claim key generated",
    },
  },
});

// ── Public: resolve claim key (no auth) ──

const resolveClaimKeyRoute = createRoute({
  method: "get",
  path: "/api/shared-slack/resolve-claim-key",
  tags: ["Shared Slack App"],
  request: {
    query: resolveClaimKeyQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: resolveClaimKeyResponseSchema },
      },
      description: "Claim key resolved",
    },
  },
});

// ── Authenticated: submit claim ──

const sharedSlackClaimRoute = createRoute({
  method: "post",
  path: "/api/v1/shared-slack/claim",
  tags: ["Shared Slack App"],
  request: {
    body: {
      content: { "application/json": { schema: sharedSlackClaimSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: sharedSlackClaimResponseSchema },
      },
      description: "Shared Slack user identity claimed",
    },
  },
});

// ── Register public routes (before auth middleware) ──

export function registerSharedSlackClaimPublicRoutes(
  app: OpenAPIHono<AppBindings>,
) {
  // Generate claim key
  app.openapi(generateClaimKeyRoute, async (c) => {
    const input = c.req.valid("json");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CLAIM_KEY_TTL_MS).toISOString();
    const key = crypto.randomBytes(32).toString("base64url");

    await db.insert(slackClaimKeys).values({
      id: createId(),
      key,
      teamId: input.teamId,
      teamName: input.teamName ?? null,
      slackUserId: input.slackUserId,
      expiresAt,
      createdAt: now.toISOString(),
    });

    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
    const claimUrl = `${webUrl}/claim?key=${encodeURIComponent(key)}`;

    return c.json({ claimUrl, key, expiresAt }, 200);
  });

  // Resolve claim key
  app.openapi(resolveClaimKeyRoute, async (c) => {
    const { key } = c.req.valid("query");

    const [row] = await db
      .select()
      .from(slackClaimKeys)
      .where(eq(slackClaimKeys.key, key));

    if (!row) {
      return c.json({ valid: false, expired: false, used: false }, 200);
    }

    const expired = new Date(row.expiresAt) < new Date();
    const used = row.usedAt !== null;

    if (expired || used) {
      return c.json({ valid: false, expired, used }, 200);
    }

    // Check existing workspace members
    const [memberStats] = await db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(slackUserClaims)
      .where(eq(slackUserClaims.teamId, row.teamId));

    const memberCount = memberStats?.count ?? 0;

    return c.json(
      {
        valid: true,
        expired: false,
        used: false,
        teamId: row.teamId,
        teamName: row.teamName,
        slackUserId: row.slackUserId,
        isExistingWorkspace: memberCount > 0,
        memberCount,
      },
      200,
    );
  });
}

// ── Register authenticated routes (after auth middleware) ──

export function registerSharedSlackClaimRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(sharedSlackClaimRoute, async (c) => {
    const authUserId = c.get("userId");
    const input = c.req.valid("json");
    const now = new Date().toISOString();

    // Validate claim key
    const [keyRow] = await db
      .select()
      .from(slackClaimKeys)
      .where(eq(slackClaimKeys.key, input.key));

    if (!keyRow) {
      throw new HTTPException(400, { message: "Invalid claim key" });
    }
    if (new Date(keyRow.expiresAt) < new Date()) {
      throw new HTTPException(400, { message: "Claim key has expired" });
    }
    if (keyRow.usedAt !== null) {
      throw new HTTPException(400, { message: "Claim key already used" });
    }

    // Mark key as used
    await db
      .update(slackClaimKeys)
      .set({ usedAt: now, claimedBy: authUserId })
      .where(eq(slackClaimKeys.key, input.key));

    // Ensure app user exists
    let [appUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authUserId, authUserId));

    if (!appUser) {
      await db.insert(users).values({
        id: createId(),
        authUserId,
        inviteAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      [appUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.authUserId, authUserId));
    }

    // Check if Slack identity already claimed by another user
    const [existingClaim] = await db
      .select({ authUserId: slackUserClaims.authUserId })
      .from(slackUserClaims)
      .where(
        and(
          eq(slackUserClaims.teamId, keyRow.teamId),
          eq(slackUserClaims.slackUserId, keyRow.slackUserId),
        ),
      );
    if (existingClaim && existingClaim.authUserId !== authUserId) {
      throw new HTTPException(409, {
        message: "Slack identity already claimed by another user",
      });
    }

    // Insert slack user claim (onConflictDoNothing for idempotency of same user)
    await db
      .insert(slackUserClaims)
      .values({
        id: createId(),
        teamId: keyRow.teamId,
        teamName: keyRow.teamName,
        slackUserId: keyRow.slackUserId,
        authUserId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [slackUserClaims.teamId, slackUserClaims.slackUserId],
      });

    // Update user auth source
    const detail = JSON.stringify({
      teamId: keyRow.teamId,
      teamName: keyRow.teamName,
      slackUserId: keyRow.slackUserId,
    });
    await db
      .update(users)
      .set({
        authSource: "slack_shared_claim",
        authSourceDetail: detail,
        updatedAt: now,
      })
      .where(eq(users.authUserId, authUserId));

    // Check if org already authorized (other users in same team)
    const [memberStats] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(slackUserClaims)
      .where(
        and(
          eq(slackUserClaims.teamId, keyRow.teamId),
          sql`${slackUserClaims.authUserId} != ${authUserId}`,
        ),
      );

    const orgAuthorized = (memberStats?.count ?? 0) > 0;

    return c.json({ ok: true, orgAuthorized }, 200);
  });
}
