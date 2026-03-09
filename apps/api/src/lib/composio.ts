import { Composio } from "@composio/core";
import { HTTPException } from "hono/http-exception";

let composioClient: Composio | null = null;

function getClient(): Composio {
  if (!composioClient) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new HTTPException(500, {
        message: "Integration service not configured",
      });
    }
    composioClient = new Composio({ apiKey });
  }
  return composioClient;
}

export async function initializeOAuthConnection(
  toolkitSlug: string,
  nexuUserId: string,
  oauthState: string,
  options?: { source?: string; returnTo?: string },
): Promise<{ redirectUrl: string; connectedAccountId?: string }> {
  try {
    const client = getClient();
    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
    const callbackParams = new URLSearchParams({
      toolkit: toolkitSlug,
      state: oauthState,
    });
    if (options?.source) callbackParams.set("source", options.source);
    if (options?.returnTo) callbackParams.set("returnTo", options.returnTo);

    const callbackUrl = `${webUrl}/workspace/integrations?${callbackParams.toString()}`;

    const session = await client.create(`nexu_${nexuUserId}`, {
      manageConnections: false,
    });

    const connectionRequest = await session.authorize(toolkitSlug, {
      callbackUrl,
    });

    return {
      redirectUrl: connectionRequest.redirectUrl as string,
    };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(502, {
      message: "Failed to initialize connection with provider",
    });
  }
}

export async function checkOAuthStatus(
  nexuUserId: string,
  toolkitSlug: string,
): Promise<{ status: string; connectedAccountId?: string }> {
  try {
    const client = getClient();
    const session = await client.create(`nexu_${nexuUserId}`, {
      manageConnections: false,
    });
    const toolkits = await session.toolkits();
    const matched = toolkits.items.find(
      (t: { slug: string }) => t.slug === toolkitSlug,
    );
    if (!matched) {
      return { status: "PENDING" };
    }
    const connectedAccount = (
      matched as { connection?: { connectedAccount?: { id?: string } } }
    ).connection?.connectedAccount;
    if (connectedAccount?.id) {
      return { status: "ACTIVE", connectedAccountId: connectedAccount.id };
    }
    return { status: "PENDING" };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(502, {
      message: "Failed to check provider connection status",
    });
  }
}

export async function revokeConnection(
  _composioAccountId: string,
): Promise<void> {
  // Composio SDK revocation — clear local state; Composio tokens expire naturally
}

export function maskCredential(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 4) return value;
  if (value.length < 8) {
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }
  return `${value.slice(0, 4)}..${value.slice(-4)}`;
}

export function validateCredentialFields(
  authFields: Array<{ key: string; label: string; type: string }>,
  credentials: Record<string, string>,
): void {
  const requiredKeys = new Set(authFields.map((f) => f.key));
  const providedKeys = new Set(Object.keys(credentials));

  for (const field of authFields) {
    if (!providedKeys.has(field.key)) {
      throw new HTTPException(400, {
        message: `Missing required field: ${field.key}`,
      });
    }
    const fieldValue = credentials[field.key];
    if (!fieldValue || fieldValue.trim() === "") {
      throw new HTTPException(400, {
        message: `Field cannot be empty: ${field.key}`,
      });
    }
  }

  for (const key of providedKeys) {
    if (!requiredKeys.has(key)) {
      throw new HTTPException(400, {
        message: `Unknown field: ${key}`,
      });
    }
  }
}
