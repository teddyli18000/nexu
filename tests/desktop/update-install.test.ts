/**
 * Update Install (quitAndInstall) tests for lifecycle-hook delegation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAutoUpdater = {
  autoDownload: false,
  autoInstallOnAppQuit: true,
  forceDevUpdateConfig: false,
  on: vi.fn(),
  setFeedURL: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
};

vi.mock("electron-updater", () => ({
  autoUpdater: mockAutoUpdater,
}));

const mockApp = {
  isPackaged: true,
  getVersion: vi.fn(() => "0.2.0"),
  __nexuForceQuit: false as unknown,
};

vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: vi.fn(),
  webContents: { getAllWebContents: vi.fn(() => []) },
}));

vi.mock("../../apps/desktop/main/runtime/runtime-logger", () => ({
  writeDesktopMainLog: vi.fn(),
}));

vi.mock("../../apps/desktop/main/updater/component-updater", () => ({
  R2_BASE_URL: "https://desktop-releases.nexu.io",
}));

function createMockOrchestrator() {
  return {
    dispose: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: 1,
      send: vi.fn(),
    },
  };
}

describe("UpdateManager.quitAndInstall", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApp.__nexuForceQuit = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates quit-and-install to prepareForUpdateInstall hook", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const hook = vi.fn().mockResolvedValue({ handled: true });

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      prepareForUpdateInstall: hook,
    });

    await mgr.quitAndInstall();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        app: mockApp,
        orchestrator,
        logLifecycleStep: expect.any(Function),
      }),
    );
  });

  it("lets the hook own teardown and install ordering", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const callOrder: string[] = [];

    const hook = vi.fn(async ({ app, orchestrator: hookOrchestrator }) => {
      callOrder.push("teardown");
      await hookOrchestrator.dispose();
      callOrder.push("verify");
      (app as Record<string, unknown>).__nexuForceQuit = true;
      mockAutoUpdater.quitAndInstall(false, true);
      callOrder.push("install");
      return { handled: true };
    });

    orchestrator.dispose.mockImplementation(async () => {
      callOrder.push("dispose");
    });

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      prepareForUpdateInstall: hook,
    });

    await mgr.quitAndInstall();

    expect(callOrder).toEqual(["teardown", "dispose", "verify", "install"]);
    expect(mockApp.__nexuForceQuit).toBe(true);
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("leaves periodic timer ownership with the lifecycle hook", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const callOrder: string[] = [];

    const hook = vi.fn(async () => {
      callOrder.push("hook");
      return { handled: true };
    });

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      initialDelayMs: 100,
      prepareForUpdateInstall: hook,
    });

    mgr.startPeriodicCheck();
    const originalStop = mgr.stopPeriodicCheck.bind(mgr);
    mgr.stopPeriodicCheck = () => {
      callOrder.push("stopPeriodic");
      originalStop();
    };

    await mgr.quitAndInstall();

    expect(callOrder).toEqual(["hook"]);
  });

  it("aborts install when no lifecycle hook takes ownership", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
    });

    await mgr.quitAndInstall();

    expect(orchestrator.dispose).not.toHaveBeenCalled();
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(mockApp.__nexuForceQuit).toBe(false);
  });

  it("still aborts install when hook returns handled=false", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const hook = vi.fn().mockResolvedValue({ handled: false });

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      prepareForUpdateInstall: hook,
    });

    await mgr.quitAndInstall();

    expect(hook).toHaveBeenCalledTimes(1);
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
    expect(mockApp.__nexuForceQuit).toBe(false);
  });

  it("propagates hook failures", async () => {
    const orchestrator = createMockOrchestrator();
    const win = createMockWindow();
    const hook = vi.fn().mockRejectedValue(new Error("pgrep exploded"));

    const { UpdateManager } = await import(
      "../../apps/desktop/main/updater/update-manager"
    );

    const mgr = new UpdateManager(win as never, orchestrator as never, {
      channel: "stable",
      feedUrl: null,
      prepareForUpdateInstall: hook,
    });

    await expect(mgr.quitAndInstall()).rejects.toThrow("pgrep exploded");
  });
});
