import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceError } from "./error.js";

const CLAIM_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const CLAIM_TOKEN_VERSION = 1;

type ClaimTokenPayload = {
  v: number;
  slackTeamId: string;
  slackUserId: string;
  exp: number;
};

export type ClaimTokenVerificationResult = {
  valid: boolean;
  expired: boolean;
  used: boolean;
  slackTeamId: string | null;
  slackUserId: string | null;
};

function getClaimTokenSecret(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw ServiceError.from("claim-token", {
      code: "encryption_key_missing",
    });
  }

  const asHex = Buffer.from(key, "hex");
  if (asHex.length === 32) {
    return asHex;
  }

  return Buffer.from(key, "utf8");
}

function createSignature(payloadEncoded: string): string {
  const secret = getClaimTokenSecret();
  return createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64url");
}

export function generateClaimToken(input: {
  slackTeamId: string;
  slackUserId: string;
}): string {
  const payload: ClaimTokenPayload = {
    v: CLAIM_TOKEN_VERSION,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
    exp: Math.floor(Date.now() / 1000) + CLAIM_TOKEN_TTL_SECONDS,
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = createSignature(payloadEncoded);
  return `${payloadEncoded}.${signature}`;
}

export function verifyClaimToken(token: string): ClaimTokenVerificationResult {
  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) {
    return {
      valid: false,
      expired: false,
      used: false,
      slackTeamId: null,
      slackUserId: null,
    };
  }

  const expectedSignature = createSignature(payloadEncoded);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return {
      valid: false,
      expired: false,
      used: false,
      slackTeamId: null,
      slackUserId: null,
    };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadEncoded, "base64url").toString("utf8"),
    ) as Partial<ClaimTokenPayload>;

    if (
      payload.v !== CLAIM_TOKEN_VERSION ||
      typeof payload.slackTeamId !== "string" ||
      payload.slackTeamId.length === 0 ||
      typeof payload.slackUserId !== "string" ||
      payload.slackUserId.length === 0 ||
      typeof payload.exp !== "number"
    ) {
      return {
        valid: false,
        expired: false,
        used: false,
        slackTeamId: null,
        slackUserId: null,
      };
    }

    const expired = payload.exp < Math.floor(Date.now() / 1000);
    return {
      valid: !expired,
      expired,
      used: false,
      slackTeamId: payload.slackTeamId,
      slackUserId: payload.slackUserId,
    };
  } catch {
    return {
      valid: false,
      expired: false,
      used: false,
      slackTeamId: null,
      slackUserId: null,
    };
  }
}
