import { OpenAPIHono } from "@hono/zod-openapi";
import { describe, expect, it, vi } from "vitest";
import { registerDesktopRewardsRoutes } from "../src/routes/desktop-rewards-routes.js";
import type { ControllerBindings } from "../src/types.js";

describe("registerDesktopRewardsRoutes", () => {
  it("auto-falls back to BYOK when managed balance is depleted", async () => {
    const getDesktopRewardsStatus = vi
      .fn()
      .mockResolvedValueOnce({
        viewer: {
          cloudConnected: true,
          activeModelId: "link/gemini-2.5-flash",
          activeModelProviderId: "link",
          usingManagedModel: true,
        },
        progress: {
          claimedCount: 4,
          totalCount: 11,
          earnedCredits: 900,
          availableCredits: 100,
        },
        tasks: [],
        cloudBalance: {
          totalBalance: 0,
          totalRecharged: 900,
          totalConsumed: 900,
        },
      })
      .mockResolvedValueOnce({
        viewer: {
          cloudConnected: true,
          activeModelId: "openai/gpt-4.1",
          activeModelProviderId: "openai",
          usingManagedModel: false,
        },
        progress: {
          claimedCount: 4,
          totalCount: 11,
          earnedCredits: 900,
          availableCredits: 100,
        },
        tasks: [],
        cloudBalance: {
          totalBalance: 0,
          totalRecharged: 900,
          totalConsumed: 900,
        },
      });
    const triggerFallback = vi.fn().mockResolvedValue({
      success: true,
      newModelId: "openai/gpt-4.1",
    });

    const app = new OpenAPIHono<ControllerBindings>();
    registerDesktopRewardsRoutes(app, {
      configStore: {
        getDesktopRewardsStatus,
        claimDesktopReward: vi.fn(),
      },
      quotaFallbackService: {
        triggerFallback,
      },
    } as never);

    const response = await app.request("/api/internal/desktop/rewards");
    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      viewer: { activeModelId: string | null; usingManagedModel: boolean };
    };

    expect(triggerFallback).toHaveBeenCalledTimes(1);
    expect(getDesktopRewardsStatus).toHaveBeenCalledTimes(2);
    expect(payload.viewer.activeModelId).toBe("openai/gpt-4.1");
    expect(payload.viewer.usingManagedModel).toBe(false);
  });
});
