/**
 * OpenClaw Gateway Service
 *
 * High-level business API for communicating with the OpenClaw Gateway via
 * WebSocket RPC. Wraps the low-level OpenClawWsClient to provide:
 *
 * - Config push (config.apply with optimistic concurrency)
 * - Channel status query (channels.status)
 * - Single-channel readiness check
 */

import { createHash } from "node:crypto";
import type { OpenClawConfig } from "@nexu/shared";
import { logger } from "../lib/logger.js";
import type { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";

// ---------------------------------------------------------------------------
// Public types — channel status & readiness
// ---------------------------------------------------------------------------

/** Snapshot of a single channel account as returned by channels.status RPC. */
export interface ChannelAccountSnapshot {
  accountId: string;
  connected?: boolean;
  running?: boolean;
  configured?: boolean;
  enabled?: boolean;
  lastError?: string | null;
  probe?: { ok?: boolean };
}

/** Result of channels.status RPC. */
export interface ChannelsStatusResult {
  channelOrder: string[];
  channelAccounts: Record<string, ChannelAccountSnapshot[]>;
}

/** Readiness info for a single channel, used by the readiness endpoint. */
export interface ChannelReadiness {
  ready: boolean;
  connected: boolean;
  running: boolean;
  configured: boolean;
  lastError: string | null;
  gatewayConnected: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OpenClawGatewayService {
  /** SHA-256 hash of the last config we successfully pushed. */
  private lastPushedConfigHash: string | null = null;

  constructor(private readonly wsClient: OpenClawWsClient) {}

  /** Whether the WS client has completed handshake and is ready for RPC. */
  isConnected(): boolean {
    return this.wsClient.isConnected();
  }

  /**
   * Push a full configuration to OpenClaw.
   *
   * Flow:
   * 1. Call `config.get` to obtain the current config hash (optimistic concurrency)
   * 2. Call `config.apply` with `baseHash` to push the new configuration
   * 3. OpenClaw validates -> persists to openclaw.json -> SIGUSR1 hot-reload
   *
   * Returns true if the config was actually pushed (skips if unchanged).
   * @throws If the WS is not connected or the RPC fails
   */
  async pushConfig(config: OpenClawConfig): Promise<boolean> {
    const hash = this.configHash(config);

    // Skip redundant pushes to avoid push -> restart -> reconnect -> push loop
    if (hash === this.lastPushedConfigHash) {
      logger.info({}, "openclaw_push_skipped_unchanged");
      return false;
    }

    // config.apply requires baseHash for optimistic concurrency control.
    const current = await this.wsClient.request<{ hash?: string }>(
      "config.get",
    );
    const baseHash = current?.hash;

    await this.wsClient.request("config.apply", {
      raw: JSON.stringify(config, null, 2),
      note: "pushed from nexu-controller",
      ...(baseHash ? { baseHash } : {}),
    });

    this.lastPushedConfigHash = hash;
    logger.info({}, "openclaw_config_pushed");
    return true;
  }

  /**
   * Query the runtime status snapshot of all channels.
   * When probe=true, real-time probes are triggered (e.g. Feishu bot-info validation).
   */
  async getChannelsStatus(): Promise<ChannelsStatusResult> {
    return this.wsClient.request<ChannelsStatusResult>("channels.status", {
      probe: true,
      timeoutMs: 8000,
    });
  }

  /**
   * Query the readiness state of a single channel.
   *
   * Readiness logic:
   * - WebSocket-based channels (Slack/Discord): connected === true
   * - Webhook-based channels (Feishu): running && configured && probe.ok
   *
   * Returns gatewayConnected: false when WS is not connected (graceful degradation).
   */
  async getChannelReadiness(
    channelType: string,
    accountId: string,
  ): Promise<ChannelReadiness> {
    if (!this.wsClient.isConnected()) {
      return {
        ready: false,
        connected: false,
        running: false,
        configured: false,
        lastError: null,
        gatewayConnected: false,
      };
    }

    try {
      const status = await this.getChannelsStatus();
      const accounts = status.channelAccounts?.[channelType] ?? [];
      const snapshot = accounts.find((a) => a.accountId === accountId);

      if (!snapshot) {
        // Channel not yet visible to OpenClaw (config not yet loaded)
        return {
          ready: false,
          connected: false,
          running: false,
          configured: false,
          lastError: null,
          gatewayConnected: true,
        };
      }

      // WebSocket-based channels (Slack, Discord): connected === true
      // Webhook-based channels (Feishu): running && configured && probe.ok
      const isConnected = snapshot.connected === true;
      const isWebhookReady =
        snapshot.running === true &&
        snapshot.configured === true &&
        snapshot.probe?.ok === true;
      const ready = isConnected || isWebhookReady;

      return {
        ready,
        connected: snapshot.connected ?? false,
        running: snapshot.running ?? false,
        configured: snapshot.configured ?? false,
        lastError: snapshot.lastError ?? null,
        gatewayConnected: true,
      };
    } catch (err) {
      logger.warn(
        {
          channelType,
          accountId,
          error: err instanceof Error ? err.message : String(err),
        },
        "openclaw_channel_readiness_error",
      );
      return {
        ready: false,
        connected: false,
        running: false,
        configured: false,
        lastError: null,
        gatewayConnected: false,
      };
    }
  }

  private configHash(config: OpenClawConfig): string {
    return createHash("sha256").update(JSON.stringify(config)).digest("hex");
  }
}
