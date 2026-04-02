# Cloud 本地开发配置与启动流程

## 概述
Nexu Cloud 是一个 pnpm monorepo，由 API 服务（Hono）、Web 应用（React + Vite）和共享库组成。本地开发使用 PM2 进行进程管理，并支持 Nexu Desktop 本地集成模式。

---

## 1. 项目结构

```
cloud/
├── apps/
│   ├── api/                    # Hono API server (Node.js)
│   │   ├── src/
│   │   │   ├── index.ts       # Entry point
│   │   │   ├── app.ts         # App initialization
│   │   │   ├── auth.ts        # Auth configuration
│   │   │   ├── routes/        # API routes (auth, credit, reward)
│   │   │   ├── middleware/    # Auth, logging, error handling
│   │   │   ├── services/      # Business logic (credit, reward)
│   │   │   ├── db/            # Drizzle schema, migrations
│   │   │   └── lib/           # Utilities (logger, crypto, trace)
│   │   ├── package.json       # Dependencies
│   │   └── tsconfig.build.json
│   └── web/                    # React 19 + Vite frontend
│       ├── src/
│       ├── e2e/               # Playwright tests
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   └── shared/                # Zod schemas, shared types
├── package.json               # Root workspace
├── ecosystem.config.cjs        # PM2 configuration
├── docker-compose.yml         # Database (PostgreSQL 5433)
└── .env files (per-app)
```

---

## 2. 启动命令

### 方式 A：简化并发启动（推荐）
```bash
pnpm dev
```
启动并发进程，运行：
- `pnpm --filter @nexu-cloud/api dev` (TSC watch + Hono)
- `pnpm --filter @nexu-cloud/web dev` (Vite dev server)

### 方式 B：PM2 管理（强大的进程管理）
```bash
# 启动
pm2 start ecosystem.config.cjs

# 查看状态
pm2 status

# 查看日志
pm2 logs nexu-api --lines 50 --nostream
pm2 logs nexu-web --lines 50 --nostream

# 重启并加载新环境变量
pm2 restart ecosystem.config.cjs --update-env

# 清理
pm2 delete nexu-api nexu-web
```

### 方式 C：分别启动（调试单个服务）
```bash
# API only
pnpm --filter @nexu-cloud/api dev

# Web only
pnpm --filter @nexu-cloud/web dev
```

---

## 3. 环境变量配置

### 3.1 API 环境变量 (`apps/api/.env`)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `postgresql://nexu:nexu@localhost:5433/nexu_dev` | PostgreSQL 连接字符串 |
| `BETTER_AUTH_SECRET` | `nexu-dev-secret-change-in-production` | 认证密钥 |
| `BETTER_AUTH_URL` | `http://localhost:3000` | 认证服务 URL |
| `PORT` | `3000` | API 服务端口 |
| `WEB_URL` | `http://localhost:5173` | Web 前端 URL（`.env.example` 中是 5173，`.env` 中配的是 5176） |
| `NEXU_DESKTOP_MODE` | `true` | Desktop 本地模式开关 |
| `ENCRYPTION_KEY` | `0123456789abcdef...` | AES-256-GCM 加密密钥 |
| `RESEND_API_KEY` | (空) | Email 服务 API 密钥 |
| `EMAIL_SENDER` | `Nexu <noreply@nexu.io>` | 邮件发送者 |
| `GOOGLE_CLIENT_ID` | (空) | OAuth 配置 |
| `GOOGLE_CLIENT_SECRET` | (空) | OAuth 配置 |
| `TURNSTILE_SECRET_KEY` | (空) | Cloudflare Turnstile 密钥 |
| `COOKIE_DOMAIN` | (空) | 跨域 Cookie 设置（如 `.nexu.io`） |

### 3.2 Web 环境变量 (`apps/web/.env.local`)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_API_BASE_URL` | `http://localhost:3000` | API 基础 URL |
| `VITE_AUTH_BASE_URL` | `http://localhost:3000/api/auth` | 认证端点 |
| `VITE_AMPLITUDE_API_KEY` | (空) | 分析 API 密钥 |
| `VITE_TURNSTILE_SITE_KEY` | (空) | Cloudflare Turnstile 网站密钥 |
| `VITE_ENABLE_DESKTOP_AUTH_FALLBACK` | `true` | Desktop 本地认证回落 |

---

## 4. 端口映射

| 服务 | 端口 | 说明 |
|------|------|------|
| Web (Vite) | `5173` | React 前端开发服务器 |
| API | `3000` | Hono API 服务器 |
| PostgreSQL | `5433` | 数据库（docker-compose） |

---

## 5. 启动流程详解

### 5.1 `pnpm dev` 流程

```
pnpm dev
  ├─ NODE_OPTIONS=--conditions=development
  ├─ concurrently (并发启动)
  │  ├─ API: pnpm --filter @nexu-cloud/api dev
  │  │   ├─ tsc -p tsconfig.build.json -w (类型检查 + 监视)
  │  │   └─ node --watch --conditions=development --import tsx dist/index.js
  │  │       ├─ loadEnv() (加载 .env)
  │  │       ├─ waitForDatabase() (连接 PostgreSQL，最多 10 次重试)
  │  │       ├─ warmupDesktopAuth() (预加载 Desktop 用户)
  │  │       ├─ createApp() (初始化 Hono + 注册路由)
  │  │       └─ serve() (监听 3000 端口)
  │  │
  │  └─ Web: pnpm --filter @nexu-cloud/web dev
  │      ├─ vite (启动 Vite dev server)
  │      ├─ React HMR (热更新)
  │      ├─ 代理规则:
  │      │   ├─ /v1/* → http://localhost:3000
  │      │   ├─ /api/* → http://localhost:3000
  │      │   └─ /openapi.json → http://localhost:3000
  │      └─ 监听 5173 端口
```

### 5.2 PM2 启动流程 (`ecosystem.config.cjs`)

```
pm2 start ecosystem.config.cjs
  ├─ nexu-api (scripts/pm2-api-wrapper.cjs)
  │   ├─ watch: apps/api/src, packages/shared/src
  │   ├─ wait_ready: true (等待 process.send('ready'))
  │   ├─ listen_timeout: 20s
  │   ├─ max_memory_restart: 1G
  │   ├─ 日志: logs/api-{error,out}.log
  │   └─ 执行: node scripts/pm2-api-wrapper.cjs
  │
  └─ nexu-web (pnpm wrapper)
      ├─ args: --filter @nexu-cloud/web dev
      ├─ watch: false
      ├─ max_restarts: 0
      ├─ 日志: logs/web-{error,out}.log
      └─ 执行: pnpm --filter @nexu-cloud/web dev
```

---

## 6. 数据库初始化

### 6.1 启动 PostgreSQL

```bash
# 用 docker-compose 启动数据库
docker-compose up -d

# 验证连接
psql -h localhost -p 5433 -U nexu -d nexu_dev
```

### 6.2 数据库迁移

```bash
# 生成新迁移（编辑 apps/api/src/db/schema/index.ts 后）
pnpm db:generate --name <migration-name>

# 应用迁移
pnpm db:migrate

# 推送 schema 到数据库（快速开发用）
pnpm db:push

# 检查迁移同步状态
pnpm db:check-sync

# 种子数据（开发环境）
pnpm seed
```

### 6.3 本地联调测试

Cloud 提供了专用的 DB 测试脚本验证后端链路（不经过 HTTP）：

```bash
# 在事务中执行两次积分发放，测试幂等性
tsx apps/api/db-test/credit-grant.ts --email <user@example.com>

# 可选参数
tsx apps/api/db-test/credit-grant.ts \
  --email <user@example.com> \
  --amount 1000 \
  --source-type test \
  --idempotency-key test-key-001 \
  --verbose
```

---

## 7. Desktop 本地集成

### 7.1 Desktop 认证流程

Cloud 在 `apps/api/src/middleware/desktop-auth.ts` 中实现了 Desktop 认证回落机制：

1. **优先级解析**：
   - 查找 `desktop@nexu.local` 用户（Bootstrap 用户）
   - 若无，使用数据库中第一个用户
   - 若无，创建回落用户 `desktop@localhost`

2. **应用场景**：
   - Desktop 本地模式（`NEXU_DESKTOP_MODE=true`）
   - Web 通过 Vite 代理与 API 通信（无跨域限制）
   - API `/api/v1/*` 路由自动注入 Desktop 用户上下文

3. **设备授权端点**（在 Nexu 中注册，Cloud 中调用）：
   - `POST /api/auth/device-register` — Desktop 注册（步骤 1）
   - `POST /api/auth/device-poll` — 轮询授权结果（步骤 3）
   - `POST /api/v1/auth/desktop-authorize` — 浏览器授权后绑定设备（步骤 2，需登录）

### 7.2 环境变量启用

在 `apps/api/.env` 中：
```
NEXU_DESKTOP_MODE=true
```

在 `apps/web/.env.local` 中：
```
VITE_ENABLE_DESKTOP_AUTH_FALLBACK=true
```

---

## 8. API 设计模式

### 8.1 路由注册

所有路由使用 `@hono/zod-openapi`：

```typescript
export function registerDesktopDeviceRoutes(app: OpenAPIHono<AppBindings>) {
  // 步骤 1: Desktop 注册
  app.post("/api/auth/device-register", async (c) => {
    const body = await c.req.json<{ deviceId?: string; deviceSecretHash?: string }>();
    // ... 处理逻辑
    return c.json({ ok: true });
  });

  // 步骤 3: 轮询
  app.post("/api/auth/device-poll", async (c) => {
    const body = await c.req.json<{ deviceId?: string; deviceSecret?: string }>();
    // ... 处理逻辑
    return c.json({ status: "pending" | "completed" | "expired" });
  });
}
```

### 8.2 中间件顺序

```typescript
// 在 apps/api/src/app.ts 中：
app.use("*", requestTraceMiddleware);      // 请求追踪
app.use("*", requestLoggerMiddleware);     // 日志
app.use("*", errorMiddleware);             // 错误处理
app.use("*", cors({ origin: WEB_URL, credentials: true }));

registerDesktopDeviceRoutes(app);          // ❌ 不需要认证
registerAuthRoutes(app);

app.use("/api/v1/*", authMiddlewareChain); // ✅ 需要认证
registerRewardRoutes(app);
registerCreditRoutes(app);
registerUserRoutes(app);
```

---

## 9. 类型生成与 SDK

### 9.1 生成类型和 SDK

```bash
# 从 OpenAPI spec 生成前端 SDK
pnpm generate-types

# 输出：
# - apps/api/dist/openapi.json
# - apps/web/lib/api/sdk.gen.ts (TypeScript SDK)
# - apps/web/lib/api/types.gen.ts (TypeScript 类型)
```

### 9.2 前端调用 API

```typescript
import { nexuCloudSDK } from "@/lib/api/sdk.gen";

// 使用生成的 SDK（完全类型安全）
const response = await nexuCloudSDK.post("/api/v1/auth/desktop-authorize", {
  body: { deviceId: "..." },
});
```

---

## 10. 文件监视与热更新

### 10.1 API 监视

PM2 配置：
- **监视目录**：`apps/api/src`, `packages/shared/src`
- **忽略目录**：`node_modules`, `apps/api/dist`, 测试文件
- **重启条件**：修改源文件后自动重启

`pnpm dev` 中：
- `tsc -w` 实时编译
- `node --watch` 监视 JS 变化并重启

### 10.2 Web 监视

Vite HMR：
- 编辑 `.tsx` / `.css` 文件后自动热更新
- 无需刷新浏览器

---

## 11. 故障排查

### 问题：API 无法连接数据库

```bash
# 检查数据库服务
docker-compose ps

# 手动测试连接
psql -h localhost -p 5433 -U nexu -d nexu_dev -c "SELECT 1"

# 检查 DATABASE_URL
echo $DATABASE_URL

# 查看 API 日志
pm2 logs nexu-api
```

### 问题：Web 无法访问 API

```bash
# 验证代理配置 (apps/web/vite.config.ts)
# 检查 API 是否运行在 3000
curl -s http://localhost:3000/health | jq .

# 检查 CORS 配置
curl -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -X OPTIONS http://localhost:3000/api/auth/login -v
```

### 问题：Port 被占用

```bash
# 查看占用 3000 的进程
lsof -i :3000

# 查看占用 5173 的进程
lsof -i :5173

# 强制杀死
kill -9 <PID>

# 或用 PM2 清理
pm2 delete nexu-api nexu-web
```

### 问题：Desktop 认证失败

```bash
# 检查 NEXU_DESKTOP_MODE
grep NEXU_DESKTOP_MODE apps/api/.env

# 检查 Desktop 用户是否已创建
psql -h localhost -p 5433 -U nexu -d nexu_dev \
  -c "SELECT id, name, email FROM \"user\" LIMIT 5"

# 查看认证中间件日志
pm2 logs nexu-api | grep desktop
```

---

## 12. 常见命令速查

| 任务 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 启动 API + Web | `pnpm dev` |
| 启动 API only | `pnpm --filter @nexu-cloud/api dev` |
| 启动 Web only | `pnpm --filter @nexu-cloud/web dev` |
| PM2 启动 | `pm2 start ecosystem.config.cjs` |
| PM2 状态 | `pm2 status` |
| PM2 日志 | `pm2 logs nexu-api --lines 50` |
| 类型检查 | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Lint 修复 | `pnpm lint:fix` |
| 生成 SDK | `pnpm generate-types` |
| 数据库迁移 | `pnpm db:migrate` |
| 种子数据 | `pnpm seed` |
| 积分联调测试 | `tsx apps/api/db-test/credit-grant.ts --email <email>` |
| 类型检查（单个应用） | `pnpm --filter @nexu-cloud/api typecheck` |
| 测试（Web） | `pnpm --filter @nexu-cloud/web test` |
| E2E 测试（Web） | `pnpm --filter @nexu-cloud/web exec playwright test` |

---

## 总结

Cloud 本地开发的核心特点：

1. **双启动方式**：`pnpm dev`（简单）或 PM2（完整管理）
2. **Desktop 集成**：通过 `NEXU_DESKTOP_MODE` 启用本地认证回落
3. **开发友好**：文件监视、HMR、自动重启
4. **类型安全**：完整的 OpenAPI → SDK 生成链
5. **数据库支持**：Drizzle ORM + 迁移管理
6. **本地联调**：DB 测试脚本验证后端链路（不经 HTTP）

通过理解这些配置和流程，可以高效地在本地开发 Cloud 和 Nexu 的集成功能。
