import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchCurrentBalance,
  setCurrentBalance,
} from "../../apps/desktop/src/components/develop-set-balance-dialog";

describe("desktop set balance dialog helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the current balance from the desktop rewards route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        cloudBalance: {
          totalBalance: 1200,
        },
      }),
    } as Response);

    await expect(
      fetchCurrentBalance("https://desktop.local:5173/"),
    ).resolves.toBe(1200);

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "https://desktop.local:5173/api/internal/desktop/rewards",
    );
  });

  it("posts the test balance update to the controller route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        cloudBalance: {
          totalBalance: 1337,
        },
      }),
    } as Response);

    await expect(
      setCurrentBalance("https://desktop.local:5173/", 1337),
    ).resolves.toBe(1337);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "https://desktop.local:5173/api/internal/desktop/rewards/set-balance",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ balance: 1337 }),
    });
  });

  it("surfaces the controller error message when balance update fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({
        message:
          "idempotencyKey is already bound to a different credit adjustment",
      }),
    } as Response);

    await expect(
      setCurrentBalance("https://desktop.local:5173/", 1337),
    ).rejects.toThrow(
      "idempotencyKey is already bound to a different credit adjustment",
    );
  });
});
