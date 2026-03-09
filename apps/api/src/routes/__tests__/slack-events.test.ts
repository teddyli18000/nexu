import { describe, expect, it } from "vitest";
import { buildSlackSessionKey } from "../slack-events.js";

describe("buildSlackSessionKey", () => {
  it("builds canonical channel session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "C0AJKG60H6D",
        isIm: false,
      }),
    ).toBe("agent:bot-test-1:slack:channel:c0ajkg60h6d");
  });

  it("builds canonical channel thread session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "C0AJKG60H6D",
        threadTs: "1770408518.451689",
        isIm: false,
      }),
    ).toBe(
      "agent:bot-test-1:slack:channel:c0ajkg60h6d:thread:1770408518.451689",
    );
  });

  it("builds canonical direct message session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "D0AJKG60H6D",
        slackUserId: "U09ZZZ1",
        isIm: true,
      }),
    ).toBe("agent:bot-test-1:slack:direct:u09zzz1");
  });

  it("appends thread ids to direct message session keys", () => {
    expect(
      buildSlackSessionKey({
        botId: "Bot-Test-1",
        channelId: "D0AJKG60H6D",
        slackUserId: "U09ZZZ1",
        threadTs: "1770408518.451689",
        isIm: true,
      }),
    ).toBe("agent:bot-test-1:slack:direct:u09zzz1:thread:1770408518.451689");
  });
});
