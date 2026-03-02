# 单元测试 & 集成测试用例

> 返回 [测试总览](../TESTING.md)

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

使用 PGlite 内存数据库运行，全局 test setup 自动注入（见 [测试总览](../TESTING.md)）。

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
