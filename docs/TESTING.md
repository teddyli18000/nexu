# Testing

Nexu 自动化测试方案。覆盖单元测试、集成测试、压力测试、Slack/Discord 能力验证、多租户隔离检查及 AI 驱动的前端自动化测试。

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

**对比传统方案的优势：**

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

**测试中的使用：**

```typescript
// 不再需要 mock auth middleware
const app = createApp();
const res = await app.request("/api/v1/bots", {
  headers: { "x-api-key": "test-api-key-user-1" },
});
expect(res.status).toBe(200);
```

**与 mock auth 的对比：**

| | API Key | vi.mock auth |
|--|---------|-------------|
| 测试真实性 | 走真实中间件链路 | 跳过真实 auth 逻辑 |
| 维护成本 | auth 改了也不用改测试 | auth 重构需要改 mock |
| E2E / 集群测试 | 同一套代码直接打真实环境 | 仅限单元/集成测试 |
| 多用户测试 | 不同 key 代表不同用户 | 每次改 mock 的 userId |

---

## 1. 单元测试 — 纯函数

无数据库、无网络依赖，可在任何环境即时运行。

### 1.1 Crypto (`apps/api/src/lib/crypto.ts`)

| 用例 | 描述 |
|------|------|
| encrypt/decrypt 往返 | 加密再解密，结果与原文一致 |
| 空字符串 | `encrypt("")` → `decrypt(result)` = `""` |
| Unicode 文本 | 中文、emoji、特殊字符往返一致 |
| 长文本 | 10KB+ 内容加解密正确 |
| 不同 key 解密失败 | 用 key A 加密、key B 解密 → 抛出错误 |
| 篡改密文 | 修改 base64 中间字节 → auth tag 验证失败 |
| 缺少 ENCRYPTION_KEY | 环境变量未设置 → 抛出 `ENCRYPTION_KEY environment variable is not set` |
| key 长度错误 | 非 64 位 hex → 抛出 `ENCRYPTION_KEY must be 32 bytes` |
| 每次加密结果不同 | 同一明文两次加密产生不同密文（随机 IV） |

### 1.2 Zod Schema 验证 (`packages/shared/src/schemas/`)

**Bot schemas (`bot.ts`)：**

| 用例 | 描述 |
|------|------|
| createBotSchema 合法输入 | `{ name: "My Bot", slug: "my-bot" }` 通过 |
| slug 非法字符 | `slug: "My Bot!"` 被拒 |
| name 空字符串 | `name: ""` 被拒（最少 1 字符） |
| name 超长 | 255+ 字符被拒 |
| updateBotSchema 部分更新 | `{ name: "New Name" }` 通过（其他字段可选） |
| botStatusSchema 枚举 | `"active"`, `"paused"`, `"deleted"` 通过；`"unknown"` 被拒 |

**Channel schemas (`channel.ts`)：**

| 用例 | 描述 |
|------|------|
| connectSlackSchema 合法输入 | `{ botToken: "xoxb-xxx", signingSecret: "xxx" }` 通过 |
| connectSlackSchema 缺 botToken | 被拒 |
| connectDiscordSchema 合法输入 | `{ botToken: "xxx", appId: "123" }` 通过 |
| connectDiscordSchema 缺 appId | 被拒 |
| channelTypeSchema 枚举 | `"slack"`, `"discord"` 通过；`"telegram"` 被拒 |
| channelStatusSchema 枚举 | `"pending"`, `"connected"`, `"disconnected"`, `"error"` 通过 |

**OpenClaw Config schema (`openclaw-config.ts`)：**

| 用例 | 描述 |
|------|------|
| 完整合法配置 | 包含 gateway + agents + channels + bindings 的完整配置通过 |
| 缺少 gateway | 被拒 |
| 缺少 agents.list | 被拒 |
| 多余字段 passthrough | 带 `.passthrough()` 的子 schema 允许额外字段 |
| agents.list 空数组 | 通过（合法） |
| bindings 空数组 | 通过（合法） |
| 嵌套 model provider | litellm provider 配置完整验证 |
| cron 配置 | `{ enabled: true }` 通过 |
| tools 配置 | exec + web 子配置验证 |

**其他 schemas：**

| Schema | 关键用例 |
|--------|---------|
| `sessionStatusSchema` | `"active"`, `"ended"` 通过 |
| `createSessionSchema` | 必填 botId + sessionKey + title |
| `onboardingSchema` | role 必填、useCases 数组 |
| `inviteCodeSchema` | code 字符串必填 |
| `poolRegisterSchema` | poolId + status + podIp 必填 |

### 1.3 Slack 签名验证 (`apps/api/src/routes/slack-events.ts`)

> 前置：需要将 `verifySlackSignature` 函数 export 以便单独测试。

| 用例 | 描述 |
|------|------|
| 合法签名 | 正确的 secret + timestamp + body + signature → `true` |
| 伪造签名 | 正确 timestamp + body，错误 signature → `false` |
| 过期时间戳 | timestamp > 5 分钟前 → `false` |
| 错误 body | 签名与不同 body 不匹配 → `false` |
| 空签名 | `signature = ""` → `false` |
| 空时间戳 | `timestamp = ""` → `false` |
| 长度不匹配 | signature 长度与预期不同 → `false`（快速路径） |

### 1.4 Models (`apps/api/src/lib/models.ts`)

| 用例 | 描述 |
|------|------|
| PLATFORM_MODELS 非空 | 数组长度 > 0 |
| 每个模型有必需字段 | id, name, provider 均存在 |
| 模型 ID 唯一 | 无重复 ID |
| PLATFORM_MODEL_CATALOG 完整 | 包含所有 PLATFORM_MODELS 的 ID |

---

## 2. 集成测试 — 数据库依赖

使用测试数据库运行，每个 test suite 在 `beforeAll` 中创建表，`beforeEach` 中 truncate。

### 2.1 Config Generator 扩展 (`apps/api/src/lib/__tests__/config-generator.test.ts`)

已有 8 个用例，需新增：

| 用例 | 描述 |
|------|------|
| Discord channel 配置生成 | 创建 Discord channel → config 包含 `channels.discord.accounts` |
| 混合 Slack + Discord | 同一 pool 有两种 channel → 两者都在 config 中 |
| LiteLLM 前缀 | 设置 `LITELLM_BASE_URL` + `LITELLM_API_KEY` → model ID 加 `litellm/` 前缀 |
| LiteLLM 已有前缀 | model ID 已包含 `litellm/` → 不重复添加 |
| cron 输出 | config 包含 `cron: { enabled: true }` |
| web tools 输出 | config 包含 `tools.web.search.enabled` + `tools.web.fetch.enabled` |
| exec sandbox 输出 | config 包含 `tools.exec.host: "sandbox"` |
| commands 输出 | config 包含 `commands.native`, `commands.restart` 等 |
| 空凭据处理 | credential 加密值损坏 → decrypt 失败 → fallback 空字符串 |
| streaming off | Slack account 配置包含 `streaming: "off"` |
| Bot 排序 | 多 bot 按 slug 字母序排列，第一个为 default |
| Discord groupPolicy | Discord account 包含 `groupPolicy: "open"` |
| Discord dmPolicy | Discord channel 包含 `dmPolicy: "open"` |
| Discord allowFrom | Discord channel 包含 `allowFrom: ["*"]` |

### 2.2 Pool Config Service 扩展 (`apps/api/src/services/runtime/__tests__/pool-config-service.test.ts`)

已有 3 个用例，需新增：

| 用例 | 描述 |
|------|------|
| 空 pool 发布 | 无 bot 的 pool → 生成空 agents list 的 snapshot |
| 并发写入竞态 | 10 个 `publishPoolConfigSnapshot` 并发执行 → 无死锁、版本连续 |
| 多次变更版本递增 | 3 次不同变更 → 版本 1, 2, 3 |
| Pool 不存在 | 传入无效 poolId → 抛出错误 |
| config_hash 一致性 | 相同配置内容 → 相同 hash（deterministic） |

### 2.3 Bot CRUD 路由 (`apps/api/src/routes/bot-routes.ts`)

| 用例 | 描述 |
|------|------|
| 创建 bot | POST /api/v1/bots → 201 + 返回 id, name, slug, status="active" |
| slug 冲突 | 同用户相同 slug → 409 |
| 跨用户相同 slug | 不同用户相同 slug → 各自 201（允许） |
| 列表过滤 | 仅返回当前用户的 active/paused bot，不含 deleted |
| 获取单个 | GET /api/v1/bots/{botId} → 200 + 完整字段 |
| 获取不存在 | GET /api/v1/bots/invalid → 404 |
| 获取别人的 | 用户 A 获取用户 B 的 bot → 404 |
| 更新名字 | PATCH + name → 200 + 新名字 |
| 更新触发 snapshot | PATCH → pool config snapshot 版本 +1 |
| 删除 | DELETE → status 变为 "deleted" |
| 删除后列表不含 | 删除后 GET 列表不含该 bot |
| 暂停 | POST .../pause → status="paused" |
| 恢复 | POST .../resume → status="active" |
| 暂停触发 snapshot | 暂停后 config 不含该 agent |

### 2.4 Channel Connect 路由 (`apps/api/src/routes/channel-routes.ts`)

**Slack Connect（需 mock Slack API）：**

| 用例 | 描述 |
|------|------|
| 成功连接 | botToken + signingSecret → 201 + channel 创建 |
| credential 加密 | 连接后 DB 中的 encryptedValue 能 decrypt 回原值 |
| webhook route 创建 | 连接后 webhook_routes 表有对应记录 |
| 无效 token | mock auth.test 返回 error → 错误响应 |
| 重复连接 | 同一 Slack app 再次连接 → 409 |
| App ID 全局唯一 | Slack app 已被其他用户连接 → 409 |
| auto-create bot | 用户无 bot → 自动创建 "My Bot" |

**Discord Connect（需 mock Discord API）：**

| 用例 | 描述 |
|------|------|
| 成功连接 | botToken + appId → 201 + channel 创建 |
| credential 加密 | token 加密存储、可解密 |
| 无效 token | mock Discord API 401 → 错误响应 |
| 重复连接 | 同一 Discord app → 409 |
| App ID 不匹配 | token 对应的 appId 与传入不一致 → 409 |

**Channel 管理：**

| 用例 | 描述 |
|------|------|
| 列表 | GET /api/v1/channels → 当前用户的 channel 列表 |
| 删除 | DELETE → 级联清理 channel_credentials + webhook_routes |
| 删除后 config 更新 | 删除 channel → pool config 不再包含该 account |

### 2.5 Slack Events 路由 (`apps/api/src/routes/slack-events.ts`)

| 用例 | 描述 |
|------|------|
| url_verification | `type: "url_verification"` → 返回 `{ challenge }` |
| 缺 team_id | payload 无 team_id → 400 |
| 缺 api_app_id | payload 无 api_app_id → 400 |
| Slack retry 跳过 | `x-slack-retry-num` header 存在 → 立即返回 `{ ok: true }` |
| 未知 workspace | team_id:app_id 无对应 webhook route → 404 |
| 签名验证失败 | 伪造的 `x-slack-signature` → 401 |
| 缺签名 header | 无 timestamp 或 signature header → 401 |
| 无效 JSON | body 非 JSON → 400 |
| 成功转发 | mock gateway fetch → 返回 gateway 响应 |
| 无可用 pod | pool 无 podIp → 202 accepted |
| session upsert | message event → sessions 表新增或 messageCount +1 |

### 2.6 Session 路由 (`apps/api/src/routes/session-routes.ts`)

| 用例 | 描述 |
|------|------|
| 内部创建 | POST /api/internal/sessions → 201 |
| upsert 行为 | 重复 sessionKey → 更新而非报错 |
| 内部更新 | PATCH /api/internal/sessions/{id} → 200 |
| 用户列表 | GET /api/v1/sessions → 仅当前用户的 session |
| 过滤 botId | `?botId=xxx` 仅返回该 bot 的 session |
| 过滤 channelType | `?channelType=slack` 过滤 |
| 分页 | `?limit=10&offset=0` 正确分页 |
| 权限隔离 | 用户 A 查不到用户 B 的 session |

### 2.7 OAuth State 生命周期

| 用例 | 描述 |
|------|------|
| 生成 state | 插入 DB，state 唯一 |
| 使用 state | 消费后 usedAt 被设置 |
| 过期拒绝 | expiresAt 已过 → 拒绝 |
| 重放拒绝 | usedAt 已设置 → 拒绝 |
| returnTo 透传 | 生成时设 returnTo → callback 中可读取 |

### 2.8 Invite Code (`apps/api/src/routes/invite-routes.ts`)

| 用例 | 描述 |
|------|------|
| 合法 code | 验证通过 + usedCount +1 |
| 不存在 code | 返回 `{ valid: false }` |
| 大小写不敏感 | `"ABC123"` 与 `"abc123"` 匹配 |
| 达到 maxUses | usedCount >= maxUses → 拒绝 |
| 已过期 | expiresAt 已过 → 拒绝 |
| 用户标记 | 验证通过 → 用户的 inviteAcceptedAt 被设置 |

### 2.9 Auth Middleware (`apps/api/src/middleware/`)

| 用例 | 描述 |
|------|------|
| 有效 session | 请求通过，context 包含 userId |
| 无 session | 返回 401 |
| 无效 session | 过期或损坏 → 401 |
| Internal token 合法 | `Authorization: Bearer {INTERNAL_API_TOKEN}` → 通过 |
| Internal token 错误 | 错误 token → 401 |
| Internal token 缺失 | 无 header → 401 |
| INTERNAL_API_TOKEN 未配置 | 服务端未设置 → 500 |

---

## 3. 压力测试 / 性能基准

性能基准测试帮助识别多租户架构的瓶颈。

### 3.1 Config 生成性能

**目标：** 验证大规模 pool 下 `generatePoolConfig` 的响应时间。

| 规模 | Bot 数 | Channel / Bot | 预期耗时 |
|------|--------|---------------|---------|
| 小型 | 10 | 2 | < 100ms |
| 中型 | 50 | 2 | < 500ms |
| 大型 | 100 | 2 | < 2s |

**方法：**
```
1. 在测试 DB 中批量插入 N 个 bot + 2N 个 channel + 4N 个 credential
2. 调用 generatePoolConfig 20 次
3. 记录 p50 / p95 / p99 耗时
4. 验证生成的配置 Zod schema 通过
```

**指标：**
- p50 / p95 / p99 延迟
- 生成的 JSON 大小（bytes）
- DB 查询次数（N+1 问题检测）

### 3.2 加解密吞吐量

**目标：** 确认 AES-256-GCM 加解密在凭据密集场景下的性能。

| 操作 | 次数 | 预期吞吐 |
|------|------|---------|
| encrypt | 1000 | > 5000 ops/s |
| decrypt | 1000 | > 5000 ops/s |
| 往返 | 1000 | > 3000 ops/s |

**方法：**
```
1. 生成 1000 个不同长度的明文（10B ~ 1KB）
2. 顺序执行 encrypt → decrypt
3. 记录总耗时和 ops/s
4. 检查内存占用无异常增长
```

### 3.3 Slack 签名验证吞吐量

**目标：** 签名验证是每个 Slack event 的必经路径，需确认不成为瓶颈。

| 操作 | 次数 | 预期吞吐 |
|------|------|---------|
| verifySlackSignature | 10000 | > 50000 ops/s |

**方法：**
```
1. 预生成合法的 secret + timestamp + rawBody + signature
2. 循环调用 verifySlackSignature 10000 次
3. 记录总耗时
```

### 3.4 Config Snapshot 并发写入

**目标：** 多个 bot 同时变更时，snapshot 发布无死锁、无重复版本。

**方法：**
```
1. 创建 1 个 pool + 10 个 bot
2. 并发执行 10 个 publishPoolConfigSnapshot（每次前修改一个 bot 名称）
3. 验证：
   - 无 DB 死锁（无超时错误）
   - 最终版本号 = 初始版本 + 实际变更数（hash 去重后）
   - 所有 snapshot 的 config_json 可被 Zod parse
```

### 3.5 数据库连接池压力

**目标：** 高并发 API 调用下 pg pool 不会耗尽。

| 场景 | 并发数 | 持续时间 |
|------|--------|---------|
| Bot 列表查询 | 50 | 10s |
| Channel 列表查询 | 50 | 10s |
| Config 生成 | 20 | 10s |

**方法：**
```
1. 使用 Promise.all 模拟并发请求
2. 每个请求执行完整的 DB 查询链路
3. 监控：错误率、平均延迟、连接池等待时间
```

### 3.6 API 端点负载测试（可选，需 k6 或类似工具）

> 以下测试针对 test 环境 (`nexu-api.powerformer.net`) 运行。

| 端点 | 并发用户 | 持续 | 关注指标 |
|------|---------|------|---------|
| `GET /health` | 100 | 30s | p99 延迟 < 50ms |
| `GET /api/v1/bots` | 50 | 30s | p99 延迟 < 200ms |
| `POST /api/slack/events` | 50 | 30s | 签名验证 + DB 查询 + 转发全链路 |
| `GET /api/internal/pools/{id}/config` | 20 | 30s | 大 pool 配置生成 |

**k6 脚本模板：**
```javascript
// k6 run --vus 50 --duration 30s scripts/load-test-bots.js
import http from "k6/http";
import { check } from "k6";

export default function () {
  const res = http.get("https://nexu-api.powerformer.net/api/v1/bots", {
    headers: { Cookie: "session=..." },
  });
  check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 200ms": (r) => r.timings.duration < 200,
  });
}
```

---

## 4. Slack 能力验证

> 需要真实 Slack workspace。建议创建专用测试 workspace。

### 4.1 消息处理

- [ ] **DM 对话：** 直接给 bot 发私信 → bot 正常回复
- [ ] **Channel @mention：** 在频道 @bot → bot 回复
- [ ] **线程回复：** bot 回复出现在正确的 thread 中
- [ ] **长文本分块：** 让 bot 生成 >4000 字符回复 → 正确分多条发送
- [ ] **消息编辑通知：** 编辑消息后 bot 不重复回复（`message_changed` subtype 处理）
- [ ] **Bot 消息忽略：** bot 自己的消息不触发回复循环

### 4.2 Streaming 模式

| 模式 | 配置值 | 预期行为 |
|------|--------|---------|
| 关闭 | `streaming: "off"` | 等待完整生成后一次性发送 |
| 逐步更新 | `streaming: "partial"` | 同一条消息持续更新内容 |
| 追加模式 | `streaming: "block"` | 新内容追加到已有消息 |
| 进度指示 | `streaming: "progress"` | "思考中..." 指示器 → 最终完整回复 |

### 4.3 Agent Tools

- [ ] **Web search：** 问 bot "今天的新闻" → 返回网页搜索结果
- [ ] **Web fetch：** 让 bot 抓取指定 URL 内容 → 返回页面摘要
- [ ] **Cron 定时任务：** 让 bot 设置 "每分钟提醒我" → 定时消息发送
- [ ] **Exec sandbox：** 让 bot 执行 `echo hello` → 返回 sandbox 输出
- [ ] **Emoji reaction：** 让 bot 给消息加 emoji → 消息出现 reaction
- [ ] **Pin 消息：** 让 bot pin 一条消息 → 消息被 pin

### 4.4 多 Bot 路由

- [ ] **同 pool 多 bot：** bot-A 在 workspace-A 回复，bot-B 在 workspace-B 回复，互不干扰
- [ ] **Binding 映射：** Slack accountId → 正确 agentId，验证 config bindings 生效
- [ ] **Default agent：** 未明确绑定的请求 → 路由到 default agent

### 4.5 错误恢复

- [ ] **Gateway 重启：** 重启 Gateway pod → Slack 消息在重启后恢复响应
- [ ] **Slack retry：** 模拟超时 → Slack 发 retry → `x-slack-retry-num` 被跳过
- [ ] **LLM 调用失败：** 设置无效 model ID → bot 返回错误消息（不崩溃）
- [ ] **Credential 过期：** 更换 Slack token 后未更新 Nexu → 签名验证失败 → 清晰错误日志

### 4.6 Slack API 限流行为

- [ ] **Tier 1 限流：** 快速发送多条消息 → bot 响应是否被 429 影响
- [ ] **SDK retry：** OpenClaw Slack SDK 配置 2 次 retry、500ms-3s 指数退避
- [ ] **多 channel 并发：** 多个 channel 同时收到消息 → 各自独立回复

---

## 5. Discord 能力验证

> 需要真实 Discord server。建议创建专用测试 server 并邀请 bot。

### 5.1 消息处理

- [ ] **Guild 文本频道：** 在频道发送消息 → bot 正常回复
- [ ] **DM 对话：** 给 bot 发私信 → bot 正常回复
- [ ] **线程回复：** bot 回复出现在正确的 thread 中
- [ ] **长文本分块：** bot 生成 >2000 字符回复 → 正确分多条发送（Discord 限制 2000 字符/条）
- [ ] **Bot 消息忽略：** bot 不回复自己或其他 bot 的消息（`allowBots: false` 默认）
- [ ] **@mention 触发：** 配置 `requireMention: true` 后，仅 @bot 才回复

### 5.2 交互组件

- [ ] **Buttons：** bot 发送带按钮的消息 → 点击按钮触发 agent 处理
- [ ] **Select menus：** bot 发送下拉选择 → 选择后触发 agent 处理
- [ ] **Modals：** agent 弹出表单 → 填写提交 → agent 接收数据
- [ ] **Embeds：** bot 发送带 embed 的消息（标题、颜色、字段、图片）
- [ ] **Slash commands：** 注册自定义 /命令 → 执行后返回结果

### 5.3 高级功能

- [ ] **Forum channel：** 在论坛频道发帖 → bot 自动创建 thread 并回复
- [ ] **Emoji reaction：** 让 bot 给消息加 emoji → 消息出现 reaction
- [ ] **Pin 消息：** 让 bot pin/unpin 消息
- [ ] **文件上传：** bot 发送文件附件
- [ ] **Voice message：** bot 发送语音消息（OGG/Opus 格式）
- [ ] **Poll 投票：** bot 创建投票 → 用户可投票
- [ ] **Sticker：** bot 发送贴纸

### 5.4 Guild 管理（Agent Tools）

- [ ] **memberInfo：** 查询用户信息（角色、昵称、加入时间）
- [ ] **roleAdd / roleRemove：** 给用户添加/移除角色
- [ ] **channelCreate / channelEdit：** 创建/编辑频道
- [ ] **channelList：** 列出 guild 所有频道
- [ ] **eventCreate / eventList：** 创建/列出 scheduled events
- [ ] **timeout / kick / ban：** 管理员操作（需要对应权限）

### 5.5 多 Bot 路由

- [ ] **同 pool 多 bot：** bot-A 在 guild-A 回复，bot-B 在 guild-B 回复
- [ ] **Binding 映射：** Discord accountId → 正确 agentId
- [ ] **Per-guild 配置：** 不同 guild 不同 `groupPolicy` / `requireMention` 设置生效
- [ ] **Per-channel 配置：** 特定频道启用/禁用 bot、频道级别 system prompt

### 5.6 Thread Binding & Session

- [ ] **/focus 命令：** 在 thread 中执行 → thread 绑定到当前 session
- [ ] **TTL 过期：** thread binding 在 24h 后自动解绑
- [ ] **Subagent thread：** 启用 `spawnSubagentSessions` → subagent 自动创建新 thread

### 5.7 错误恢复

- [ ] **WebSocket 断连重连：** 网络中断后自动重连（指数退避）
- [ ] **Rate limit 429：** 快速发送多条消息 → SDK 自动 retry（3 次、500ms-30s 指数退避）
- [ ] **权限不足：** bot 缺少 `SEND_MESSAGES` 权限 → 清晰错误日志（不崩溃）
- [ ] **DM 被禁：** 用户禁止 DM → 错误码 50007 → 清晰提示
- [ ] **Gateway 重启：** Gateway pod 重启后 Discord bot 自动重连

### 5.8 Discord Streaming 模式

| 模式 | 配置值 | 预期行为 |
|------|--------|---------|
| 关闭 | `streaming: "off"` | 完整回复一次性发送 |
| 逐步更新 | `streaming: "partial"` | 同一条消息持续编辑更新 |
| 块追加 | `streaming: "block"` | 内容按块追加到消息 |
| 进度指示 | `streaming: "progress"` | "思考中..." → 最终回复 |

---

## 6. 多租户隔离验证（Tenant Isolation）

### 6.1 数据隔离

| 检查项 | 方法 |
|--------|------|
| Bot 列表隔离 | 用户 A 的 API 不返回用户 B 的 bot |
| Channel 列表隔离 | 用户 A 的 API 不返回用户 B 的 channel |
| Session 列表隔离 | 用户 A 查不到用户 B 的 session |
| Artifact 列表隔离 | 用户 A 查不到用户 B 的 artifact |
| Bot 操作隔离 | 用户 A PATCH/DELETE 用户 B 的 botId → 404 |

### 6.2 Credential 隔离

| 检查项 | 方法 |
|--------|------|
| 加密存储 | DB 中 encryptedValue 不含明文 token |
| 跨用户不可读 | 用户 A 的 API 路径无法获取用户 B 的 credential |
| Config 隔离 | Pool config 仅包含属于该 pool 的 bot 的 credential |

### 6.3 Config 隔离

| 检查项 | 方法 |
|--------|------|
| Pool 边界 | pool-1 的 config 不含 pool-2 的 bot |
| Agent 列表 | config.agents.list 仅含该 pool 的 active bot |
| Channel accounts | config.channels.slack.accounts 仅含该 pool 的 connected channel |
| Binding 映射 | config.bindings 仅引用该 pool 的 agent + account |

---

## 7. 真实集群冒烟测试

> 针对 test 环境：`nexu.powerformer.net` / `nexu-api.powerformer.net`

### 7.1 Health Check

```bash
curl -s https://nexu-api.powerformer.net/health | jq .
# 预期：{"status": "ok", "metadata": {"commitHash": "..."}}
```

### 7.2 API 端到端

```bash
# 1. 登录获取 session cookie
# 2. 获取用户信息
curl -s -b cookies.txt https://nexu-api.powerformer.net/api/v1/me | jq .

# 3. 创建 bot
curl -s -X POST -b cookies.txt \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Bot","slug":"test-bot-smoke"}' \
  https://nexu-api.powerformer.net/api/v1/bots | jq .

# 4. 列表查询
curl -s -b cookies.txt https://nexu-api.powerformer.net/api/v1/bots | jq .

# 5. 删除 bot
curl -s -X DELETE -b cookies.txt \
  https://nexu-api.powerformer.net/api/v1/bots/{botId} | jq .
```

### 7.3 Gateway Config

```bash
curl -s -H "Authorization: Bearer ${INTERNAL_API_TOKEN}" \
  https://nexu-api.powerformer.net/api/internal/pools/{poolId}/config | jq .
# 预期：合法的 OpenClaw config JSON，可通过 openclawConfigSchema 验证
```

### 7.4 OpenClaw Gateway 连通性

```bash
# 检查 Gateway pod 是否响应
curl -s http://{podIp}:18789/
# TCP 连通即可，Gateway 控制面板应返回 HTML
```

---

## 8. AI 驱动的前端自动化测试

### 8.1 工具选型

| 工具 | Stars | 类型 | 语言 | 亮点 | 推荐 |
|------|-------|------|------|------|------|
| **[agent-browser](https://github.com/vercel-labs/agent-browser)** (Vercel) | 16.9k | CLI | Rust + TS | 亚毫秒解析，`@ref` 语义定位，~20K token/任务 | 主力方案 |
| **[Stagehand](https://github.com/browserbase/stagehand)** (Browserbase) | 21k | SDK | TypeScript | `act()`/`extract()` + Zod，自愈缓存 | 关键路径补充 |
| **[Lightpanda](https://github.com/lightpanda-io/browser)** | 11.9k | Headless Browser | Zig | 9x 省内存、11x 快于 Chrome，为 AI 设计 | 高并发压测 |
| **[Eko](https://github.com/FellouAI/eko)** (Fellou) | 4.9k | Framework | TypeScript | 自然语言 + JS 混合编排，一句话描述工作流 | 探索式测试 |
| **[HyperAgent](https://github.com/hyperbrowserai/HyperAgent)** | 1.1k | SDK | TypeScript | `page.ai()` + `page.extract()` Zod，MCP client | 备选 |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) (Microsoft) | — | MCP Server | TypeScript | accessibility tree，成熟稳定 | 备选（token 较高 ~114K/任务） |
| browser-use | 79k | SDK | Python | 需 Python 环境 | 不推荐 |
| Skyvern | 20k | SDK | Python | AGPL 协议 | 不推荐 |

### 8.2 推荐方案：agent-browser（主力） + Stagehand（补充）

**安装：**
```bash
# agent-browser — Rust 原生 CLI（Vercel 维护，Apache 2.0）
npm install -g agent-browser

# Stagehand — 自愈式关键路径测试（MIT）
pnpm add -D @browserbase/stagehand
```

**三层测试策略：**

**Layer 1 — agent-browser CLI（探索式测试 + 日常验证）：**
Rust 原生 CLI，亚毫秒解析。AI 通过 accessibility tree snapshot + `@ref` 引用（`@e1`, `@e2`...）操作页面元素，比 CSS selector 稳定得多。Token 消耗约 ~20K/任务。

```bash
# 获取页面 accessibility tree（结构化文本，非截图）
agent-browser snapshot https://nexu.io/auth
# 点击元素（语义引用，不依赖 DOM 结构）
agent-browser click @e5
# 填写表单
agent-browser fill @e12 "test@example.com"
# 按 ARIA role 语义查找元素
agent-browser find --role button --name "Sign in"
```

**Layer 2 — Stagehand（自愈式关键流程测试）：**
AI 首次运行时自动发现元素路径并缓存，后续运行直接复用无 LLM 调用。UI 变化时自动重新发现。

**Layer 3 — CI/CD 回归测试：**
由上两层生成的 `.spec.ts` 文件在 CI 中 headless 运行。零 LLM 开销，完全确定性。

**可选 — Lightpanda 替代 Chrome headless：**
高并发前端压测时，Lightpanda 替代 Chrome headless 可节省 9x 内存、提速 11x。兼容 CDP 协议，现有测试脚本无需修改。

### 8.3 前端测试用例

**Auth 流程：**

- [ ] 打开 `/auth` → 显示登录表单
- [ ] 输入邮箱 + 密码 → 登录成功 → 跳转到 workspace
- [ ] 未登录访问 `/workspace/*` → 重定向到 `/auth`
- [ ] Google OAuth 按钮可点击（跳转到 Google）

**Onboarding 流程：**

- [ ] 新用户首次登录 → 显示 onboarding 页面
- [ ] 步骤 1：填写角色/用例 → 下一步
- [ ] 步骤 2：Slack/Discord connect → 模态框打开 → 填写 token → 连接成功 → 卡片变绿
- [ ] Slack OAuth：点击按钮 → 跳转 Slack 授权 → 回调 → 回到 onboarding → 显示绿色
- [ ] 步骤完成 → 进入 workspace

**Channels 页面：**

- [ ] 显示已连接的 channel 列表
- [ ] 点击 Connect Slack → 模态框 → 填写 token → 连接成功
- [ ] 点击 Connect Discord → 模态框 → 填写 token → 连接成功
- [ ] 断开 channel → 从列表消失
- [ ] 刷新页面 → 已连接 channel 状态保持

**Sessions 页面：**

- [ ] 显示 session 列表
- [ ] 按 channelType 过滤
- [ ] 分页加载

**Bot 管理（如有 UI）：**

- [ ] 创建 bot → 显示在列表中
- [ ] 编辑 bot 名字 → 更新显示
- [ ] 暂停/恢复 bot → 状态变化
- [ ] 删除 bot → 从列表消失

### 8.4 Stagehand — 自愈式关键路径测试

适用于 UI 频繁变化的关键流程。TypeScript 原生，Zod schema 集成。首次运行 AI 发现元素路径并缓存，后续运行直接复用（零 LLM 调用）：

```typescript
import { Stagehand } from "@browserbase/stagehand";
import { z } from "zod";

const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();
await stagehand.page.goto("https://nexu.io/auth");

// AI 自动定位元素并操作（首次运行缓存路径）
await stagehand.act("click the email login tab");
await stagehand.act("type test@example.com in the email field");
await stagehand.act("type password123 in the password field");
await stagehand.act("click the sign in button");

// Zod schema 提取结构化数据验证
const result = await stagehand.extract({
  instruction: "extract the current page state",
  schema: z.object({
    pageTitle: z.string(),
    isLoggedIn: z.boolean(),
    userName: z.string().optional(),
  }),
});

assert(result.isLoggedIn === true);
```

### 8.5 Eko — 自然语言一句话工作流

适用于复杂多步骤场景的探索式测试，一句自然语言描述即可执行：

```typescript
import { eko } from "@eko-ai/eko";

// 一句话描述，Eko 自动拆解为多步骤执行
await eko.execute(
  "打开 nexu.io，登录 test@example.com，创建一个新 bot 叫 test-bot，截图保存"
);
```

---

## 9. AI 模拟消息测试（Slack/Discord 自动化验证）

> 通过 API 模拟真实用户发送消息，端到端验证 bot 的响应能力。

### 9.1 Slack 消息模拟

**方法 A — 直接调用 Slack API 发消息：**

```bash
# 以真实用户 token 发送消息到 bot 所在的 channel
curl -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer xoxb-user-token" \
  -H "Content-Type: application/json" \
  -d '{"channel":"C12345","text":"hello bot, what time is it?"}'
```

然后轮询检查 bot 是否回复：
```bash
# 等待 10 秒后读取 channel 历史
curl -s https://slack.com/api/conversations.history \
  -H "Authorization: Bearer xoxb-bot-token" \
  -d "channel=C12345&limit=5" | jq '.messages[0]'
```

**方法 B — 模拟 Slack webhook 事件：**

```typescript
// 直接构造 Slack event payload POST 到 /api/slack/events
// 需要用真实的 signing secret 签名
import crypto from "crypto";

const body = JSON.stringify({
  type: "event_callback",
  team_id: "T123",
  api_app_id: "A456",
  event: {
    type: "message",
    text: "hello bot",
    user: "U789",
    channel: "C12345",
    ts: "1709000000.000100",
  },
});

const timestamp = Math.floor(Date.now() / 1000).toString();
const sigBasestring = `v0:${timestamp}:${body}`;
const signature = `v0=${crypto
  .createHmac("sha256", SIGNING_SECRET)
  .update(sigBasestring)
  .digest("hex")}`;

const resp = await fetch("https://nexu-api.powerformer.net/api/slack/events", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-slack-request-timestamp": timestamp,
    "x-slack-signature": signature,
  },
  body,
});
// 验证：resp.status === 200，Gateway 收到转发
```

### 9.2 Discord 消息模拟

**方法 A — Discord Bot API 发消息：**

```bash
# 以另一个 bot 或 user token 发送消息
curl -X POST "https://discord.com/api/v10/channels/{channelId}/messages" \
  -H "Authorization: Bot {test-user-token}" \
  -H "Content-Type: application/json" \
  -d '{"content":"hello bot, tell me a joke"}'
```

轮询检查回复：
```bash
# 读取 channel 最近消息
curl -s "https://discord.com/api/v10/channels/{channelId}/messages?limit=5" \
  -H "Authorization: Bot {bot-token}" | jq '.[0]'
```

**方法 B — Discord Gateway 模拟（WebSocket）：**

```typescript
// 使用 discord.js 创建测试客户端，监听 bot 回复
import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.on("messageCreate", (msg) => {
  if (msg.author.bot && msg.content.includes("joke")) {
    console.log("Bot replied:", msg.content);
    // 断言 bot 回复了
  }
});

await client.login(TEST_USER_TOKEN);

// 发送测试消息
const channel = await client.channels.fetch(CHANNEL_ID);
await channel.send("hello bot, tell me a joke");

// 等待 bot 回复（timeout 30s）
```

### 9.3 端到端消息测试矩阵

| 场景 | 平台 | 发送 | 预期 | 验证方式 |
|------|------|------|------|---------|
| 基本对话 | Slack | "hello" | bot 回复 | 读取 channel 历史 |
| 基本对话 | Discord | "hello" | bot 回复 | 读取 channel 消息 |
| Web 搜索 | Slack | "搜索今天的新闻" | 回复包含搜索结果 | 检查回复内容含 URL |
| 代码执行 | Slack | "执行 echo hello" | 返回 sandbox 输出 | 检查回复含 "hello" |
| Cron 设置 | Slack | "每分钟发一条消息" | 定时消息出现 | 等待 2 分钟验证 |
| 长回复 | Discord | "写一篇 3000 字的文章" | 分多条发送 | 检查消息数 > 1 |
| Emoji 反应 | Slack | "给这条消息加个👍" | 消息出现 reaction | 检查 reaction |
| Thread 回复 | Slack | 在 thread 中发消息 | bot 在同一 thread 回复 | 检查 thread_ts |
| DM 对话 | Discord | 私信 bot | bot 私信回复 | 检查 DM channel |
| 多 bot 路由 | Slack | 在不同 workspace 发消息 | 各自的 bot 回复 | 检查回复 agent |

### 9.4 自动化测试脚本结构

```
tests/
├── e2e/
│   ├── slack-message.test.ts     # Slack 消息端到端
│   ├── discord-message.test.ts   # Discord 消息端到端
│   ├── slack-tools.test.ts       # Slack agent tools 验证
│   ├── discord-tools.test.ts     # Discord agent tools 验证
│   └── helpers/
│       ├── slack-client.ts       # Slack API 封装
│       ├── discord-client.ts     # Discord API 封装
│       └── wait-for-reply.ts     # 轮询等待 bot 回复
├── frontend/
│   ├── auth.spec.ts              # 登录流程
│   ├── onboarding.spec.ts       # Onboarding 流程
│   ├── channels.spec.ts         # Channel 管理
│   └── stagehand.config.ts      # Stagehand 配置
└── load/
    ├── k6-bots.js               # Bot API 负载
    ├── k6-slack-events.js       # Slack events 负载
    └── k6-config.js             # Config 生成负载
```

---

## 10. 测试优先级

| 优先级 | 类别 | 预计用例数 | 依赖 |
|--------|------|-----------|------|
| **P0** | 单元测试（crypto, schemas, 签名验证） | ~40 | 无 |
| **P1** | Config generator + pool service 扩展 | ~20 | 测试 DB |
| **P1** | Slack events 路由测试 | ~11 | 测试 DB + mock fetch |
| **P2** | Bot CRUD / Channel connect 路由 | ~30 | 测试 DB + mock auth + mock Slack/Discord API |
| **P2** | Session / Invite / OAuth state | ~20 | 测试 DB |
| **P3** | 压力测试（config 生成、加解密、并发写入） | ~10 | 测试 DB |
| **P3** | 多租户隔离验证 | ~12 | 测试 DB + mock auth |
| **P4** | Slack 能力验证 | ~25 | 真实 Slack workspace |
| **P4** | Discord 能力验证 | ~30 | 真实 Discord server |
| **P4** | AI 前端自动化测试 | ~15 | agent-browser + Stagehand + 部署环境 |
| **P4** | AI 模拟消息端到端 | ~10 | Slack/Discord token + 部署环境 |
| **P5** | 集群冒烟测试 / k6 负载测试 | ~5 | test 环境 + k6 |

**总计：约 228 个测试用例。**

---

## 11. 人工测试清单

以下测试项无法由 AI 自动完成，需要人工介入。

### 11.1 需要人工操作的原因分类

| 原因 | 说明 |
|------|------|
| **OAuth 授权流程** | 需要人在浏览器中登录第三方账户、点击授权按钮，涉及真实账户凭据 |
| **真实平台账户管理** | 创建/配置 Slack workspace、Discord server、邀请成员等平台级操作 |
| **主观质量判断** | 评估 bot 回复的质量、语气、上下文连贯性等无法用断言量化的指标 |
| **付费/权限操作** | 涉及 Slack Enterprise Grid、Discord Nitro 等付费功能的验证 |
| **物理环境依赖** | 移动端推送通知、桌面通知弹窗等需要真实设备的场景 |
| **安全审计** | 渗透测试、凭据轮换验证等需要人工判断风险的操作 |

### 11.2 Slack 人工测试项

| 测试项 | 说明 | 为什么不能自动化 |
|--------|------|-----------------|
| Slack OAuth 授权流程 | 从 Nexu 点击 "Add to Slack" → Slack 授权页 → 选择 workspace → 回调 | 需要真人登录 Slack 账户并点击 "Allow" |
| Slack workspace 创建 | 为测试创建独立的 Slack workspace | 需要邮箱验证 + 人工操作 |
| Bot 安装权限审查 | 检查 OAuth scopes 是否最小化、安装提示是否清晰 | 主观判断 |
| 移动端消息通知 | Slack 移动 app 上收到 bot 回复的推送通知 | 需要真实移动设备 |
| 回复质量评估 | bot 在不同场景下回复是否自然、准确、有帮助 | 主观质量判断 |
| Slack Connect (跨组织) | 在 Slack Connect channel 中 bot 是否正常工作 | 需要两个真实组织 |
| Enterprise Grid 多 workspace | Enterprise Grid 环境下 bot 跨 workspace 行为 | 需要付费 Enterprise 账户 |

### 11.3 Discord 人工测试项

| 测试项 | 说明 | 为什么不能自动化 |
|--------|------|-----------------|
| Discord OAuth2 授权流程 | 从 Nexu 添加 Discord bot → Discord 授权页 → 选择 server → 授权 | 需要真人登录 Discord 账户 |
| Bot 权限配置 | 在 Discord Developer Portal 配置 bot 的 Privileged Gateway Intents | 需要人工在网页操作 |
| Server 创建与配置 | 创建测试 server、设置角色权限层级 | 需要人工在 Discord 客户端操作 |
| Voice channel 加入/离开 | bot 在语音频道的行为（如有语音功能） | 需要真实语音设备 |
| 移动端消息通知 | Discord 移动 app 推送通知 | 需要真实移动设备 |
| Stage channel 演讲模式 | bot 在 Stage channel 中的行为 | 需要人工举手/邀请发言 |

### 11.4 前端人工测试项

| 测试项 | 说明 | 为什么不能自动化 |
|--------|------|-----------------|
| 视觉回归 | UI 布局、颜色、间距是否符合设计稿 | 需要人眼对比设计稿 |
| 响应式体验 | 不同屏幕尺寸下的实际使用体验 | 自动化只能检测布局不能评估体验 |
| 无障碍可用性 | 屏幕阅读器实际朗读效果、键盘导航顺畅度 | 需要真人使用辅助技术体验 |
| 首次用户体验 | 新用户 onboarding 的引导是否清晰、直觉 | 主观体验判断 |
| 多浏览器兼容性 | Safari/Firefox/Edge 各版本的实际渲染效果 | 自动化难以覆盖所有浏览器版本组合 |
| 暗色模式（如有） | 暗色主题下所有页面的可读性 | 需要人眼判断对比度 |

### 11.5 运维人工测试项

| 测试项 | 说明 | 为什么不能自动化 |
|--------|------|-----------------|
| 生产环境部署验证 | 部署后的冒烟检查 + 日志监控 | 需要人工确认无异常 |
| 凭据轮换 | 更换 Slack/Discord token 后系统行为 | 涉及真实凭据操作 |
| 灾难恢复演练 | 数据库恢复、Gateway 全量重启 | 需要人工决策和监控 |
| 安全漏洞评估 | OWASP 检查、依赖漏洞审查 | 需要安全专家判断修复优先级 |
| 费用监控 | LLM API 调用费用、基础设施成本 | 需要人工审查账单 |

---

## 12. Mock 策略

### 12.1 外部 API Mock

| 外部服务 | Mock 方式 | 说明 |
|---------|----------|------|
| Slack API (auth.test, bots.info, oauth.v2.access) | `vi.fn()` mock `fetch` | 返回预定义的 JSON 响应 |
| Discord API | `vi.fn()` mock `fetch` | 返回预定义的 JSON 响应 |
| Resend (email) | `vi.fn()` mock `sendEmail` | 验证调用参数，不真发邮件 |
| Gateway 转发 | `vi.fn()` mock `fetch` | 拦截 `http://{podIp}:18789/...` 调用 |

### 12.2 Auth — API Key 优先（推荐）

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

### 12.3 数据库 — PGlite 内存实例

全局 test setup 自动替换为 PGlite，测试代码中无需手动管理连接：

```typescript
// test/setup.ts 已通过 vi.mock 注入 PGlite（见基础设施章节）
// 测试直接 import { db } from "../db/index.js" 即可，拿到的是内存实例
```

---

## 13. CI 集成

> PGlite 内存 DB + API Key 认证 = 零外部依赖，无需 Docker services。

```yaml
# .github/workflows/test.yml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - run: pnpm install
    - run: pnpm test
      env:
        ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        GATEWAY_TOKEN: "test-gw-token"
        INTERNAL_API_TOKEN: "test-internal-token"
```

**对比之前的方案：**

| | PGlite + API Key | 传统方案 |
|--|-------------------|---------|
| CI 配置 | 3 步（checkout → install → test） | 需要 `services.postgres` + 端口映射 |
| 环境变量 | 3 个 | 4 个（多一个 TEST_DATABASE_URL） |
| 启动时间 | 无 DB 启动等待 | 等待 PG 健康检查 |
| 本地运行 | `pnpm test` 即可 | 需先启动 PG 容器 |
| 云端 CI | 直接跑 | 需要 Docker-in-Docker 或 service container |
