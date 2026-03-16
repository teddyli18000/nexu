import { describe, expect, it } from "vitest";
import {
  normalizeDesktopRendererUrl,
  resolveDesktopRendererUrl,
} from "#desktop/shared/renderer-url";

describe("normalizeDesktopRendererUrl", () => {
  it("removes trailing slashes so Electron reloads a stable origin", () => {
    expect(normalizeDesktopRendererUrl("http://127.0.0.1:50810/")).toBe(
      "http://127.0.0.1:50810",
    );
  });

  it("preserves the existing origin when no trailing slash is present", () => {
    expect(normalizeDesktopRendererUrl("http://127.0.0.1:50810")).toBe(
      "http://127.0.0.1:50810",
    );
  });
});

describe("resolveDesktopRendererUrl", () => {
  it("defaults to the managed web sidecar origin", () => {
    expect(resolveDesktopRendererUrl({})).toBe("http://127.0.0.1:50810");
  });

  it("uses the configured desktop web origin", () => {
    expect(
      resolveDesktopRendererUrl({
        NEXU_WEB_URL: "http://127.0.0.1:50999/",
      }),
    ).toBe("http://127.0.0.1:50999");
  });
});
