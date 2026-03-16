import { describe, expect, it, vi } from "vitest";
import { waitForDesktopRendererReady } from "#desktop/shared/renderer-ready";

describe("waitForDesktopRendererReady", () => {
  it("returns when the renderer URL responds successfully", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));

    await expect(
      waitForDesktopRendererReady("http://127.0.0.1:50810", {
        attempts: 1,
        intervalMs: 0,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
  });

  it("retries until the renderer becomes reachable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await expect(
      waitForDesktopRendererReady("http://127.0.0.1:50810", {
        attempts: 2,
        intervalMs: 0,
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws when the renderer never becomes reachable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("connection refused"));

    await expect(
      waitForDesktopRendererReady("http://127.0.0.1:50810", {
        attempts: 2,
        intervalMs: 0,
        fetchImpl,
      }),
    ).rejects.toThrow(
      "Desktop renderer did not become ready at http://127.0.0.1:50810.",
    );
  });
});
