import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRuntimeUnitManifests,
  ensurePackagedOpenclawSidecar,
} from "../../apps/desktop/main/runtime/manifests";

const mkdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  mkdirSync: mkdirSyncMock,
}));

vi.mock("../../apps/desktop/shared/workspace-paths", () => ({
  getWorkspaceRoot: vi.fn(() => "/repo"),
}));

vi.mock("../../apps/desktop/shared/desktop-paths", () => ({
  getOpenclawSkillsDir: vi.fn((userDataPath: string) =>
    path.resolve(userDataPath, "runtime/openclaw/state/skills"),
  ),
}));

function createPlatformCapabilities() {
  return {
    platformId: "mac",
    runtimeResidency: "single-process",
    packagedArchive: {
      format: "tar.gz",
      extractionMode: "async",
      supportsAtomicSwap: true,
    },
    resolveRuntimeRoots: vi.fn(),
    sidecarMaterializer: {
      materializePackagedOpenclawSidecar: vi.fn(async ({ runtimeRoot }) =>
        path.resolve(runtimeRoot, "sidecars/openclaw"),
      ),
    },
    runtimeExecutables: {
      resolveSkillNodePath: vi.fn(
        ({ isPackaged, openclawSidecarRoot, inheritedNodePath }) => {
          const bundled = isPackaged
            ? path.resolve(openclawSidecarRoot, "../bundled-node-modules")
            : "/repo/apps/desktop/node_modules";
          return inheritedNodePath
            ? [bundled, inheritedNodePath].join(path.delimiter)
            : bundled;
        },
      ),
      resolveOpenclawNodePath: vi.fn(() => "/custom/bin"),
    },
    portStrategy: { allocateRuntimePorts: vi.fn() },
    stateMigrationPolicy: { run: vi.fn() },
    shutdownCoordinator: { install: vi.fn() },
  };
}

function createRuntimeConfig() {
  return {
    runtimeMode: "internal",
    buildInfo: {
      version: "1.0.0",
      source: "local-dev",
      branch: null,
      commit: null,
      builtAt: null,
    },
    updates: {
      autoUpdateEnabled: false,
      channel: "stable",
    },
    ports: {
      controller: 50800,
      web: 50810,
    },
    urls: {
      controllerBase: "http://127.0.0.1:50800",
      web: "http://127.0.0.1:50810",
      openclawBase: "http://127.0.0.1:18789",
      updateFeed: null,
    },
    tokens: {
      gateway: "gw-secret-token",
    },
    paths: {
      nexuHome: "/Users/testuser/.nexu",
      openclawBin: "/unused/openclaw",
    },
    desktopAuth: {
      name: "Desktop",
      email: "desktop@example.com",
      password: "secret",
    },
    sentryDsn: null,
  } as const;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
}

describe("desktop runtime manifests", () => {
  beforeEach(() => {
    mkdirSyncMock.mockReset();
    mkdirSyncMock.mockImplementation((target: string) => target);
  });

  it("delegates packaged sidecar materialization to platform capabilities", async () => {
    const capabilities = createPlatformCapabilities();

    const result = await ensurePackagedOpenclawSidecar(
      "/Applications/Nexu.app/Contents/Resources/runtime",
      "/Users/testuser/Library/Application Support/@nexu/desktop/runtime",
      capabilities as never,
    );

    expect(normalizePath(result)).toBe(
      "/Users/testuser/Library/Application Support/@nexu/desktop/runtime/sidecars/openclaw",
    );
    expect(
      capabilities.sidecarMaterializer.materializePackagedOpenclawSidecar,
    ).toHaveBeenCalledWith({
      runtimeSidecarBaseRoot:
        "/Applications/Nexu.app/Contents/Resources/runtime",
      runtimeRoot:
        "/Users/testuser/Library/Application Support/@nexu/desktop/runtime",
    });
  });

  it("uses desktop node_modules as NODE_PATH in dev", async () => {
    const capabilities = createPlatformCapabilities();
    const manifests = await createRuntimeUnitManifests(
      "/repo/apps/desktop",
      "/tmp/user-data",
      false,
      createRuntimeConfig(),
      capabilities as never,
    );

    const controller = manifests.find(
      (manifest) => manifest.id === "controller",
    );
    expect(controller?.env?.NODE_PATH).toBe("/repo/apps/desktop/node_modules");
  });

  it("uses packaged sidecar roots and bundled NODE_PATH in dist mode", async () => {
    const capabilities = createPlatformCapabilities();
    const manifests = await createRuntimeUnitManifests(
      "/Applications/Nexu.app/Contents/Resources",
      "/Users/testuser/Library/Application Support/@nexu/desktop",
      true,
      createRuntimeConfig(),
      capabilities as never,
    );

    const controller = manifests.find(
      (manifest) => manifest.id === "controller",
    );
    expect(normalizePath(controller?.cwd ?? "")).toBe(
      "/Applications/Nexu.app/Contents/Resources/runtime/controller",
    );
    expect(normalizePath(controller?.env?.NODE_PATH ?? "")).toBe(
      "/Users/testuser/Library/Application Support/@nexu/desktop/runtime/sidecars/bundled-node-modules",
    );
  });

  it("preserves inherited NODE_PATH entries through runtime executable resolver", async () => {
    const capabilities = createPlatformCapabilities();
    capabilities.runtimeExecutables.resolveSkillNodePath.mockImplementation(
      ({ inheritedNodePath }) =>
        ["/repo/apps/desktop/node_modules", inheritedNodePath]
          .filter(Boolean)
          .join(path.delimiter),
    );

    const manifests = await createRuntimeUnitManifests(
      "/repo/apps/desktop",
      "/tmp/user-data",
      false,
      createRuntimeConfig(),
      capabilities as never,
    );

    const controller = manifests.find(
      (manifest) => manifest.id === "controller",
    );
    expect(controller?.env?.NODE_PATH).toBe("/repo/apps/desktop/node_modules");
  });

  it("wires controller environment to runtime roots and custom PATH", async () => {
    const capabilities = createPlatformCapabilities();
    const manifests = await createRuntimeUnitManifests(
      "/repo/apps/desktop",
      "/tmp/user-data",
      false,
      createRuntimeConfig(),
      capabilities as never,
    );

    const controller = manifests.find(
      (manifest) => manifest.id === "controller",
    );
    expect(normalizePath(controller?.env?.OPENCLAW_STATE_DIR ?? "")).toBe(
      "/tmp/user-data/runtime/openclaw/state",
    );
    expect(normalizePath(controller?.env?.OPENCLAW_CONFIG_PATH ?? "")).toBe(
      "/tmp/user-data/runtime/openclaw/config/openclaw.json",
    );
    expect(controller?.env?.PATH).toBe("/custom/bin");
  });
});
