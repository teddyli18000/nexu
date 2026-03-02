# Testing

Nexu 自动化测试方案。覆盖单元测试、集成测试、压力测试、Slack/Discord 能力验证、多租户隔离检查及 AI 驱动的前端自动化测试。

## 文档索引

| 文档 | 内容 | 目标读者 |
|------|------|---------|
| **本文** | 基础设施、优先级、隔离验证、冒烟测试、Mock 策略、CI 集成 | 所有人 |
| [单元测试 & 集成测试](testing/unit-integration.md) | ~120 个用例：crypto、Zod schemas、签名验证、路由 CRUD、events、sessions 等 | 开发 |
| [压力测试](testing/stress.md) | config 生成性能、加解密吞吐、并发写入、k6 负载 | 开发 |
| [Slack & Discord 能力验证](testing/platform-capabilities.md) | 消息处理、streaming、agent tools、多 bot 路由、错误恢复 checklist | QA |
| [AI E2E 自动化](testing/e2e-automation.md) | agent-browser + Stagehand 前端测试、Slack/Discord 消息模拟 | 自动化 |
| [人工测试清单](testing/manual.md) | OAuth 授权、视觉回归、运维演练等需要人工介入的项目 | QA |

---

## 基础设施

| 项目 | 值 |
|------|-----|
| 框架 | Vitest 3.0.7 |
| 测试 DB | PGlite（WASM 内存 PostgreSQL，零外部依赖） |
| 运行全部 | `pnpm test` |
| 仅 API | `pnpm --filter @nexu/api test` |
| Watch 模式 | `pnpm --filter @nexu/api test:watch` |

**约定：** 测试文件放在 `__tests__/` 目录，与被测模块同级。例如 `apps/api/src/lib/__tests__/crypto.test.ts`。

### PGlite — 零配置内存数据库

使用 [PGlite](https://github.com/electric-sql/pglite) 替代真实 PostgreSQL 实例，WASM 编译的 Postgres 直接跑在 Node.js 进程内，无需 Docker、无需外部 DB 服务。

**安装：**
```bash
pnpm --filter @nexu/api add -D @electric-sql/pglite
```

**全局 test setup（`apps/api/test/setup.ts`）：**
```typescript
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, vi } from "vitest";
import * as schema from "../src/db/schema/index.js";

// 用 PGlite 内存实例替换真实 DB
vi.mock("../src/db/index.js", async (importOriginal) => {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return {
    ...(await importOriginal<typeof import("../src/db/index.js")>()),
    db,
    pool: client,  // 兼容现有代码中的 pool 引用
  };
});

import { db } from "../src/db/index.js";

// 每个测试前用 Drizzle push 自动建表
beforeEach(async () => {
  // PGlite 支持标准 DDL，直接用 schema 定义建表
  await db.execute(sql`CREATE TABLE IF NOT EXISTS bots (...)`);
  // 或使用 drizzle-kit 的 push 能力
});

// 每个测试后清空
afterEach(async () => {
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
});
```

**Vitest 配置（`apps/api/vitest.config.ts`）：**
```typescript
export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
```

**对比传统方案：**

| | PGlite | 真实 PostgreSQL |
|--|--------|----------------|
| CI 配置 | `pnpm test`，无需 `services.postgres` | 需要 Docker / services 配置 |
| 本地开发 | 零配置，clone 后直接跑 | 需要启动 PG 实例 |
| 速度 | 内存级，每个 suite 独立实例 | 受连接池 + 网络 IO 影响 |
| 并行安全 | 每个 worker 独立 PGlite 实例，天然隔离 | 需要 schema 隔离或独立 DB |
| 兼容性 | 标准 SQL + pgTable 定义完全兼容 | 完整 PG |

> 项目 schema 全部使用 `text` + `integer` + `serial` + `uniqueIndex`，无 PG 扩展依赖，PGlite 100% 兼容。

### API Key 认证 — 测试与登录解耦

为测试引入 API Key 认证路径，彻底绕开 Better-Auth session 和 cookie，使测试可以无状态地调用所有 `/api/v1/*` 端点，也让测试能完全跑在云端 CI 里。

**设计：**

在现有 `authMiddleware` 中增加 API Key 优先检查：

```typescript
// apps/api/src/middleware/auth.ts
export const authMiddleware = createMiddleware(async (c, next) => {
  // 1. API Key 优先（测试 / 程序化调用）
  const apiKey = c.req.header("x-api-key");
  if (apiKey) {
    const user = await lookupUserByApiKey(apiKey);
    if (user) {
      c.set("userId", user.id);
      return next();
    }
    throw new HTTPException(401, { message: "Invalid API key" });
  }

  // 2. Fallback: Better-Auth session（浏览器登录）
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session?.user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("userId", session.user.id);
  await next();
});
```

**核心收益：**

| 收益 | 说明 |
|------|------|
| 测试无需登录 | 所有 API 测试直接 `headers: { "x-api-key": "test-key" }` |
| 云端 CI 友好 | 无 cookie、无 session、无浏览器，纯 HTTP 调用 |
| E2E 测试简化 | Slack/Discord 消息模拟、前端自动化都可用 API Key 调用后端 |
| 扩展方便 | 后续新增测试用例不需要处理 auth mock |
| 生产可用 | API Key 机制也是对外开放 API 的基础 |

**与 mock auth 的对比：**

| | API Key | vi.mock auth |
|--|---------|-------------|
| 测试真实性 | 走真实中间件链路 | 跳过真实 auth 逻辑 |
| 维护成本 | auth 改了也不用改测试 | auth 重构需要改 mock |
| E2E / 集群测试 | 同一套代码直接打真实环境 | 仅限单元/集成测试 |
| 多用户测试 | 不同 key 代表不同用户 | 每次改 mock 的 userId |

---

## 多租户隔离验证

### 数据隔离

| 检查项 | 方法 |
|--------|------|
| Bot 列表隔离 | 用户 A 的 API 不返回用户 B 的 bot |
| Channel 列表隔离 | 用户 A 的 API 不返回用户 B 的 channel |
| Session 列表隔离 | 用户 A 查不到用户 B 的 session |
| Artifact 列表隔离 | 用户 A 查不到用户 B 的 artifact |
| Bot 操作隔离 | 用户 A PATCH/DELETE 用户 B 的 botId → 404 |

### Credential 隔离

| 检查项 | 方法 |
|--------|------|
| 加密存储 | DB 中 encryptedValue 不含明文 token |
| 跨用户不可读 | 用户 A 的 API 路径无法获取用户 B 的 credential |
| Config 隔离 | Pool config 仅包含属于该 pool 的 bot 的 credential |

### Config 隔离

| 检查项 | 方法 |
|--------|------|
| Pool 边界 | pool-1 的 config 不含 pool-2 的 bot |
| Agent 列表 | config.agents.list 仅含该 pool 的 active bot |
| Channel accounts | config.channels.slack.accounts 仅含该 pool 的 connected channel |
| Binding 映射 | config.bindings 仅引用该 pool 的 agent + account |

---

## 真实集群冒烟测试

> 针对 test 环境：`nexu.powerformer.net` / `nexu-api.powerformer.net`

### Health Check

```bash
curl -s https://nexu-api.powerformer.net/health | jq .
# 预期：{"status": "ok", "metadata": {"commitHash": "..."}}
```

### API 端到端

```bash
# 用 API Key 调用（无需 session cookie）
curl -s -H "x-api-key: ${TEST_API_KEY}" \
  https://nexu-api.powerformer.net/api/v1/me | jq .

curl -s -X POST -H "x-api-key: ${TEST_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Bot","slug":"test-bot-smoke"}' \
  https://nexu-api.powerformer.net/api/v1/bots | jq .

curl -s -H "x-api-key: ${TEST_API_KEY}" \
  https://nexu-api.powerformer.net/api/v1/bots | jq .
```

### Gateway Config

```bash
curl -s -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" \
  https://nexu-api.powerformer.net/api/internal/pools/{poolId}/config | jq .
# 预期：合法的 OpenClaw config JSON，可通过 openclawConfigSchema 验证
```

### OpenClaw Gateway 连通性

```bash
curl -s http://{podIp}:18789/
# TCP 连通即可，Gateway 控制面板应返回 HTML
```

---

## Mock 策略

### 外部 API Mock

| 外部服务 | Mock 方式 | 说明 |
|---------|----------|------|
| Slack API (auth.test, bots.info, oauth.v2.access) | `vi.fn()` mock `fetch` | 返回预定义的 JSON 响应 |
| Discord API | `vi.fn()` mock `fetch` | 返回预定义的 JSON 响应 |
| Resend (email) | `vi.fn()` mock `sendEmail` | 验证调用参数，不真发邮件 |
| Gateway 转发 | `vi.fn()` mock `fetch` | 拦截 `http://{podIp}:18789/...` 调用 |

### Auth — API Key 优先（推荐）

引入 API Key 认证后，路由测试不再需要 mock auth：

```typescript
// 直接用 API Key 调用，走真实中间件链路
const res = await app.request("/api/v1/bots", {
  headers: { "x-api-key": "test-api-key-user-1" },
});

// 多用户隔离测试 — 不同 key 代表不同用户
const resA = await app.request("/api/v1/bots", {
  headers: { "x-api-key": "test-api-key-user-A" },
});
const resB = await app.request("/api/v1/bots", {
  headers: { "x-api-key": "test-api-key-user-B" },
});
```

**Fallback — vi.mock（仅在 API Key 机制实装前使用）：**

```typescript
vi.mock("../middleware/auth.ts", () => ({
  authMiddleware: vi.fn((c, next) => {
    c.set("userId", "test-user-1");
    return next();
  }),
}));
```

### 数据库 — PGlite 内存实例

全局 test setup 自动替换为 PGlite，测试代码中无需手动管理连接：

```typescript
// test/setup.ts 已通过 vi.mock 注入 PGlite（见基础设施章节）
// 测试直接 import { db } from "../db/index.js" 即可，拿到的是内存实例
```

---

## 测试优先级

| 优先级 | 类别 | 预计用例数 | 依赖 | CI 层级 |
|--------|------|-----------|------|---------|
| **P0** | 单元测试（crypto, schemas, 签名验证） | ~40 | 无 | L1 PR Gate |
| **P1** | Config generator + pool service 扩展 | ~20 | PGlite | L1 PR Gate |
| **P1** | Slack events 路由测试 | ~11 | PGlite + mock fetch | L1 PR Gate |
| **P2** | Bot CRUD / Channel connect 路由 | ~30 | PGlite + API Key + mock Slack/Discord API | L1 PR Gate |
| **P2** | Session / Invite / OAuth state | ~20 | PGlite | L1 PR Gate |
| **P3** | 压力测试（config 生成、加解密、并发写入） | ~10 | PGlite | L1 PR Gate |
| **P3** | 多租户隔离验证 | ~12 | PGlite + API Key | L1 PR Gate |
| **P4** | 集群冒烟测试 / k6 负载测试 | ~5 | test 环境 + k6 | L2 Post-Deploy |
| **P4** | AI 模拟消息端到端 | ~10 | Slack/Discord token + 部署环境 | L2 Post-Deploy |
| **P4** | Slack 能力验证 | ~25 | 真实 Slack workspace | L3 不进 CI |
| **P4** | Discord 能力验证 | ~30 | 真实 Discord server | L3 不进 CI |
| **P4** | AI 前端自动化测试 | ~15 | agent-browser + Stagehand + 部署环境 | L3 不进 CI |

**总计：约 228 个测试用例。L1 ~140 / L2 ~20 / L3 ~70。**

---

## CI 集成

> PGlite 内存 DB + API Key 认证 = 零外部依赖，无需 Docker services。

### 分层策略

测试按触发时机分为三层：

| 层级 | 触发时机 | 用例数 | 覆盖内容 | 外部依赖 |
|------|---------|--------|---------|---------|
| **L1 — PR Gate** | 每次 push / PR | ~140 | 单元测试、集成测试、压力基准、隔离验证 | 无 |
| **L2 — Post-Deploy** | 部署到 test 环境后 | ~20 | 集群冒烟、消息模拟、k6 负载 | test 环境 + Slack/Discord token |
| **L3 — 不进 CI** | 人工 / 按需 | ~70 | 平台能力验证、前端自动化、人工测试 | 真实平台账户 + 浏览器 + 人工 |

### L1 — PR Gate（每次 push/PR，~140 用例，< 30s）

覆盖所有零外部依赖的测试，PGlite 内存 DB，PR 不通过则阻断合并。

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - run: pnpm test
        env:
          ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          GATEWAY_TOKEN: "test-gw-token"
          INTERNAL_API_TOKEN: "test-internal-token"
```

### L2 — Post-Deploy（部署后触发 + 定时，~20 用例）

部署到 test 环境后自动触发冒烟测试，定时 job 跑负载测试和消息模拟。

```yaml
# .github/workflows/post-deploy.yml
name: Post-Deploy Tests
on:
  workflow_dispatch:
  repository_dispatch:
    types: [deploy-complete]
  schedule:
    - cron: "0 2 * * *"  # 每天 UTC 02:00

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - name: Smoke test
        run: pnpm --filter @nexu/api test:smoke
        env:
          TEST_API_URL: ${{ vars.TEST_API_URL }}
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
      - name: Message simulation
        run: pnpm --filter @nexu/api test:e2e
        env:
          TEST_API_URL: ${{ vars.TEST_API_URL }}
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
          SLACK_TEST_BOT_TOKEN: ${{ secrets.SLACK_TEST_BOT_TOKEN }}
          SLACK_TEST_CHANNEL: ${{ secrets.SLACK_TEST_CHANNEL }}
          DISCORD_TEST_BOT_TOKEN: ${{ secrets.DISCORD_TEST_BOT_TOKEN }}
          DISCORD_TEST_CHANNEL: ${{ secrets.DISCORD_TEST_CHANNEL }}

  load:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: grafana/setup-k6-action@v1
      - name: k6 load test
        run: k6 run tests/load/k6-bots.js
        env:
          TEST_API_URL: ${{ vars.TEST_API_URL }}
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
```

**所需 GitHub Secrets：**

| Secret | 说明 |
|--------|------|
| `TEST_API_KEY` | test 环境的 API Key |
| `SLACK_TEST_BOT_TOKEN` | 测试 Slack workspace 的 bot token |
| `SLACK_TEST_CHANNEL` | 测试用的 Slack channel ID |
| `DISCORD_TEST_BOT_TOKEN` | 测试 Discord server 的 bot token |
| `DISCORD_TEST_CHANNEL` | 测试用的 Discord channel ID |

### L3 — 不进 CI（人工 / 按需，~70 用例）

| 内容 | 用例数 | 不进 CI 的原因 | 建议执行方式 |
|------|--------|---------------|------------|
| [Slack/Discord 能力验证](testing/platform-capabilities.md) | ~55 | 需要真实平台 + 主观判断 | 每个 release 前走 checklist |
| [AI 前端自动化](testing/e2e-automation.md) | ~15 | 需要浏览器 + LLM 调用 | 开发阶段本地执行 |
| [人工测试](testing/manual.md) | ~30 | 需要人工介入 | 里程碑节点专项测试 |

### 对比传统方案

| | PGlite + API Key | 传统方案（PG Docker + session mock） |
|--|-------------------|--------------------------------------|
| L1 CI 配置 | 3 步（checkout → install → test） | 需要 `services.postgres` + 端口映射 |
| 环境变量 | 3 个 | 4 个（多一个 `TEST_DATABASE_URL`） |
| 启动时间 | 无 DB 启动等待 | 等待 PG 健康检查（~5-10s） |
| 本地运行 | `pnpm test` 即可 | 需先启动 PG 容器 |
| 并行安全 | 每个 worker 独立 PGlite 实例 | 需要 schema 隔离或独立 DB |
| Auth 测试 | API Key 走真实中间件 | mock 跳过真实 auth 逻辑 |
| E2E 复用 | L1/L2 同一套认证机制 | L1 用 mock，L2 要另写 |
