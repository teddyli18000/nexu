# AI 驱动的 E2E 自动化测试

> 返回 [测试总览](../TESTING.md)

## 1. 前端自动化 — 工具选型

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

## 2. 推荐方案：agent-browser（主力） + Stagehand（补充）

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

## 3. 前端测试用例

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

## 4. Stagehand — 自愈式关键路径测试

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

## 5. Eko — 自然语言一句话工作流

适用于复杂多步骤场景的探索式测试，一句自然语言描述即可执行：

```typescript
import { eko } from "@eko-ai/eko";

// 一句话描述，Eko 自动拆解为多步骤执行
await eko.execute(
  "打开 nexu.io，登录 test@example.com，创建一个新 bot 叫 test-bot，截图保存"
);
```

---

## 6. AI 模拟消息测试（Slack/Discord 自动化验证）

> 通过 API 模拟真实用户发送消息，端到端验证 bot 的响应能力。

### 6.1 Slack 消息模拟

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

### 6.2 Discord 消息模拟

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

### 6.3 端到端消息测试矩阵

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

### 6.4 自动化测试脚本结构

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
