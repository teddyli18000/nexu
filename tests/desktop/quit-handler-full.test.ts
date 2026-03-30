/**
 * Quit handler tests for packaged and dev flows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDeleteRuntimePorts = vi.fn().mockResolvedValue(undefined);

vi.mock("../../apps/desktop/main/services/launchd-bootstrap", () => ({
  deleteRuntimePorts: mockDeleteRuntimePorts,
}));

const mockApp = {
  isPackaged: true,
  getLocale: vi.fn(() => "en-US"),
  exit: vi.fn(),
  on: vi.fn(),
  __nexuForceQuit: false as unknown,
};

const mockDialog = {
  showMessageBox: vi.fn().mockResolvedValue({ response: 0 }),
};

const mockGetAllWindows = vi.fn(() => [mockWindow]);

const closeHandlers: Array<(event: { preventDefault: () => void }) => void> =
  [];
const mockWindow = {
  on: vi.fn(
    (event: string, handler: (e: { preventDefault: () => void }) => void) => {
      if (event === "close") closeHandlers.push(handler);
    },
  ),
  hide: vi.fn(),
  isVisible: vi.fn(() => true),
  show: vi.fn(),
  close: vi.fn(),
};

vi.mock("electron", () => ({
  app: mockApp,
  dialog: mockDialog,
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
}));

function createQuitOpts(overrides?: Record<string, unknown>) {
  return {
    launchd: {
      bootoutService: vi.fn().mockResolvedValue(undefined),
      waitForExit: vi.fn().mockResolvedValue(undefined),
    } as never,
    labels: { controller: "io.nexu.controller", openclaw: "io.nexu.openclaw" },
    plistDir: "/tmp/test-plist",
    webServer: {
      close: vi.fn().mockResolvedValue(undefined),
      port: 50810,
    },
    onBeforeQuit: vi.fn().mockResolvedValue(undefined),
    onForceQuit: vi.fn(),
    ...overrides,
  };
}

function simulateClose() {
  const event = { preventDefault: vi.fn() };
  const handler = closeHandlers[closeHandlers.length - 1];
  if (!handler) throw new Error("No close handler registered");
  handler(event);
  return event;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getBeforeQuitHandler(): (event: {
  preventDefault: () => void;
}) => void {
  const call = mockApp.on.mock.calls.find(
    (c: unknown[]) => c[0] === "before-quit",
  );
  if (!call) throw new Error("No before-quit handler registered");
  return call[1] as (event: { preventDefault: () => void }) => void;
}

describe("installLaunchdQuitHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeHandlers.length = 0;
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockApp.__nexuForceQuit = false;
    mockApp.isPackaged = true;
    mockApp.getLocale.mockReturnValue("en-US");
    mockDialog.showMessageBox.mockResolvedValue({ response: 0 });
    mockDeleteRuntimePorts.mockResolvedValue(undefined);
  });

  it("attaches close handler to main window", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    expect(mockWindow.on).toHaveBeenCalledWith("close", expect.any(Function));
    expect(closeHandlers).toHaveLength(1);
  });

  it("shows quit dialog in packaged mode", async () => {
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();
    expect(event.preventDefault).toHaveBeenCalled();

    await flush();
    expect(mockDialog.showMessageBox).toHaveBeenCalledTimes(1);
  });

  it("allows normal close in dev mode", async () => {
    mockApp.isPackaged = false;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();
    expect(event.preventDefault).not.toHaveBeenCalled();

    await flush();
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
    expect(mockApp.exit).not.toHaveBeenCalled();
  });

  it("bypasses dialog when __nexuForceQuit is true", async () => {
    mockApp.__nexuForceQuit = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event = simulateClose();
    expect(event.preventDefault).not.toHaveBeenCalled();
    await flush();
    expect(mockDialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("run-in-background hides window", async () => {
    mockDialog.showMessageBox.mockResolvedValue({ response: 1 });

    const opts = createQuitOpts();
    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(opts as never);
    simulateClose();
    await flush();

    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockDeleteRuntimePorts).not.toHaveBeenCalled();
  });

  it("quit-completely boots out services, deletes runtime ports, and exits", async () => {
    mockDialog.showMessageBox.mockResolvedValue({ response: 0 });

    const opts = createQuitOpts();
    const launchd = opts.launchd as unknown as {
      bootoutService: ReturnType<typeof vi.fn>;
      waitForExit: ReturnType<typeof vi.fn>;
    };

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(opts as never);
    simulateClose();
    await flush();

    expect(opts.onBeforeQuit).toHaveBeenCalledTimes(1);
    expect(opts.webServer.close).toHaveBeenCalledTimes(1);
    expect(launchd.bootoutService).toHaveBeenCalledWith("io.nexu.openclaw");
    expect(launchd.bootoutService).toHaveBeenCalledWith("io.nexu.controller");
    expect(launchd.waitForExit).toHaveBeenCalledWith("io.nexu.openclaw", 5000);
    expect(launchd.waitForExit).toHaveBeenCalledWith(
      "io.nexu.controller",
      5000,
    );
    expect(mockDeleteRuntimePorts).toHaveBeenCalledWith("/tmp/test-plist");
    expect(mockApp.exit).toHaveBeenCalledWith(0);
  });

  it("prevents re-entrant close while dialog is open", async () => {
    let resolveDialog!: (value: { response: number }) => void;
    mockDialog.showMessageBox.mockReturnValue(
      new Promise((resolve) => {
        resolveDialog = resolve;
      }),
    );

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const event1 = simulateClose();
    expect(event1.preventDefault).toHaveBeenCalled();
    await flush();

    const event2 = simulateClose();
    expect(event2.preventDefault).toHaveBeenCalled();
    await flush();

    expect(mockDialog.showMessageBox).toHaveBeenCalledTimes(1);
    resolveDialog({ response: 2 });
    await flush();
  });

  it("before-quit in packaged mode redirects to the window close flow", async () => {
    mockWindow.isVisible.mockReturnValue(false);

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.close).toHaveBeenCalled();
  });

  it("before-quit in dev mode allows quit", async () => {
    mockApp.isPackaged = false;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("before-quit with __nexuForceQuit allows quit", async () => {
    mockApp.__nexuForceQuit = true;

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);

    const handler = getBeforeQuitHandler();
    const event = { preventDefault: vi.fn() };
    handler(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe("getQuitDialogLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeHandlers.length = 0;
    mockGetAllWindows.mockReturnValue([mockWindow]);
    mockApp.__nexuForceQuit = false;
    mockApp.isPackaged = true;
    mockDeleteRuntimePorts.mockResolvedValue(undefined);
  });

  it("uses Chinese locale for zh-CN", async () => {
    mockApp.getLocale.mockReturnValue("zh-CN");
    mockDialog.showMessageBox.mockResolvedValue({ response: 2 });

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);
    simulateClose();
    await flush();

    const dialogCall = mockDialog.showMessageBox.mock.calls[0][0];
    expect(dialogCall.title).toBe("退出 Nexu");
    expect(dialogCall.buttons).toContain("完全退出");
  });

  it("uses English locale for non-zh locale", async () => {
    mockApp.getLocale.mockReturnValue("en-US");
    mockDialog.showMessageBox.mockResolvedValue({ response: 2 });

    const { installLaunchdQuitHandler } = await import(
      "../../apps/desktop/main/services/quit-handler"
    );

    installLaunchdQuitHandler(createQuitOpts() as never);
    simulateClose();
    await flush();

    const dialogCall = mockDialog.showMessageBox.mock.calls[0][0];
    expect(dialogCall.title).toBe("Quit Nexu");
    expect(dialogCall.buttons).toContain("Quit Completely");
  });
});
