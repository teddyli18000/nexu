import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPageDeployConfig,
  loadPageDeployJobs,
  queryPageDeployJob,
  recoverPendingPageDeployJobs,
  savePageDeployConfig,
  submitPageDeployJob,
  submitPageDeployTemplateJob,
  waitForPageDeployJob,
} from "../../apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js";

describe("deploy skill core", () => {
  let rootDir = "";

  async function writeLocalNexuConfig(overrides = {}) {
    const payload = {
      desktop: {
        cloud: {
          connected: true,
          apiKey: "nxk_test_local_key",
        },
      },
      ...overrides,
    };
    await writeFile(
      path.join(rootDir, "config.json"),
      JSON.stringify(payload, null, 2),
    );
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("persists baseUrl in local skill config", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));

    await savePageDeployConfig(rootDir, {
      baseUrl: "http://127.0.0.1:8787",
    });

    await expect(loadPageDeployConfig(rootDir)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:8787",
    });
  });

  it("refuses to persist a job when the worker response is missing a job id", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    await expect(
      submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                taskType: "static-deploy",
                status: "queued",
                createdAt: "2026-04-08T00:00:00.000Z",
              }),
              { status: 202 },
            ),
          ),
        },
      ),
    ).rejects.toThrow(/job/i);

    await expect(loadPageDeployJobs(rootDir)).resolves.toEqual([]);
  });

  it("rejects non-zip uploads before calling the remote worker", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const filePath = path.join(rootDir, "site.txt");
    await writeFile(filePath, "not-a-zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn();
    await expect(
      submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath: filePath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/\.zip/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("writes a job locally and returns a sessions_spawn payload after submit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const result = await submitPageDeployJob(
      {
        nexuHome: rootDir,
        zipPath,
        botId: "bot-1",
        chatId: "C123",
        chatType: "channel",
        channel: "slack",
        to: "user:U123",
        threadId: "thread-1",
        sessionKey: "session-1",
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-1",
              taskType: "static-deploy",
              status: "queued",
              createdAt: "2026-04-08T00:00:00.000Z",
            }),
            { status: 202 },
          ),
        ),
      },
    );

    expect(result.job.jobId).toBe("job-1");
    expect(result.spawnPayload).toEqual({
      sessions_spawn: {
        instruction:
          "Wait for deploy-skill job job-1 to complete, then tell the user exactly: Your website is ready, the link is {link}. Use command: node scripts/deploy_skill.js wait-and-deliver --job-id job-1",
        runTimeoutSeconds: 900,
      },
    });

    const jobs = await loadPageDeployJobs(rootDir);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      jobId: "job-1",
      botId: "bot-1",
      chatId: "C123",
      to: "user:U123",
      threadId: "thread-1",
      sessionKey: "session-1",
      status: "queued",
    });
  });

  it("sends the Nexu cloud API key in the Authorization header on submit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-auth-submit",
          taskType: "static-deploy",
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
        }),
        { status: 202 },
      ),
    );

    await submitPageDeployJob(
      {
        nexuHome: rootDir,
        zipPath,
        botId: "bot-1",
        chatId: "C123",
        chatType: "channel",
        channel: "slack",
        sessionKey: "session-1",
      },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://deploy.example.com/v1/remote-executions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer nxk_test_local_key",
        }),
      }),
    );
  });

  it("fails before submit when the local Nexu cloud API key is missing", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig({
      desktop: { cloud: { connected: true, apiKey: "" } },
    });

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn();

    await expect(
      submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/log in to your Nexu account/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renders the distill-campaign template into a root-level zip before submit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "distill.json");
    await writeLocalNexuConfig();
    await writeFile(
      contentPath,
      JSON.stringify({
        title: "Alice 的赛博分身",
        subtitle: "Founder / Product / Builder",
        tags: ["高执行力", "夜间工作流", "AI Native"],
        metrics: [
          { label: "执行力", value: "96%" },
          { label: "画饼力", value: "88%" },
          { label: "信息密度", value: "91%" },
          { label: "摸鱼力", value: "6%" },
        ],
        description:
          "Alice is the kind of builder who turns loose notes into a shipped campaign before lunch.",
        qaCards: [
          {
            question: "核心优势",
            answer: "先用起来，再决定边界。",
          },
          {
            question: "致命弱点",
            answer: "该收口的时候收口，该冲刺的时候冲刺。",
          },
        ],
        dialogs: [
          {
            speaker: "bot",
            text: "我是 Alice 的赛博分身，随时在线，永不关机。",
          },
          {
            speaker: "user",
            text: "你怎么看 AI Agent？",
          },
          {
            speaker: "bot",
            text: "先用起来，再决定边界。",
          },
        ],
        ctaText: "安装 roast-skill",
        installText:
          "openclaw skill install https://github.com/nexu-io/roast-skill",
      }),
    );

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    let uploadedZipBuffer = null;
    const result = await submitPageDeployTemplateJob(
      {
        nexuHome: rootDir,
        templateId: "distill-campaign",
        contentFile: contentPath,
        botId: "bot-1",
        chatId: "C123",
        chatType: "channel",
        channel: "slack",
        sessionKey: "session-1",
      },
      {
        fetchImpl: vi.fn(async (_url, init) => {
          const form = init.body;
          const uploadFile = form.get("file");
          uploadedZipBuffer = Buffer.from(await uploadFile.arrayBuffer());
          return new Response(
            JSON.stringify({
              jobId: "job-template-1",
              taskType: "static-deploy",
              status: "queued",
              createdAt: "2026-04-08T00:00:00.000Z",
            }),
            { status: 202 },
          );
        }),
      },
    );

    expect(result.job.jobId).toBe("job-template-1");
    expect(result.job.templateId).toBe("distill-campaign");
    expect(result.job.generatedZipPath).toMatch(
      /rendered-distill-campaign\.zip$/,
    );

    const zip = await JSZip.loadAsync(uploadedZipBuffer);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(["index.html", "styles.css"]),
    );
    expect(
      Object.keys(zip.files).some((name) => name.startsWith("images/")),
    ).toBe(true);
    const indexHtml = await zip.file("index.html").async("string");
    expect(indexHtml).toContain("Alice 的赛博分身");
    expect(indexHtml).toContain("Founder / Product / Builder");
    expect(indexHtml).toContain("生成我的赛博分身");
    expect(indexHtml).toContain("https://github.com/nexu-io/roast-skill");
    expect(indexHtml).toContain("https://github.com/nexu-io/nexu");
    expect(indexHtml).toContain("𝕏 分享");
    expect(indexHtml).toContain("📕 小红书");
    expect(indexHtml).toContain("⚡ 即刻");
    expect(indexHtml).toContain("📸 海报");
    expect(indexHtml).toContain("https://twitter.com/intent/tweet");
    expect(indexHtml).toContain("xhsdiscover://post");
    expect(indexHtml).toContain("https://web.okjike.com");
    expect(indexHtml).toContain("function openPoster()");
    expect(indexHtml).toContain("我是 Alice 的赛博分身，随时在线，永不关机。");
    expect(indexHtml).toContain(
      "openclaw skill install https://github.com/nexu-io/roast-skill",
    );
  });

  it("rejects unknown template ids before submission", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "unknown.json");
    await writeFile(contentPath, JSON.stringify({ title: "Test" }));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn();
    await expect(
      submitPageDeployTemplateJob(
        {
          nexuHome: rootDir,
          templateId: "missing-template",
          contentFile: contentPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/unknown template/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("updates the local job state from the worker status API", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-2",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          to: "user:U123",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const result = await queryPageDeployJob(
      { nexuHome: rootDir, jobId: "job-2" },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-2",
              taskType: "static-deploy",
              status: "succeeded",
              phase: "completed",
              progress: 100,
              result: {
                url: "https://abc123.nexu.space",
                siteSlug: "abc123",
                projectName: "abc123",
                deploymentUrl: "https://abc123.pages.dev",
              },
              error: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              updatedAt: "2026-04-08T00:03:00.000Z",
              completedAt: "2026-04-08T00:03:00.000Z",
            }),
            { status: 200 },
          ),
        ),
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.resultUrl).toBe("https://abc123.nexu.space");
    expect((await loadPageDeployJobs(rootDir))[0]).toMatchObject({
      status: "succeeded",
      to: "user:U123",
      resultUrl: "https://abc123.nexu.space",
      deploymentUrl: "https://abc123.pages.dev",
    });
  });

  it("sends the Nexu cloud API key in the Authorization header on query", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-auth-query",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          to: null,
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-auth-query",
          taskType: "static-deploy",
          status: "running",
          phase: "deploying",
          progress: 60,
          result: null,
          error: null,
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:02:00.000Z",
          completedAt: null,
        }),
        { status: 200 },
      ),
    );

    await queryPageDeployJob(
      { nexuHome: rootDir, jobId: "job-auth-query" },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://deploy.example.com/v1/remote-executions/job-auth-query",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer nxk_test_local_key",
        }),
      }),
    );
  });

  it("wait-and-deliver returns the exact final success message", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-3",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const finalResult = await waitForPageDeployJob(
      { nexuHome: rootDir, jobId: "job-3", pollIntervalMs: 1, maxPolls: 1 },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-3",
              taskType: "static-deploy",
              status: "succeeded",
              phase: "completed",
              progress: 100,
              result: {
                url: "https://xyz789.nexu.space",
                siteSlug: "xyz789",
                projectName: "xyz789",
              },
              error: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              updatedAt: "2026-04-08T00:01:00.000Z",
              completedAt: "2026-04-08T00:01:00.000Z",
            }),
            { status: 200 },
          ),
        ),
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(finalResult.message).toBe(
      "Your website is ready, the link is https://xyz789.nexu.space",
    );
  });

  it("rejects a final success link that does not use nexu.space", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-pages-only",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    await expect(
      waitForPageDeployJob(
        {
          nexuHome: rootDir,
          jobId: "job-pages-only",
          pollIntervalMs: 1,
          maxPolls: 1,
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                jobId: "job-pages-only",
                taskType: "static-deploy",
                status: "succeeded",
                phase: "completed",
                progress: 100,
                result: {
                  url: "https://abc123.pages.dev",
                  siteSlug: "abc123",
                  projectName: "abc123",
                },
                error: null,
                createdAt: "2026-04-08T00:00:00.000Z",
                updatedAt: "2026-04-08T00:01:00.000Z",
                completedAt: "2026-04-08T00:01:00.000Z",
              }),
              { status: 200 },
            ),
          ),
          sleepImpl: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow(/nexu\.space/i);
  });

  it("refuses to emit a success message when the remote success payload has no link", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-4",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    await expect(
      waitForPageDeployJob(
        { nexuHome: rootDir, jobId: "job-4", pollIntervalMs: 1, maxPolls: 1 },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                jobId: "job-4",
                taskType: "static-deploy",
                status: "succeeded",
                phase: "completed",
                progress: 100,
                result: {
                  siteSlug: "xyz789",
                  projectName: "xyz789",
                },
                error: null,
                createdAt: "2026-04-08T00:00:00.000Z",
                updatedAt: "2026-04-08T00:01:00.000Z",
                completedAt: "2026-04-08T00:01:00.000Z",
              }),
              { status: 200 },
            ),
          ),
          sleepImpl: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow(/missing final link/i);
  });

  it("falls back to pages.dev on timeout with retry guidance", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-timeout",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const finalResult = await waitForPageDeployJob(
      {
        nexuHome: rootDir,
        jobId: "job-timeout",
        pollIntervalMs: 1,
        maxPolls: 1,
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-timeout",
              taskType: "static-deploy",
              status: "running",
              phase: "verifying-domain",
              progress: 90,
              result: {
                url: "https://abc123.pages.dev",
                siteSlug: "abc123",
                projectName: "abc123",
                deploymentUrl: "https://build.abc123.pages.dev",
              },
              error: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              updatedAt: "2026-04-08T00:01:00.000Z",
              completedAt: null,
            }),
            { status: 200 },
          ),
        ),
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(finalResult.status).toBe("timeout-fallback");
    expect(finalResult.message).toBe(
      "Your page has been deployed to the temporary domain https://abc123.pages.dev. If you cannot access this domain, you can retry deploy again.",
    );
  });

  it("recovers unfinished jobs into sessions_spawn follow-up payloads", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));

    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-queued",
          zipPath: "/tmp/queued.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
        {
          jobId: "job-success",
          zipPath: "/tmp/success.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "succeeded",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: "https://done.nexu.space",
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    await expect(
      recoverPendingPageDeployJobs({ nexuHome: rootDir }),
    ).resolves.toEqual([
      {
        jobId: "job-queued",
        spawnPayload: {
          sessions_spawn: {
            instruction:
              "Wait for deploy-skill job job-queued to complete, then tell the user exactly: Your website is ready, the link is {link}. Use command: node scripts/deploy_skill.js wait-and-deliver --job-id job-queued",
            runTimeoutSeconds: 900,
          },
        },
      },
    ]);
  });
});
