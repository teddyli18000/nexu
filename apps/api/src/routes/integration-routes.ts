import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  connectIntegrationResponseSchema,
  connectIntegrationSchema,
  integrationListResponseSchema,
  integrationResponseSchema,
  refreshIntegrationSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  integrationCredentials,
  supportedToolkits,
  userIntegrations,
} from "../db/schema/index.js";
import {
  checkOAuthStatus,
  initializeOAuthConnection,
  maskCredential,
  revokeConnection,
  validateCredentialFields,
} from "../lib/composio.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const integrationIdParam = z.object({
  integrationId: z.string(),
});

function getToolkitIconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

// --- Routes ---

const listIntegrationsRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations",
  tags: ["Integrations"],
  responses: {
    200: {
      content: {
        "application/json": { schema: integrationListResponseSchema },
      },
      description: "List of integrations with user status",
    },
  },
});

const connectIntegrationRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/connect",
  tags: ["Integrations"],
  request: {
    body: {
      content: { "application/json": { schema: connectIntegrationSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: connectIntegrationResponseSchema },
      },
      description: "Connection initiated",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Toolkit not found",
    },
  },
});

const refreshIntegrationRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/{integrationId}/refresh",
  tags: ["Integrations"],
  request: {
    params: integrationIdParam,
    body: {
      content: { "application/json": { schema: refreshIntegrationSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: integrationResponseSchema },
      },
      description: "Integration status refreshed",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    403: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "State verification failed",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Integration not found",
    },
  },
});

const deleteIntegrationRoute = createRoute({
  method: "delete",
  path: "/api/v1/integrations/{integrationId}",
  tags: ["Integrations"],
  request: {
    params: integrationIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: integrationResponseSchema },
      },
      description: "Integration disconnected",
    },
    403: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Cannot disconnect global toolkit",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Integration not found",
    },
  },
});

// --- Helpers ---

type AuthField = {
  key: string;
  label: string;
  type: "text" | "secret";
  placeholder?: string;
};

type ToolkitRow = typeof supportedToolkits.$inferSelect;

function parseAuthFields(raw: string | null): AuthField[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AuthField[];
  } catch {
    return [];
  }
}

function buildToolkitInfo(toolkit: ToolkitRow) {
  const authFields = parseAuthFields(toolkit.authFields);
  return {
    slug: toolkit.slug,
    displayName: toolkit.displayName,
    description: toolkit.description,
    iconUrl: getToolkitIconUrl(toolkit.domain),
    category: toolkit.category ?? "office",
    authScheme: toolkit.authScheme as
      | "oauth2"
      | "api_key_global"
      | "api_key_user",
    authFields: authFields.length > 0 ? authFields : undefined,
  };
}

function buildFallbackToolkitInfo(slug: string) {
  return {
    slug,
    displayName: slug,
    description: "",
    iconUrl: getToolkitIconUrl(""),
    category: "office",
    authScheme: "oauth2" as const,
  };
}

async function getCredentialHints(
  integrationId: string,
): Promise<Record<string, string> | undefined> {
  const creds = await db
    .select({
      credentialKey: integrationCredentials.credentialKey,
      encryptedValue: integrationCredentials.encryptedValue,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.integrationId, integrationId));

  if (creds.length === 0) return undefined;

  const hints: Record<string, string> = {};
  for (const cred of creds) {
    const decrypted = decrypt(cred.encryptedValue);
    hints[cred.credentialKey] = maskCredential(decrypted);
  }
  return hints;
}

// --- Handler registration ---

export function registerIntegrationRoutes(app: OpenAPIHono<AppBindings>) {
  // GET /api/v1/integrations
  app.openapi(listIntegrationsRoute, async (c) => {
    const userId = c.get("userId");

    const toolkits = await db
      .select()
      .from(supportedToolkits)
      .where(eq(supportedToolkits.enabled, true))
      .orderBy(supportedToolkits.sortOrder);

    const userRows = await db
      .select()
      .from(userIntegrations)
      .where(eq(userIntegrations.userId, userId));

    const userMap = new Map(userRows.map((r) => [r.toolkitSlug, r]));

    // Check for global credentials
    const globalSlugs = toolkits
      .filter((t) => t.authScheme === "api_key_global")
      .map((t) => t.slug);

    const globalCredMap = new Map<string, boolean>();
    for (const slug of globalSlugs) {
      const globalCreds = await db
        .select({ pk: integrationCredentials.pk })
        .from(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, `global:${slug}`))
        .limit(1);
      globalCredMap.set(slug, globalCreds.length > 0);
    }

    const integrations = await Promise.all(
      toolkits.map(async (toolkit) => {
        const userRow = userMap.get(toolkit.slug);

        let status: string;
        let credentialHints: Record<string, string> | undefined;

        if (toolkit.authScheme === "api_key_global") {
          status = globalCredMap.get(toolkit.slug) ? "active" : "pending";
        } else if (userRow) {
          status = userRow.status ?? "pending";
          if (
            toolkit.authScheme === "api_key_user" &&
            status === "active" &&
            userRow.id
          ) {
            credentialHints = await getCredentialHints(userRow.id);
          }
        } else {
          status = "pending";
        }

        return {
          id: userRow?.id,
          toolkit: buildToolkitInfo(toolkit),
          status: status as
            | "pending"
            | "initiated"
            | "active"
            | "failed"
            | "expired"
            | "disconnected",
          connectedAt: userRow?.connectedAt ?? undefined,
          credentialHints,
        };
      }),
    );

    return c.json({ integrations }, 200);
  });

  // POST /api/v1/integrations/connect
  app.openapi(connectIntegrationRoute, async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const { toolkitSlug, credentials, source, returnTo } = body;

    const [toolkit] = await db
      .select()
      .from(supportedToolkits)
      .where(
        and(
          eq(supportedToolkits.slug, toolkitSlug),
          eq(supportedToolkits.enabled, true),
        ),
      )
      .limit(1);

    if (!toolkit) {
      return c.json({ message: "Toolkit not found" }, 404);
    }

    if (toolkit.authScheme === "api_key_global") {
      return c.json(
        { message: "Global toolkits are managed by the administrator" },
        400,
      );
    }

    const authFields = parseAuthFields(toolkit.authFields);
    const now = new Date().toISOString();
    const oauthState = crypto.randomUUID();

    const [existing] = await db
      .select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.toolkitSlug, toolkitSlug),
        ),
      )
      .limit(1);

    let integrationId: string;

    if (existing) {
      integrationId = existing.id;
      await db
        .update(userIntegrations)
        .set({
          status:
            toolkit.authScheme === "api_key_user" ? "active" : "initiated",
          oauthState: toolkit.authScheme === "oauth2" ? oauthState : null,
          composioAccountId: null,
          updatedAt: now,
        })
        .where(eq(userIntegrations.id, existing.id));
    } else {
      integrationId = createId();
      await db.insert(userIntegrations).values({
        id: integrationId,
        userId,
        toolkitSlug,
        status: toolkit.authScheme === "api_key_user" ? "active" : "initiated",
        oauthState: toolkit.authScheme === "oauth2" ? oauthState : null,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Handle api_key_user
    if (toolkit.authScheme === "api_key_user") {
      if (!credentials) {
        return c.json(
          { message: "Credentials required for this toolkit" },
          400,
        );
      }
      validateCredentialFields(authFields, credentials);

      await db
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, integrationId));

      for (const field of authFields) {
        const value = credentials[field.key] ?? "";
        const encrypted = encrypt(value);
        await db.insert(integrationCredentials).values({
          id: createId(),
          integrationId,
          credentialKey: field.key,
          encryptedValue: encrypted,
          createdAt: now,
        });
      }

      await db
        .update(userIntegrations)
        .set({ connectedAt: now, updatedAt: now })
        .where(eq(userIntegrations.id, integrationId));

      const hints = await getCredentialHints(integrationId);

      return c.json(
        {
          integration: {
            id: integrationId,
            toolkit: buildToolkitInfo(toolkit),
            status: "active" as const,
            connectedAt: now,
            credentialHints: hints,
          },
        },
        200,
      );
    }

    // Handle oauth2
    const result = await initializeOAuthConnection(
      toolkitSlug,
      userId,
      oauthState,
      { source, returnTo },
    );

    return c.json(
      {
        integration: {
          id: integrationId,
          toolkit: buildToolkitInfo(toolkit),
          status: "initiated" as const,
        },
        connectUrl: result.redirectUrl,
        state: oauthState,
      },
      200,
    );
  });

  // POST /api/v1/integrations/{integrationId}/refresh
  app.openapi(refreshIntegrationRoute, async (c) => {
    const userId = c.get("userId");
    const { integrationId } = c.req.valid("param");
    const { state } = c.req.valid("json");

    const [integration] = await db
      .select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.id, integrationId),
          eq(userIntegrations.userId, userId),
        ),
      )
      .limit(1);

    if (!integration) {
      return c.json({ message: "Integration not found" }, 404);
    }

    const [toolkit] = await db
      .select()
      .from(supportedToolkits)
      .where(eq(supportedToolkits.slug, integration.toolkitSlug))
      .limit(1);

    if (toolkit && toolkit.authScheme !== "oauth2") {
      return c.json(
        { message: "Refresh is only available for OAuth2 integrations" },
        400,
      );
    }

    // CSRF state verification
    if (!integration.oauthState || integration.oauthState !== state) {
      return c.json({ message: "Invalid or expired state token" }, 403);
    }

    const composioStatus = await checkOAuthStatus(
      userId,
      integration.toolkitSlug,
    );
    const now = new Date().toISOString();
    const toolkitInfo = toolkit
      ? buildToolkitInfo(toolkit)
      : buildFallbackToolkitInfo(integration.toolkitSlug);

    if (composioStatus.status === "ACTIVE") {
      await db
        .update(userIntegrations)
        .set({
          status: "active",
          composioAccountId: composioStatus.connectedAccountId ?? null,
          connectedAt: now,
          oauthState: null,
          updatedAt: now,
        })
        .where(eq(userIntegrations.id, integrationId));

      return c.json(
        {
          id: integrationId,
          toolkit: toolkitInfo,
          status: "active" as const,
          connectedAt: now,
        },
        200,
      );
    }

    return c.json(
      {
        id: integrationId,
        toolkit: toolkitInfo,
        status: "initiated" as const,
      },
      200,
    );
  });

  // DELETE /api/v1/integrations/{integrationId}
  app.openapi(deleteIntegrationRoute, async (c) => {
    const userId = c.get("userId");
    const { integrationId } = c.req.valid("param");

    const [integration] = await db
      .select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.id, integrationId),
          eq(userIntegrations.userId, userId),
        ),
      )
      .limit(1);

    if (!integration) {
      return c.json({ message: "Integration not found" }, 404);
    }

    const [toolkit] = await db
      .select()
      .from(supportedToolkits)
      .where(eq(supportedToolkits.slug, integration.toolkitSlug))
      .limit(1);

    if (toolkit?.authScheme === "api_key_global") {
      return c.json(
        { message: "Cannot disconnect admin-managed integrations" },
        403,
      );
    }

    const now = new Date().toISOString();

    if (toolkit?.authScheme === "oauth2" && integration.composioAccountId) {
      await revokeConnection(integration.composioAccountId);
    }

    if (toolkit?.authScheme === "api_key_user") {
      await db
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, integrationId));
    }

    await db
      .update(userIntegrations)
      .set({
        status: "disconnected",
        disconnectedAt: now,
        composioAccountId: null,
        oauthState: null,
        updatedAt: now,
      })
      .where(eq(userIntegrations.id, integrationId));

    const toolkitInfo = toolkit
      ? buildToolkitInfo(toolkit)
      : buildFallbackToolkitInfo(integration.toolkitSlug);

    return c.json(
      {
        id: integrationId,
        toolkit: toolkitInfo,
        status: "disconnected" as const,
        disconnectedAt: now,
      },
      200,
    );
  });
}
