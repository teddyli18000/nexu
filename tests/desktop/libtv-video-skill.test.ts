import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = resolve(
  process.cwd(),
  "apps/desktop/static/bundled-skills/libtv-video/scripts/libtv_video.py",
);

function makeTempDir(): string {
  return mkdtempSync(resolve(tmpdir(), "libtv-video-skill-"));
}

function writeConfig(nexuHome: string): void {
  writeFileSync(
    resolve(nexuHome, "libtv.json"),
    JSON.stringify({ apiKey: "mgk_test_key" }, null, 2),
  );
}

async function runScript(args: string[], env: NodeJS.ProcessEnv) {
  return await new Promise<{
    status: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, rejectPromise) => {
    const child = spawn("python3", [scriptPath, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}

async function withGatewayServer(
  handler: Parameters<typeof createServer>[0],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test gateway server.");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      }),
  };
}

type RecordedRequest = {
  method: string;
  url: string;
  body: Record<string, unknown>;
};

type JsonServerRequest = Parameters<typeof createServer>[0] extends (
  request: infer TRequest,
  response: infer _TResponse,
) => unknown
  ? TRequest
  : never;

type JsonServerResponse = Parameters<typeof createServer>[0] extends (
  request: infer _TRequest,
  response: infer TResponse,
) => unknown
  ? TResponse
  : never;

async function withJsonServer(
  handler: (
    request: JsonServerRequest,
    response: JsonServerResponse,
    body: Record<string, unknown>,
  ) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return await withGatewayServer((request, response) => {
    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      const body =
        rawBody.trim().length > 0
          ? (JSON.parse(rawBody) as Record<string, unknown>)
          : {};
      handler(request, response, body);
    });
  });
}

describe("libtv bundled skill", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    tempDirs.length = 0;
  });

  it("uses the Seedance production gateway by default", () => {
    const source = readFileSync(scriptPath, "utf8");
    expect(source).toContain('GATEWAY_URL = "https://seedance.nexu.io/"');
  });

  it("persists accepted submissions only after a guarded server response", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);
    const createSessionRequests: Array<Record<string, unknown>> = [];

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        let rawBody = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          rawBody += chunk;
        });
        request.on("end", () => {
          createSessionRequests.push(
            JSON.parse(rawBody) as Record<string, unknown>,
          );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              sessionId: "session_123",
              projectUuid: "project_456",
              projectUrl: "https://www.liblib.tv/canvas?projectId=project_456",
            }),
          );
        });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const result = await runScript(
        ["create-session", "make a calm ocean video"],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
          OPENCLAW_CHANNEL_TYPE: "feishu",
          OPENCLAW_CHAT_ID: "ou_test_user",
          OPENCLAW_SESSION_KEY: "agent:bot-1:direct:ou_test_user",
          OPENCLAW_THREAD_ID: "om_thread_1",
          OPENCLAW_ACCOUNT_ID: "acct_1",
        },
      );

      expect(result.status).toBe(0);
      expect(String(createSessionRequests[0]?.message)).toContain(
        "video ratio 16:9",
      );
      const payload = JSON.parse(result.stdout.trim()) as {
        sessions_spawn: { instruction: string };
      };
      expect(payload.sessions_spawn.instruction).toContain("session_123");

      const persisted = JSON.parse(
        readFileSync(resolve(nexuHome, "libtv-sessions.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(persisted).toHaveLength(1);
      expect(persisted[0]).toMatchObject({
        session_id: "session_123",
        project_uuid: "project_456",
        status: "submitted",
        delivery: {
          channel: "feishu",
          to: "user:ou_test_user",
          raw_to: "ou_test_user",
          session_key: "agent:bot-1:direct:ou_test_user",
          thread_id: "om_thread_1",
          account_id: "acct_1",
          idempotency_prefix:
            "libtv:agent:bot-1:direct:ou_test_user:session_123",
        },
      });
      expect(result.stderr).toContain("now generating");
    } finally {
      await gateway.close();
    }
  });

  it("relays an explicitly configured video ratio instead of the default", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeFileSync(
      resolve(nexuHome, "libtv.json"),
      JSON.stringify({ apiKey: "mgk_test_key", videoRatio: "9:16" }, null, 2),
    );
    const createSessionRequests: Array<Record<string, unknown>> = [];

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        let rawBody = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => {
          rawBody += chunk;
        });
        request.on("end", () => {
          createSessionRequests.push(
            JSON.parse(rawBody) as Record<string, unknown>,
          );
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              sessionId: "session_ratio_123",
              projectUuid: "project_ratio_456",
            }),
          );
        });
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const result = await runScript(
        ["create-session", "make a portrait dance video"],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
        },
      );

      expect(result.status).toBe(0);
      expect(String(createSessionRequests[0]?.message)).toContain(
        "video ratio 9:16",
      );
      expect(String(createSessionRequests[0]?.message)).not.toContain(
        "video ratio 16:9",
      );
    } finally {
      await gateway.close();
    }
  });

  it("sends the submit notification through the controller and persists notification bookkeeping", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);

    const notificationRequests: RecordedRequest[] = [];
    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            sessionId: "session_notify_123",
            projectUuid: "project_notify_456",
          }),
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });
    const controller = await withJsonServer((request, response, body) => {
      notificationRequests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        body,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, delivered: true }));
    });

    try {
      const result = await runScript(
        ["create-session", "make a calm ocean video"],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
          NEXU_CONTROLLER_URL: controller.baseUrl,
          OPENCLAW_CHANNEL_TYPE: "feishu",
          OPENCLAW_CHAT_ID: "ou_test_user",
          OPENCLAW_SESSION_KEY: "agent:bot-1:direct:ou_test_user",
          OPENCLAW_THREAD_ID: "om_thread_1",
          OPENCLAW_ACCOUNT_ID: "acct_1",
        },
      );

      expect(result.status).toBe(0);
      expect(notificationRequests).toHaveLength(1);
      expect(notificationRequests[0]).toMatchObject({
        method: "POST",
        url: "/api/internal/libtv-notify",
        body: {
          channel: "feishu",
          to: "user:ou_test_user",
          accountId: "acct_1",
          threadId: "om_thread_1",
          sessionKey: "agent:bot-1:direct:ou_test_user",
          kind: "submitted",
          sessionId: "session_notify_123",
          projectUuid: "project_notify_456",
        },
      });
      expect(String(notificationRequests[0]?.body.idempotencyKey)).toContain(
        "submitted",
      );

      const persisted = JSON.parse(
        readFileSync(resolve(nexuHome, "libtv-sessions.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(persisted[0]?.notifications).toMatchObject({
        progress_count: 0,
        last_terminal_kind: "",
      });
      expect(persisted[0]?.notifications).toHaveProperty("submitted_sent_at");
    } finally {
      await controller.close();
      await gateway.close();
    }
  });

  it("sends heartbeat progress updates at the configured interval and a terminal success notification", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);

    let pollCount = 0;
    const notificationRequests: RecordedRequest[] = [];
    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session/manual_session_001") {
        pollCount += 1;
        response.writeHead(200, { "Content-Type": "application/json" });
        if (pollCount < 3) {
          response.end(JSON.stringify({ messages: [] }));
          return;
        }
        response.end(
          JSON.stringify({
            messages: [
              {
                role: "assistant",
                content:
                  "Final result https://libtv-res.liblib.art/sd-gen-save-img/final.mp4",
              },
            ],
          }),
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });
    const controller = await withJsonServer((request, response, body) => {
      notificationRequests.push({
        method: request.method ?? "",
        url: request.url ?? "",
        body,
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true, delivered: true }));
    });

    writeFileSync(
      resolve(nexuHome, "libtv-sessions.json"),
      JSON.stringify(
        [
          {
            session_id: "manual_session_001",
            project_uuid: "manual_project_001",
            status: "submitted",
            submitted_text: "manual smoke prompt",
            created_at: "2026-04-09T00:00:00",
            updated_at: "2026-04-09T00:00:00",
            delivery: {
              channel: "feishu",
              to: "user:ou_test_user",
              raw_to: "ou_test_user",
              session_key: "agent:bot-1:direct:ou_test_user",
              thread_id: "om_thread_1",
              account_id: "acct_1",
              idempotency_prefix:
                "libtv:agent:bot-1:direct:ou_test_user:manual_session_001",
            },
            notifications: {
              submitted_sent_at: "2026-04-09T00:00:00",
              last_progress_sent_at: "",
              progress_count: 0,
              terminal_sent_at: "",
              last_terminal_kind: "",
            },
          },
        ],
        null,
        2,
      ),
    );

    try {
      const result = await runScript(
        [
          "wait-and-deliver",
          "--session-id",
          "manual_session_001",
          "--project-id",
          "manual_project_001",
        ],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
          NEXU_CONTROLLER_URL: controller.baseUrl,
          LIBTV_POLL_INTERVAL_SECONDS: "1",
          LIBTV_PROGRESS_NOTIFY_INTERVAL_SECONDS: "1",
          LIBTV_MAX_POLLS: "4",
        },
      );

      expect(result.status).toBe(0);
      expect(notificationRequests).toHaveLength(2);
      expect(notificationRequests[0]?.body).toMatchObject({
        kind: "progress",
        sessionId: "manual_session_001",
        projectUuid: "manual_project_001",
      });
      expect(notificationRequests[1]?.body).toMatchObject({
        kind: "success",
        sessionId: "manual_session_001",
        projectUuid: "manual_project_001",
      });
      expect(String(notificationRequests[1]?.body.message)).toContain(
        "https://libtv-res.liblib.art/sd-gen-save-img/final.mp4",
      );

      const persisted = JSON.parse(
        readFileSync(resolve(nexuHome, "libtv-sessions.json"), "utf8"),
      ) as Array<Record<string, unknown>>;
      expect(persisted[0]).toMatchObject({
        status: "completed",
        result_urls: ["https://libtv-res.liblib.art/sd-gen-save-img/final.mp4"],
      });
      expect(persisted[0]?.notifications).toMatchObject({
        progress_count: 1,
        last_terminal_kind: "success",
      });
      expect(persisted[0]?.notifications).toHaveProperty(
        "last_progress_sent_at",
      );
      expect(persisted[0]?.notifications).toHaveProperty("terminal_sent_at");
    } finally {
      await controller.close();
      await gateway.close();
    }
  });

  it("rejects malformed submit responses that omit projectUuid", async () => {
    const nexuHome = makeTempDir();
    tempDirs.push(nexuHome);
    writeConfig(nexuHome);

    const gateway = await withGatewayServer((request, response) => {
      if (request.url === "/libtv/v1/session" && request.method === "POST") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            sessionId: "session_123",
          }),
        );
        return;
      }

      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { user_message: "not found" } }));
    });

    try {
      const result = await runScript(
        ["create-session", "make a city at night"],
        {
          ...process.env,
          NEXU_HOME: nexuHome,
          LIBTV_GATEWAY_URL: gateway.baseUrl,
        },
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain("projectUuid");
    } finally {
      await gateway.close();
    }
  });
});
