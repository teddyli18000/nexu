import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Model } from "@nexu/shared";
import { modelListResponseSchema } from "@nexu/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { modelProviders } from "../db/schema/index.js";
import { encrypt } from "../lib/crypto.js";
import { PLATFORM_MODELS } from "../lib/models.js";

import type { AppBindings } from "../types.js";

// ── Models API ──────────────────────────────────────────────────

const listModelsRoute = createRoute({
  method: "get",
  path: "/api/v1/models",
  tags: ["Models"],
  responses: {
    200: {
      content: {
        "application/json": { schema: modelListResponseSchema },
      },
      description: "Available models",
    },
  },
});

/**
 * In desktop mode, load cloud models from credentials file.
 */
function getCloudModels(): Model[] {
  if (process.env.NEXU_DESKTOP_MODE !== "true") return [];

  const stateDir =
    process.env.OPENCLAW_STATE_DIR ?? path.join(process.cwd(), ".nexu-state");
  const credPath = path.join(stateDir, "cloud-credentials.json");
  if (!fs.existsSync(credPath)) return [];

  try {
    const creds = JSON.parse(fs.readFileSync(credPath, "utf-8"));
    if (!Array.isArray(creds.cloudModels)) return [];
    return creds.cloudModels.map(
      (m: { id: string; name: string; provider?: string }) => ({
        id: `link/${m.id}`,
        name: m.name || m.id,
        provider: m.provider ?? "nexu",
        description: "Cloud model via Nexu Link",
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Load BYOK provider models from DB.
 */
async function getByokModels(): Promise<Model[]> {
  try {
    const providers = await db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.enabled, true));
    const models: Model[] = [];
    for (const p of providers) {
      const modelIds: string[] = JSON.parse(p.modelsJson || "[]");
      for (const mid of modelIds) {
        models.push({
          id: `${p.providerId}/${mid}`,
          name: mid,
          provider: p.providerId,
        });
      }
    }
    return models;
  } catch {
    return [];
  }
}

// ── Provider CRUD ───────────────────────────────────────────────

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

function getVerifyUrl(providerId: string, baseUrl?: string | null): string {
  if (baseUrl) return `${baseUrl}/models`;
  const base = PROVIDER_BASE_URLS[providerId];
  if (base) return `${base}/models`;
  return "";
}

export function registerModelRoutes(app: OpenAPIHono<AppBindings>) {
  // List available models (platform + cloud + BYOK)
  app.openapi(listModelsRoute, async (c) => {
    const cloudModels = getCloudModels();
    const byokModels = await getByokModels();
    const models = [...PLATFORM_MODELS, ...cloudModels, ...byokModels];
    return c.json({ models }, 200);
  });

  // List configured BYOK providers
  app.get("/api/v1/providers", async (c) => {
    const providers = await db.select().from(modelProviders);
    const result = providers.map((p) => ({
      id: p.id,
      providerId: p.providerId,
      displayName: p.displayName,
      enabled: p.enabled,
      baseUrl: p.baseUrl,
      hasApiKey: Boolean(p.encryptedApiKey),
      modelsJson: p.modelsJson,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
    return c.json({ providers: result });
  });

  // Create or update a BYOK provider (upsert by providerId)
  app.put("/api/v1/providers/:providerId", async (c) => {
    const { providerId } = c.req.param();
    const body = await c.req.json<{
      apiKey?: string;
      baseUrl?: string | null;
      enabled?: boolean;
      displayName?: string;
      modelsJson?: string;
    }>();

    // Check if provider already exists
    const [existing] = await db
      .select()
      .from(modelProviders)
      .where(eq(modelProviders.providerId, providerId));

    const now = new Date().toISOString();

    if (existing) {
      // Update
      const updates: Record<string, unknown> = { updatedAt: now };
      if (body.apiKey !== undefined)
        updates.encryptedApiKey = encrypt(body.apiKey);
      if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl;
      if (body.enabled !== undefined) updates.enabled = body.enabled;
      if (body.displayName !== undefined) updates.displayName = body.displayName;
      if (body.modelsJson !== undefined) updates.modelsJson = body.modelsJson;

      await db
        .update(modelProviders)
        .set(updates)
        .where(eq(modelProviders.providerId, providerId));

      const [updated] = await db
        .select()
        .from(modelProviders)
        .where(eq(modelProviders.providerId, providerId));

      if (!updated) {
        return c.json({ error: "Provider not found after update" }, 500);
      }

      return c.json({
        provider: {
          id: updated.id,
          providerId: updated.providerId,
          displayName: updated.displayName,
          enabled: updated.enabled,
          baseUrl: updated.baseUrl,
          hasApiKey: Boolean(updated.encryptedApiKey),
          modelsJson: updated.modelsJson,
        },
      });
    }

    // Create
    if (!body.apiKey) {
      return c.json({ error: "apiKey is required for new providers" }, 400);
    }

    const displayName =
      body.displayName ??
      {
        anthropic: "Anthropic",
        openai: "OpenAI",
        google: "Google AI",
        custom: "Custom",
      }[providerId] ??
      providerId;

    const newProvider = {
      id: crypto.randomUUID(),
      providerId,
      displayName,
      encryptedApiKey: encrypt(body.apiKey),
      baseUrl: body.baseUrl ?? null,
      enabled: body.enabled ?? true,
      modelsJson: body.modelsJson ?? "[]",
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(modelProviders).values(newProvider);

    return c.json(
      {
        provider: {
          id: newProvider.id,
          providerId: newProvider.providerId,
          displayName: newProvider.displayName,
          enabled: newProvider.enabled,
          baseUrl: newProvider.baseUrl,
          hasApiKey: true,
          modelsJson: newProvider.modelsJson,
        },
      },
      201,
    );
  });

  // Delete a BYOK provider
  app.delete("/api/v1/providers/:providerId", async (c) => {
    const { providerId } = c.req.param();
    await db
      .delete(modelProviders)
      .where(eq(modelProviders.providerId, providerId));
    return c.json({ ok: true });
  });

  // Verify a provider's API key by calling its models endpoint
  app.post("/api/v1/providers/:providerId/verify", async (c) => {
    const { providerId } = c.req.param();
    const body = await c.req.json<{ apiKey: string; baseUrl?: string }>();

    if (!body.apiKey) {
      return c.json({ error: "apiKey is required" }, 400);
    }

    const verifyUrl = getVerifyUrl(providerId, body.baseUrl);
    if (!verifyUrl) {
      return c.json({ error: "Unknown provider and no baseUrl given" }, 400);
    }

    try {
      // Anthropic uses a different auth header
      const headers: Record<string, string> =
        providerId === "anthropic"
          ? {
              "x-api-key": body.apiKey,
              "anthropic-version": "2023-06-01",
            }
          : { Authorization: `Bearer ${body.apiKey}` };

      const res = await fetch(verifyUrl, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        return c.json({ valid: false, error: `HTTP ${res.status}` });
      }

      const data = (await res.json()) as {
        data?: Array<{ id: string }>;
      };
      const models = Array.isArray(data.data)
        ? data.data.map((m) => m.id)
        : [];

      return c.json({ valid: true, models });
    } catch (err) {
      return c.json({
        valid: false,
        error: err instanceof Error ? err.message : "Request failed",
      });
    }
  });
}
