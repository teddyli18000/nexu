import path from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import type { ControllerContainer } from "../src/app/container.js";
import type { ControllerEnv } from "../src/app/env.js";
import { registerDesktopRoutes } from "../src/routes/desktop-routes.js";
import { createRuntimeState } from "../src/runtime/state.js";
import type { ControllerBindings } from "../src/types.js";

function createEnv(rootDir: string): ControllerEnv {
  return {
    nodeEnv: "test",
    port: 3010,
    host: "127.0.0.1",
    webUrl: "http://localhost:5173",
    nexuHomeDir: path.join(rootDir, ".nexu"),
    nexuConfigPath: path.join(rootDir, ".nexu", "config.json"),
    artifactsIndexPath: path.join(rootDir, ".nexu", "artifacts", "index.json"),
    compiledOpenclawSnapshotPath: path.join(
      rootDir,
      ".nexu",
      "compiled-openclaw.json",
    ),
    openclawStateDir: path.join(rootDir, ".openclaw"),
    openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
    openclawSkillsDir: path.join(rootDir, ".openclaw", "skills"),
    openclawExtensionsDir: path.join(rootDir, ".openclaw", "extensions"),
    runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
    openclawCuratedSkillsDir: path.join(rootDir, ".openclaw", "bundled-skills"),
    openclawRuntimeModelStatePath: path.join(
      rootDir,
      ".openclaw",
      "nexu-runtime-model.json",
    ),
    skillhubCacheDir: path.join(rootDir, ".nexu", "skillhub-cache"),
    skillDbPath: path.join(rootDir, ".nexu", "skill-ledger.json"),
    analyticsStatePath: path.join(rootDir, ".nexu", "analytics-state.json"),
    staticSkillsDir: undefined,
    platformTemplatesDir: undefined,
    openclawWorkspaceTemplatesDir: path.join(
      rootDir,
      ".openclaw",
      "workspace-templates",
    ),
    openclawBin: "openclaw",
    litellmBaseUrl: null,
    litellmApiKey: null,
    openclawGatewayPort: 18789,
    openclawGatewayToken: undefined,
    manageOpenclawProcess: false,
    gatewayProbeEnabled: false,
    runtimeSyncIntervalMs: 2000,
    runtimeHealthIntervalMs: 5000,
    defaultModelId: "anthropic/claude-sonnet-4",
    posthogApiKey: undefined,
    posthogHost: undefined,
  };
}

function createTestContainer(rootDir: string): ControllerContainer {
  return {
    env: createEnv(rootDir),
    configStore: {
      listBots: vi.fn(async () => []),
      getStoredDesktopLocale: vi.fn(async () => "en"),
      setDesktopLocale: vi.fn(async () => "en"),
      getDesktopLocale: vi.fn(async () => "en"),
      getConfig: vi.fn(async () => ({ channels: [] })),
    } as unknown as ControllerContainer["configStore"],
    gatewayClient: {} as ControllerContainer["gatewayClient"],
    runtimeHealth: {
      probe: vi.fn(async () => ({ ok: true, status: 200 })),
    } as unknown as ControllerContainer["runtimeHealth"],
    openclawProcess: {} as ControllerContainer["openclawProcess"],
    agentService: {} as ControllerContainer["agentService"],
    channelService: {} as ControllerContainer["channelService"],
    channelFallbackService: {
      listRecentEvents: vi.fn(() => []),
      stop: vi.fn(),
    } as unknown as ControllerContainer["channelFallbackService"],
    sessionService: {} as ControllerContainer["sessionService"],
    runtimeConfigService: {} as ControllerContainer["runtimeConfigService"],
    runtimeModelStateService:
      {} as ControllerContainer["runtimeModelStateService"],
    modelProviderService: {} as ControllerContainer["modelProviderService"],
    integrationService: {} as ControllerContainer["integrationService"],
    localUserService: {} as ControllerContainer["localUserService"],
    desktopLocalService: {} as ControllerContainer["desktopLocalService"],
    analyticsService: {} as ControllerContainer["analyticsService"],
    artifactService: {} as ControllerContainer["artifactService"],
    templateService: {} as ControllerContainer["templateService"],
    skillhubService: {
      start: vi.fn(),
      dispose: vi.fn(),
    } as unknown as ControllerContainer["skillhubService"],
    openclawSyncService: {
      syncAll: vi.fn(async () => {}),
    } as unknown as ControllerContainer["openclawSyncService"],
    openclawAuthService: {
      dispose: vi.fn(),
    } as unknown as ControllerContainer["openclawAuthService"],
    quotaFallbackService: {} as ControllerContainer["quotaFallbackService"],
    githubStarVerificationService:
      {} as ControllerContainer["githubStarVerificationService"],
    wsClient: {
      stop: vi.fn(),
    } as unknown as ControllerContainer["wsClient"],
    gatewayService: {
      sendChannelMessage: vi.fn(async () => ({
        runId: "run_123",
        messageId: "msg_456",
        channel: "feishu",
        chatId: "user:ou_test_user",
      })),
    } as unknown as ControllerContainer["gatewayService"],
    runtimeState: createRuntimeState(),
    startBackgroundLoops: () => () => {},
  };
}

describe("desktop routes", () => {
  it("sends LibTV notifications through the gateway with validated input", async () => {
    const container = createTestContainer("/tmp/nexu-desktop-routes");
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRoutes(app, container);

    const response = await app.request("/api/internal/libtv-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "feishu",
        to: "user:ou_test_user",
        accountId: "acct_1",
        threadId: "om_thread_1",
        sessionKey: "agent:bot-1:direct:ou_test_user",
        idempotencyKey: "libtv:test:session_123:progress:1",
        kind: "progress",
        sessionId: "session_123",
        projectUuid: "project_456",
        message: "Your video is still generating.",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: {
        runId: "run_123",
        messageId: "msg_456",
      },
    });
    expect(container.gatewayService.sendChannelMessage).toHaveBeenCalledWith({
      channel: "feishu",
      to: "user:ou_test_user",
      accountId: "acct_1",
      threadId: "om_thread_1",
      sessionKey: "agent:bot-1:direct:ou_test_user",
      idempotencyKey: "libtv:test:session_123:progress:1",
      message: "Your video is still generating.",
    });
  });

  it("rejects LibTV notifications that omit the idempotency key", async () => {
    const container = createTestContainer("/tmp/nexu-desktop-routes");
    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRoutes(app, container);

    const response = await app.request("/api/internal/libtv-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "feishu",
        to: "user:ou_test_user",
        sessionKey: "agent:bot-1:direct:ou_test_user",
        kind: "progress",
        sessionId: "session_123",
        projectUuid: "project_456",
        message: "Your video is still generating.",
      }),
    });

    expect(response.status).toBe(400);
    expect(container.gatewayService.sendChannelMessage).not.toHaveBeenCalled();
  });
});
