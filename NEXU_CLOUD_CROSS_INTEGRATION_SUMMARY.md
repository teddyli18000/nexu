# Nexu-Cloud 本地联调配置 — 交叉验证与汇总

## 概览

本文档总结了 Nexu 和 Cloud 两个项目在本地开发环境中的集成配置。两个项目通过 **设备授权流程** 和 **API 代理** 实现无缝的本地联调。

---

## 1. 双项目启动架构

### 1.1 独立启动

**Nexu 项目**（Desktop-First）
```bash
cd /Users/qiyuan/Documents/Code/anthhub/ai/refly-team/nexu
pnpm install
pnpm start              # 启动完整桌面栈（Electron + Controller + Web + OpenClaw）
# 或
pnpm dev                # 启动 Controller + Web（用于快速开发）
```

**Cloud 项目**（API-First）
```bash
cd /Users/qiyuan/Documents/Code/anthhub/ai/refly-team/cloud
pnpm install
pnpm dev                # 启动 API + Web（并发）
# 或
pm2 start ecosystem.config.cjs  # 使用 PM2 管理进程
```

### 1.2 并行启动用于集成测试

在**同一终端会话**中打开多个 tmux 窗口：

```bash
# 窗口 1: Nexu
cd nexu && pnpm start

# 窗口 2: Cloud  
cd cloud && pnpm dev

# 窗口 3: 测试
# 验证两个服务是否就绪
curl http://localhost:3000/health        # Cloud API
curl http://localhost:3010/health        # Nexu Controller
```

---

## 2. 端口映射全景

| 服务 | 项目 | 端口 | 启动模式 | 说明 |
|------|------|------|---------|------|
| Web (Nexu) | nexu | 5173 | Vite | Nexu 前端开发服务器 |
| Web (Cloud) | cloud | 5173 | Vite | Cloud 前端开发服务器 |
| Controller | nexu | 3010 / 50800 | Hono | Nexu 本地控制平面 |
| API (Cloud) | cloud | 3000 | Hono | Cloud API 服务器 |
| OpenClaw Gateway | nexu | 18789 | Internal | 本地运行时管理 |
| PostgreSQL | shared | 5433 | docker-compose | 共享数据库 |

**注意**：两个项目的 Web 都想用 5173，需要**错开启动时间**或修改其中一个的端口。

---

## 3. 设备授权流程（跨项目集成点）

### 3.1 4 步流程

```
┌─────────────┐         ┌──────────────┐         ┌─────────┐
│   Nexu      │         │   Cloud      │         │ Browser │
│ (Desktop)   │         │   (API)      │         │         │
└─────────────┘         └──────────────┘         └─────────┘
       │                        │                      │
       │  1. Register Device    │                      │
       │─────────────────────→  │                      │
       │ POST /api/auth/device-register                │
       │ { deviceId, deviceSecretHash }               │
       │                        │                      │
       │  (生成授权链接)         │                      │
       │                        │                      │
       │  2. 打开浏览器         │                      │
       │─────────────────────────────────────────────→ │
       │                        │                      │
       │                        │   用户登录           │
       │                        │ ←─────────────────── │
       │                        │                      │
       │  3. 前端授权           │                      │
       │ ←──────────────────────────────────────────── │
       │ 调用 POST /api/v1/auth/desktop-authorize      │
       │ { deviceId }                                  │
       │─────────────────────→  │                      │
       │ (需要登录 + 有效会话)    │                      │
       │                        │                      │
       │  响应: { ok: true }     │                      │
       │ ←─────────────────────  │                      │
       │                        │                      │
       │  4. 轮询授权结果       │                      │
       │─────────────────────→  │                      │
       │ POST /api/auth/device-poll                    │
       │ { deviceId, deviceSecret }                    │
       │                        │                      │
       │  响应: {                │                      │
       │    status: "completed",│                      │
       │    apiKey: "nxk_...",  │                      │
       │    userId: "...",      │                      │
       │    userName: "..."     │                      │
       │  }                     │                      │
       │ ←─────────────────────  │                      │
       │                        │                      │
```

### 3.2 关键端点

#### 在 Cloud API 中（`apps/api/src/routes/desktop-auth-routes.ts`）

| 端点 | 步骤 | 方法 | 认证 | 说明 |
|------|------|------|------|------|
| `/api/auth/device-register` | 1 | POST | ❌ | Desktop 客户端注册设备 |
| `/api/v1/auth/desktop-authorize` | 2 | POST | ✅ (浏览器登录) | 浏览器授权并绑定设备 |
| `/api/auth/device-poll` | 3 | POST | ❌ | Desktop 轮询授权结果 |

#### 在 Nexu Controller 中（调用端）

- `apps/controller/src/routes/auth/device-auth-routes.ts` — 实现 Desktop 设备授权流程

### 3.3 关键数据结构

**deviceAuthorizations 表**（Cloud）：
```sql
CREATE TABLE device_authorizations (
  pk SERIAL PRIMARY KEY,
  id VARCHAR UNIQUE,
  deviceId VARCHAR,
  deviceSecretHash VARCHAR,
  status VARCHAR,  -- 'pending' | 'completed' | 'consumed'
  encryptedApiKey TEXT,  -- 加密的 API 密钥
  userId VARCHAR,        -- Better Auth user ID
  expiresAt TIMESTAMP    -- 5 分钟后过期
);
```

**apiKeys 表**（Cloud）：
```sql
CREATE TABLE api_keys (
  pk SERIAL PRIMARY KEY,
  id VARCHAR UNIQUE,
  userId VARCHAR,
  keyPrefix VARCHAR,     -- "nxk_" 前缀用于识别
  keyHash VARCHAR,       -- bcrypt 哈希（Link 兼容）
  createdAt TIMESTAMP
);
```

---

## 4. API URL 配置策略

### 4.1 本地开发配置

| 项目 | 设置位置 | 配置项 | 值 | 用途 |
|------|---------|--------|-----|------|
| Nexu Controller | `apps/controller/src/app/env.ts` | `CLOUD_API_URL` | TBD | 调用 Cloud API（注册、授权、积分查询） |
| Cloud API | `apps/api/.env` | `NEXU_DESKTOP_MODE` | `true` | 启用 Desktop 本地认证回落 |
| Cloud Web | `apps/web/.env.local` | `VITE_API_BASE_URL` | `http://localhost:3000` | 访问 Cloud API |
| Nexu Web | `apps/web/vite.config.ts` | proxy 规则 | `/api → localhost:3000` | 经 Vite 代理访问 Controller |

### 4.2 API 调用链

```
Nexu Controller
    ↓ (HTTP Client)
    └─→ POST /api/auth/device-register        (Cloud API)
    └─→ POST /api/auth/device-poll            (Cloud API)
    └─→ POST /api/v1/auth/desktop-authorize   (Cloud API)
    └─→ GET /api/v1/rewards/status            (Cloud API)
    └─→ POST /api/v1/rewards/claim            (Cloud API)

Nexu Web
    ↓ (Vite 代理)
    └─→ Vite proxy /api → localhost:3000      (Controller)

Cloud Web
    ↓ (API 代理)
    └─→ POST /api/auth/device-register        (Cloud API @ 3000)
    └─→ POST /api/v1/auth/desktop-authorize   (Cloud API @ 3000)
```

---

## 5. 本地联调工作流

### 5.1 初次设置（一次性）

```bash
# 1. 启动数据库
cd cloud
docker-compose up -d

# 2. 创建和初始化数据库
pnpm seed

# 3. 验证 Cloud API 就绪
curl http://localhost:3000/health
# 期望: { "status": "ok", "metadata": { "commitHash": null } }
```

### 5.2 日常开发流程

```bash
# 终端 1: Nexu 启动
cd nexu
pnpm install
pnpm start

# 终端 2: Cloud 启动
cd cloud
pnpm dev

# 终端 3: 测试集成
# 打开浏览器访问 http://localhost:5173（Nexu Web）
# 点击 "Login with Cloud" 或 Device Authorization
# 会重定向到 Cloud Web（http://localhost:5173 的另一实例或 Cloud Web）
```

### 5.3 验证集成

#### A. 验证 Device Authorization 流程

```bash
# 模拟 Nexu Desktop 注册设备
deviceId="test-device-$(date +%s)"
deviceSecret="test-secret-123"
deviceSecretHash=$(echo -n "$deviceSecret" | sha256sum | cut -d' ' -f1)

# 步骤 1: Desktop 注册
curl -X POST http://localhost:3000/api/auth/device-register \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\": \"$deviceId\", \"deviceSecretHash\": \"$deviceSecretHash\"}"
# 期望: { "ok": true }

# 步骤 3: 轮询（应返回 pending，因为未授权）
curl -X POST http://localhost:3000/api/auth/device-poll \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\": \"$deviceId\", \"deviceSecret\": \"$deviceSecret\"}"
# 期望: { "status": "pending" }
```

#### B. 验证 API 代理

```bash
# 从 Nexu Web 代理访问 Controller
curl -X GET http://localhost:5173/health
# 期望: Vite 代理 → localhost:3000 的 Controller health 端点
```

#### C. 验证数据库连接

```bash
# Cloud API 数据库
psql -h localhost -p 5433 -U nexu -d nexu_dev \
  -c "SELECT COUNT(*) FROM device_authorizations"

# 查看当前用户
psql -h localhost -p 5433 -U nexu -d nexu_dev \
  -c "SELECT id, email FROM \"user\" LIMIT 5"
```

---

## 6. 环境变量校验清单

### 6.1 Nexu 项目

- [ ] `.env` (或 workspace root) 中 `DATABASE_URL` 指向 localhost:5433
- [ ] `CLOUD_API_URL` 已设置（如果有的话）
- [ ] `WEB_URL=http://localhost:5173`
- [ ] 如果使用 Desktop，`OPENCLAW_STATE_DIR` 已配置

### 6.2 Cloud 项目

- [ ] `apps/api/.env` 中 `DATABASE_URL` 指向 localhost:5433
- [ ] `NEXU_DESKTOP_MODE=true`
- [ ] `WEB_URL=http://localhost:5173`（`.env.example` 中是 5173，`.env` 中可能是 5176，需统一）
- [ ] `BETTER_AUTH_URL=http://localhost:3000`

### 6.3 共享资源

- [ ] PostgreSQL 运行在 localhost:5433（docker-compose）
- [ ] 数据库 `nexu_dev` 存在
- [ ] 迁移已应用（`pnpm db:migrate` 或 `pnpm db:push`）

---

## 7. 常见集成问题

### 问题 1：设备授权返回 404

**症状**：`POST /api/auth/device-register` 返回 404

**原因**：端点未在 Cloud API 中注册

**排查**：
```bash
# 检查路由是否注册
curl -I http://localhost:3000/api/auth/device-register
# 期望: 405 (Method Not Allowed) 或 200 (POST 接受)

# 查看 API 日志
pm2 logs nexu-api | grep "device-register"
```

### 问题 2：Cross-Origin 错误

**症状**：前端无法访问 API（CORS 错误）

**原因**：API CORS 配置不当或 `WEB_URL` 不匹配

**排查**：
```typescript
// 在 apps/api/src/app.ts 中检查：
cors({
  origin: process.env.WEB_URL ?? "http://localhost:5173",
  credentials: true,
})

// 验证：
curl -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -X OPTIONS http://localhost:3000/api/auth/login -v
```

### 问题 3：数据库连接超时

**症状**：API 启动失败，`waitForDatabase` 重试

**原因**：PostgreSQL 未启动或连接字符串错误

**排查**：
```bash
# 检查容器状态
docker-compose ps

# 手动测试连接
psql -h localhost -p 5433 -U nexu -d nexu_dev -c "SELECT 1"

# 查看 API 日志
pm2 logs nexu-api | grep "database"
```

### 问题 4：端口冲突（5173）

**症状**：`pnpm dev` 失败，说 5173 被占用

**原因**：两个项目都想用 5173

**解决**：
```bash
# 方案 A: 错开启动（先启 Nexu Web，再启 Cloud Web）
# 方案 B: 修改其中一个的端口
# vite.config.ts:
export default defineConfig({
  server: {
    port: 5174,  // 改用 5174
  },
});
```

---

## 8. 性能优化与最佳实践

### 8.1 加快本地启动

```bash
# A. 使用缓存的 OpenClaw runtime（已在 Nexu 中配置）
export OPENCLAW_CACHE_DIR=~/.openclaw-cache
pnpm start

# B. 并行依赖安装（pnpm 已默认）
pnpm install --parallel

# C. 避免全量类型检查（仅用于 CI）
# 本地开发仅检查修改的包：
pnpm --filter @nexu/web typecheck
```

### 8.2 调试最佳实践

```bash
# 使用 NODE_DEBUG 查看网络调用
NODE_DEBUG=http pnpm --filter @nexu-cloud/api dev

# 使用 DEBUG 环境变量启用特定模块日志
DEBUG=nexu:* pnpm start

# PM2 中启用详细日志
pm2 start ecosystem.config.cjs --verbose
```

---

## 9. 集成测试脚本示例

### 9.1 完整的 Device Authorization 测试

```bash
#!/bin/bash
# scripts/test-device-auth.sh

set -e

CLOUD_API="http://localhost:3000"
DEVICE_ID="test-device-$(date +%s)"
DEVICE_SECRET="test-secret-$(date +%s)"
DEVICE_SECRET_HASH=$(echo -n "$DEVICE_SECRET" | sha256sum | cut -d' ' -f1)

echo "Testing Device Authorization Flow..."

# 步骤 1: 注册设备
echo "[1/3] Registering device..."
REGISTER_RESPONSE=$(curl -s -X POST "$CLOUD_API/api/auth/device-register" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\": \"$DEVICE_ID\", \"deviceSecretHash\": \"$DEVICE_SECRET_HASH\"}")

echo "Register response: $REGISTER_RESPONSE"

# 步骤 3: 轮询（应返回 pending）
echo "[2/3] Polling authorization..."
POLL_RESPONSE=$(curl -s -X POST "$CLOUD_API/api/auth/device-poll" \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\": \"$DEVICE_ID\", \"deviceSecret\": \"$DEVICE_SECRET\"}")

echo "Poll response: $POLL_RESPONSE"

STATUS=$(echo "$POLL_RESPONSE" | jq -r '.status')
if [ "$STATUS" = "pending" ]; then
  echo "[3/3] ✅ Device authorization flow works!"
  exit 0
else
  echo "[3/3] ❌ Unexpected status: $STATUS"
  exit 1
fi
```

### 9.2 运行测试

```bash
# 确保两个服务都在运行
chmod +x scripts/test-device-auth.sh
./scripts/test-device-auth.sh
```

---

## 10. 快速参考表

### 依赖版本

| 工具 | Nexu | Cloud | 要求 |
|------|------|-------|------|
| Node | 24+ | 20+ | 同时开发需 24+ |
| pnpm | 10.26.0 | 10.26.0 | 统一版本 |
| PostgreSQL | 14+ | 14+ | docker-compose |

### 环境变量快速检查

```bash
# Nexu
grep -E "CLOUD_API_URL|DATABASE_URL|WEB_URL" nexu/.env

# Cloud
grep -E "NEXU_DESKTOP_MODE|DATABASE_URL|WEB_URL" cloud/apps/api/.env
grep -E "VITE_API_BASE_URL|VITE_ENABLE_DESKTOP_AUTH_FALLBACK" cloud/apps/web/.env.local
```

---

## 总结

Nexu 和 Cloud 的本地联调通过以下三个关键点实现：

1. **设备授权流程**：4 步设备注册 + 授权 + 轮询
2. **API 代理**：Vite 代理 + CORS 配置
3. **环境配置**：共享数据库 + Desktop 模式启用

通过遵循本文档的配置和步骤，可以在本地高效地开发和测试 Nexu-Cloud 的集成功能。
