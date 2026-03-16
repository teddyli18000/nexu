# Nexu ↔ Link Gateway 技术对接方案

> **参与方**：Nexu Desktop（本仓库 `powerformer/apps`）× Link Gateway（`nexu-io/link`，Go 服务）
>
> **目标**：桌面端用户通过 Cloud Connection 流程获取 API Key，用该 Key 调用 Link Gateway 的 OpenAI 兼容接口使用云端模型。

---

## 1. 系统架构总览

```
┌───────────────────────────────────────────────────────────────┐
│  Nexu Desktop (Electron)                                      │
│                                                               │
│  ┌─────────────────┐   ┌──────────────────┐                   │
│  │  Desktop UI     │   │  Local API       │                   │
│  │  (Renderer)     │──▶│  (localhost:50800)│                   │
│  │                 │   │                  │                   │
│  │  - Welcome Page │   │  - cloud-connect │                   │
│  │  - Models Page  │   │  - cloud-status  │                   │
│  │  - Control Panel│   │  - config-gen    │                   │
│  └─────────────────┘   └──────┬───────────┘                   │
│                               │                               │
└───────────────────────────────┼───────────────────────────────┘
                                │ HTTPS
                 ┌──────────────┼──────────────┐
                 │              ▼              │
                 │  Cloud (同一 PostgreSQL)     │
                 │                             │
                 │  ┌───────────────────────┐  │
                 │  │  Nexu Cloud API       │  │
                 │  │  (nexu-link.xxx.net)  │  │
                 │  │                       │  │
                 │  │  - /api/auth/*        │  │
                 │  │  - better-auth        │  │
                 │  │  - device-authorize   │  │
                 │  └───────────┬───────────┘  │
                 │              │              │
                 │  ┌───────────▼───────────┐  │
                 │  │  Link Gateway         │  │
                 │  │  (Go, port 8080)      │  │
                 │  │                       │  │
                 │  │  - /v1/models         │  │
                 │  │  - /v1/chat/completions│ │
                 │  │  - /v1/embeddings     │  │
                 │  │  - /v1/responses      │  │
                 │  └───────────────────────┘  │
                 │                             │
                 │  ┌───────────────────────┐  │
                 │  │  PostgreSQL           │  │
                 │  │  public.api_keys (共享)│  │
                 │  │  link.providers       │  │
                 │  │  link.models          │  │
                 │  │  link.usage_events    │  │
                 │  └───────────────────────┘  │
                 └─────────────────────────────┘
```

---

## 2. 需要对齐的关键问题

### 2.1 API Key Hash 算法不匹配 ⚠️ **必须解决**

**现状**：

| | Nexu `desktop-auth-routes.ts` | Link `postgres.go` |
|---|---|---|
| Hash 算法 | `SHA256(rawKey).hex()` | `bcrypt.CompareHashAndPassword()` |
| 存储格式 | 64 字符 hex string | 60 字符 bcrypt string |

**影响**：Nexu 生成的 API Key 写入 `public.api_keys.key_hash` 后，Link Gateway 无法用 bcrypt 验证，认证必定失败。

**解决方案**：Nexu 侧改用 bcrypt（推荐）。

```typescript
// desktop-auth-routes.ts — 改动
import { hash as bcryptHash } from "bcryptjs"; // 新增依赖

// 原代码:
const keyHash = createHash("sha256").update(rawKey).digest("hex");

// 改为:
const keyHash = await bcryptHash(rawKey, 10); // bcrypt, cost=10
```

同时修改 `desktop-poll` 端点中的验证逻辑（如有用到 key_hash 查找）。

**Nexu 侧安装依赖**：
```bash
pnpm -C apps/api add bcryptjs
pnpm -C apps/api add -D @types/bcryptjs
```

**备注**：`key_hash` 上的 `UNIQUE INDEX` 仍然有效，bcrypt 每次 salt 不同所以 hash 值也不同，不会冲突。但 Nexu 现有的按 `key_hash` 精确查找逻辑需要改为按 `key_prefix` 查找 + bcrypt 逐行比对（和 Link 一致）。

---

### 2.2 API Key 格式

**现状**：

| | Nexu | Link |
|---|---|---|
| Key 格式 | `nxk_` + 32 bytes base64url | 任意（demo 用 `sk-local-test`）|
| Prefix 提取 | 前 12 字符 | 前 12 字符 OR 第一个 `-` 前的部分 |

**结论**：**兼容，无需改动**。Link 的 `firstSegment()` 和 12-char prefix 双路查找可以匹配 `nxk_` 前缀。

---

### 2.3 `public.api_keys` 表 Schema 对齐

**Nexu 定义**（Drizzle ORM）：

```
pk, id, user_id, name, key_prefix, key_hash, status,
last_used_at, expires_at, revoked_at, created_at, updated_at
```

**Link 期望**（Go pgx 查询）：

```sql
SELECT pk, id, user_id, name, key_prefix, key_hash, status,
       expires_at, revoked_at, created_at, updated_at
FROM public.api_keys
WHERE key_prefix = $1 OR key_prefix = $2
```

**结论**：**完全兼容**。两边的列名和类型完全一致。Link 还会调用 `TouchAPIKey` 更新 `last_used_at` 和 `updated_at`，和 Nexu 的列定义一致。

---

### 2.4 `user_id` 含义

**Nexu**：`user_id` 存的是 Nexu 应用层的 `users.id`（cuid2 格式，如 `clx...`），由 `desktop-auth-routes.ts` 在 authorize 时从 `users` 表查出。

**Link**：`user_id` 用于 usage 记录归属（写入 `link.usage_events.user_id`），不做额外查询，只要是稳定的用户标识即可。

**结论**：**兼容，无需改动**。

---

## 3. 端到端流程（确认版）

```
Phase 1: 设备注册
  桌面端 Local API → POST cloud/api/auth/desktop-device-register
                      { deviceId, deviceSecretHash }
  桌面端打开浏览器 → cloud/auth?desktop=1&device_id=xxx

Phase 2: 用户登录并授权
  用户在浏览器登录（better-auth）
  前端自动调 → POST cloud/api/v1/auth/desktop-authorize { deviceId }
  云端生成 API Key：
    rawKey = "nxk_" + randomBytes(32).base64url
    keyPrefix = rawKey.slice(0, 12)
    keyHash = bcrypt(rawKey, 10)           ← 改为 bcrypt
    INSERT INTO public.api_keys (...)

Phase 3: 桌面端轮询
  Local API 轮询 → POST cloud/api/auth/desktop-poll
                    { deviceId, deviceSecret }
  云端返回 → { status: "completed", apiKey: "nxk_...", userId, ... }

Phase 4: 桌面端使用 Link Gateway
  Local API 拿到 apiKey 后：
  1. GET link-gateway/v1/models
     Authorization: Bearer nxk_...
     → Link 查 public.api_keys, bcrypt 验证, 返回模型列表

  2. 合并模型到 OpenClaw config → 用户可选云端模型

  3. POST link-gateway/v1/chat/completions
     Authorization: Bearer nxk_...
     → Link 路由到 Bifrost → 调用实际 Provider (Azure/Bedrock/Vertex)
     → Usage 记录到 link.usage_events
```

---

## 4. 部署拓扑与网络

### 4.1 服务部署

| 服务 | 域名/端口 | 说明 |
|------|-----------|------|
| Nexu Cloud API | `nexu-link.powerformer.net` `/api/*` | Helm chart `api` 服务 |
| Nexu Cloud Web | `nexu-link.powerformer.net` `/` | Helm chart `web` 服务 |
| Link Gateway | `nexu-link.powerformer.net` `/v1/*` | 需要加入 Helm chart 或独立部署 |
| PostgreSQL | 内部连接 | 共享同一个数据库实例 |

### 4.2 Ingress 路由需求

当前 PR #6 的 Helm Ingress 只有 `api` 和 `web`，**需要增加 Link Gateway 的路由**：

```yaml
# deploy/helm/nexu/templates/ingress.yaml 需新增
- path: /v1
  pathType: Prefix
  service: link-gateway   # ← 新增 Link Gateway 的 Service

# 或者独立 Ingress for link-gateway
```

**注意路径冲突**：PR #6 的 Ingress 已经有 `/v1` → `api` 的路由。需要确认：
- Nexu API 的 `/v1/*` 路由和 Link Gateway 的 `/v1/*` 路由是否部署在同一域名
- 如果是，需要精细化路径规则（如 `/v1/chat/*` → Link, `/v1/bots/*` → Nexu API）
- 或者 Link Gateway 使用独立域名（如 `api.nexu-link.powerformer.net`）

### 4.3 桌面端环境变量

```bash
# 桌面端 .env / runtime-config
NEXU_CLOUD_URL=https://nexu-link.powerformer.net   # Cloud API (auth + web)
NEXU_LINK_URL=https://nexu-link.powerformer.net     # Link Gateway (LLM 调用)
# 如果 Link 独立域名：
# NEXU_LINK_URL=https://api.nexu-link.powerformer.net
```

---

## 5. Link 侧需要的改动

### 5.1 Schema Migration

Link 的 `001_init.up.sql` 假设 `public.api_keys` 表已存在（由 Nexu API 创建）。需要确认：
- Link 不需要创建 `api_keys` 表（Nexu 的 Drizzle migration 已经创建）
- Link 只需要创建 `link.*` schema 下的表（providers, models, usage_events）

**确认点**：Link 的 `scripts/seed-local-db.sh` 是否会尝试创建 `api_keys` 表？如果是，需要加 `IF NOT EXISTS` 或跳过。

### 5.2 模型目录配置

Link 的模型通过 `link.providers` + `link.models` 表配置。同事需要：
1. 配置实际的 Provider（而非 demo Provider）：
   - Bedrock: 配置真实的 AWS credentials
   - Vertex: 配置真实的 GCP credentials
   - 或其他 Provider
2. 配置对应的 Models（用户可用的模型列表）
3. 这些是运维配置，不影响代码对接

### 5.3 bcrypt vs SHA256 — Link 无需改动

如果 Nexu 侧改用 bcrypt，Link 无需任何代码改动。两边都用 bcrypt，schema 完全兼容。

---

## 6. Nexu 侧需要的改动

### 6.1 `desktop-auth-routes.ts` — 改用 bcrypt

```diff
+ import { hash as bcryptHash } from "bcryptjs";

  // In registerDesktopAuthorizeRoute:
- const keyHash = createHash("sha256").update(rawKey).digest("hex");
+ const keyHash = await bcryptHash(rawKey, 10);
```

### 6.2 `desktop-local-routes.ts` — 模型获取路径

当前 `fetchCloudModels()` 调用 `GET ${linkUrl}/v1/models`，逻辑已正确。需确认：
- `NEXU_LINK_URL` 环境变量指向 Link Gateway 的实际地址
- Link Gateway 的 `/v1/models` 返回格式是 `{ object: "list", data: [...] }`，当前代码已兼容

### 6.3 `config-generator.ts` — 合并云端模型

需要将 Link 返回的模型列表合并到 OpenClaw config 中，使桌面端 agent 可以选用云端模型。具体格式取决于 OpenClaw 的 config schema。

### 6.4 前端 `auth.tsx` — desktop 参数支持

云端 Web 前端的 `/auth` 页面需要处理 `?desktop=1&device_id=xxx`：
- 登录成功后自动调 `POST /api/v1/auth/desktop-authorize`
- 显示"已连接！可以关闭此页面返回 Nexu Desktop"

---

## 7. 联调检查清单

### 7.1 前置条件

- [ ] Link Gateway 部署完成，`/healthz` 可访问
- [ ] DNS `nexu-link.powerformer.net` 解析正常
- [ ] PostgreSQL 共享实例可被 Nexu API 和 Link Gateway 同时访问
- [ ] Nexu API migration 0012 (`desktop_device_authorizations`) 已运行
- [ ] Link migration 001 (`link.providers`, `link.models`, `link.usage_events`) 已运行
- [ ] Link 模型目录已配置（至少一个 active provider + model）
- [ ] Nexu `desktop-auth-routes.ts` 已改为 bcrypt

### 7.2 联调步骤

```bash
# 1. 验证 Link Gateway 健康
curl https://nexu-link.powerformer.net/healthz

# 2. 验证模型列表（需要已有 API Key）
curl https://nexu-link.powerformer.net/v1/models \
  -H "Authorization: Bearer sk-local-test"

# 3. 测试设备注册（Nexu Cloud API）
curl -X POST https://nexu-link.powerformer.net/api/auth/desktop-device-register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device-001","deviceSecretHash":"abc123..."}'

# 4. 端到端测试
#    a. 桌面端点击 Connect to Cloud
#    b. 浏览器打开 cloud auth 页面
#    c. 登录 → 自动授权
#    d. 桌面端轮询获取 API Key
#    e. 桌面端调用 Link /v1/models 验证 Key 有效
#    f. 桌面端发起 chat/completions 请求

# 5. 验证 usage 记录
psql -c "SELECT * FROM link.usage_events ORDER BY created_at DESC LIMIT 5"
```

### 7.3 错误排查

| 现象 | 可能原因 | 排查方式 |
|------|---------|---------|
| Link 返回 401 `invalid_api_key` | Hash 算法不匹配（SHA256 vs bcrypt） | 检查 `api_keys.key_hash` 长度：60 = bcrypt ✓，64 = SHA256 ✗ |
| Link 返回 403 `forbidden_api_key` | Key 状态非 active / 已过期 / 已撤销 | 查 `api_keys` 表 status、expires_at、revoked_at |
| `/v1/models` 返回空列表 | `link.models` 无 active 记录 | 查 `SELECT * FROM link.models WHERE status='active'` |
| cloud-connect 502 | Cloud API 不可达 | 检查 `NEXU_CLOUD_URL` 指向和网络连通性 |
| poll 一直 pending | 用户未在浏览器完成登录 | 检查浏览器页面是否成功调用 desktop-authorize |

---

## 8. 数据库 Schema 全景

```
PostgreSQL (共享实例)
├── public schema (Nexu API 管理)
│   ├── user                        ← better-auth 用户表
│   ├── session                     ← better-auth 会话表
│   ├── users                       ← Nexu 应用用户表
│   ├── api_keys                    ← 🔗 共享！Nexu 写入, Link 读取验证
│   ├── desktop_device_authorizations ← 设备授权流程临时表
│   ├── bots, channels, ...         ← Nexu 业务表
│   └── model_providers             ← BYOK provider 配置
│
└── link schema (Link Gateway 管理)
    ├── providers                   ← 云端 LLM Provider 配置
    ├── models                      ← 云端模型目录
    └── usage_events                ← 调用量记录
```

---

## 9. 安全考量

| 措施 | 说明 |
|------|------|
| API Key 单次传递 | Poll 返回 Key 后立即删除 device_authorization 行 |
| 本地加密存储 | API Key 用 AES-256-GCM 加密存盘（`ENCRYPTION_KEY`）|
| bcrypt hash | Key 在数据库中存 bcrypt，即使泄露也无法还原 |
| HTTPS | 桌面端 → Cloud 全程 HTTPS |
| Key 撤销 | 用户可在 Cloud Web 管理面板撤销 Key，Link 下次请求即拒绝 |
| Usage 审计 | 所有 LLM 调用记录到 `link.usage_events`，可追溯 |
