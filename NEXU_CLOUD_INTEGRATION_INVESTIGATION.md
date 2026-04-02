# Nexu-Cloud 本地联调配置调查报告

**调查日期**: 2026-04-01  
**调查员**: C（跨项目联调配置调查员）  
**项目**: Nexu <-> Cloud 本地集成调查

---

## 执行总结

Nexu 和 Cloud 通过以下方式整合：
1. **设备授权流程**: Desktop 通过 Cloud 的设备授权流程获取 API Key
2. **奖励系统**: Nexu Controller 使用 Bearer Token 调用 Cloud 的奖励 API
3. **模型同步**: Nexu 从 Cloud 的 Link 网关获取可用模型列表

本地开发时，两个项目需要配置不同的服务器地址（默认生产 URL，需手动修改为本地地址）。

---

## 1. API URL 配置

### 1.1 Nexu 侧配置

**文件**: `/apps/controller/src/store/nexu-config-store.ts`

#### 默认 Cloud Profile
```typescript
const defaultCloudProfile: CloudProfileEntry = {
  name: "Default",
  cloudUrl: "https://nexu.io",           // Cloud 主 API 服务器
  linkUrl: "https://link.nexu.io",       // Link Gateway 模型网关
};
```

**关键发现**:
- 默认指向生产环境 (`https://nexu.io`)
- 用户可以创建多个 Cloud Profile，支持本地开发切换
- `cloudUrl` 用于设备授权和奖励 API
- `linkUrl` 用于获取模型列表

#### 本地开发配置选项

**方式 1：创建本地 Profile** (推荐)
```typescript
{
  name: "Local",
  cloudUrl: "http://localhost:3000",       // Cloud API 服务器地址
  linkUrl: "http://localhost:5174/api",    // Link Gateway 本地地址（待确认）
}
```

**方式 2：修改默认 Profile**
直接修改 `defaultCloudProfile` 中的 URL（不建议，因为会被 git 跟踪）。

### 1.2 Cloud 侧配置

**文件**: `/apps/api/.env`

```bash
# Cloud 主 API 服务器
PORT=3000

# Web 前端地址（用于 CORS 和回跳）
WEB_URL=http://localhost:5176
```

**关键发现**:
- Cloud API 默认运行在端口 `3000`
- 支持 Desktop 模式（`NEXU_DESKTOP_MODE=true`）
- 使用 Better Auth 进行身份验证

#### Link Gateway
- **位置**: 未在 Cloud 项目中找到明确的 Link Gateway 实现
- **推测**: Link Gateway 可能是外部独立服务或在 Cloud 项目的其他部分
- **功能**: 提供模型列表端点 `/v1/models`

---

## 2. 认证流程

### 2.1 完整认证链路

#### Step 1: 设备注册 (Desktop → Cloud)
```typescript
// Nexu: apps/controller/src/store/nexu-config-store.ts:1617
POST /api/auth/device-register
{
  deviceId: UUID,           // 随机生成的设备ID
  deviceSecretHash: SHA256  // 设备密钥的 SHA256 哈希值
}
```

**Cloud 端处理**:
```typescript
// Cloud: apps/api/src/routes/desktop-auth-routes.ts:19-46
// 插入设备授权记录，有效期 5 分钟
```

#### Step 2: 用户在浏览器授权 (User → Cloud)
```typescript
// 用户访问此 URL 并登录
browserUrl = `${cloudUrl}/auth?desktop=1&device_id=${deviceId}`
```

#### Step 3: Cloud 创建 API Key (Cloud API)
```typescript
// Cloud: apps/api/src/routes/desktop-auth-routes.ts:184-269
POST /api/v1/auth/desktop-authorize
{
  deviceId: string  // 匹配设备ID
}
// 需要用户已登录（session cookie）

// Cloud 端操作:
// 1. 验证设备ID和授权状态
// 2. 生成 API Key: nxk_<base64url(32字节)>
// 3. 使用 bcrypt 加密存储 (Link Gateway 兼容)
// 4. 加密存储原文密钥用于设备轮询获取
```

#### Step 4: Desktop 轮询获取 API Key
```typescript
// Nexu: apps/controller/src/store/nexu-config-store.ts:504-601
// 每 3 秒轮询一次，最多 100 次（约 5 分钟）
POST /api/auth/device-poll
{
  deviceId: string,
  deviceSecret: string  // 明文设备密钥（需要保管）
}

// Cloud 响应:
{
  status: "completed",
  apiKey: "nxk_...",     // 明文密钥（仅返回一次）
  userName: string,
  userEmail: string,
  cloudModels?: Array,   // 可选：模型列表
  linkGatewayUrl?: string // 可选：Link Gateway 地址
}
```

### 2.2 API Key 验证

**Nexu 发送请求**:
```typescript
// Cloud API 认证方式: Bearer Token
Authorization: Bearer <apiKey>

// 在 Cloud 端验证
// Cloud: apps/api/src/middleware/api-key-auth.js
// 查询 api_keys 表，bcrypt 比对密钥哈希值
```

### 2.3 Desktop Authorize 验证流程

```typescript
// Cloud 端在授权前的检查
1. 验证 deviceId 存在且未过期（5分钟）
2. 验证用户已登录（从 session 获取 userId）
3. 查询或创建应用用户 (users 表)
4. 生成 API Key 并加密存储
5. 标记设备授权为 "completed"
6. 返回成功响应
```

---

## 3. 数据流验证

### 3.1 奖励系统调用链

```
Nexu Web → Nexu Controller → Cloud API (奖励端点)
```

**Nexu 侧实现**:
```typescript
// apps/controller/src/services/cloud-reward-service.ts:69-134
export function createCloudRewardService(options: {
  cloudUrl: string;    // 从配置中读取
  apiKey: string;      // 从 Desktop 授权获取
}): CloudRewardService {
  
  async function fetchWithAuth(path: string, init?: RequestInit) {
    return proxyFetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,  // ← Bearer Token 认证
        ...init?.headers,
      },
      timeoutMs: 10_000,
    });
  }

  return {
    async getRewardsStatus() {
      // GET /api/v1/rewards/status
    },
    async claimReward(taskId: string) {
      // POST /api/v1/rewards/claim
    }
  };
}
```

**Cloud 侧实现**:
```typescript
// Cloud: apps/api/src/routes/reward-routes.ts:17-117
// 两个路由，都需要 /api/v1 auth middleware

GET /api/v1/rewards/status
  → 调用 rewardService.getRewardStatus(appUserId)
  → 返回用户的奖励任务列表、进度、云端余额

POST /api/v1/rewards/claim
  → 接收 { taskId }
  → 调用 rewardService.claimReward(appUserId, taskId)
  → 返回领取结果
```

### 3.2 Schema 一致性

**Shared Schemas 位置**:
```
Cloud: @nexu-cloud/shared (假设位置)
Nexu:  @nexu/shared (packages/shared/src/schemas/)
```

**奖励相关 Schema**:
```typescript
// 两侧共享的 Schema（需验证）
- rewardStatusResponseSchema
- rewardClaimRequestSchema
- rewardClaimResponseSchema
```

---

## 4. 本地联调的实际步骤

### 4.1 前置条件

1. **两个项目都需要启动**:
   ```bash
   # Terminal 1: Cloud API 服务器
   cd /Users/qiyuan/Documents/Code/anthhub/ai/refly-team/cloud/apps/api
   npm run dev  # 或 pnpm dev（假设命令）
   # 监听 http://localhost:3000

   # Terminal 2: Cloud Web 前端（用于授权流程）
   cd /Users/qiyuan/Documents/Code/anthhub/ai/refly-team/cloud/apps/web
   npm run dev  # 或 pnpm dev
   # 监听 http://localhost:5176（根据 .env 配置）

   # Terminal 3: Nexu Controller + Web
   cd /Users/qiyuan/Documents/Code/anthhub/ai/refly-team/nexu
   pnpm dev
   # Controller 监听 http://localhost:8080（假设）
   # Web 监听 http://localhost:5173（假设）
   ```

2. **数据库需要启动**:
   ```bash
   # Cloud 使用 PostgreSQL
   # Nexu 开发模式通常不需要数据库（使用本地存储）
   ```

### 4.2 本地测试步骤

#### 步骤 A: 创建本地 Cloud Profile

在 Nexu Desktop App 中：
1. 进入 Cloud Settings 或 Profiles 页面
2. 创建新 Profile:
   ```
   Name: Local Dev
   Cloud URL: http://localhost:3000
   Link URL: http://localhost:????  (待确认)
   ```
3. 激活 Profile

#### 步骤 B: 执行设备授权

1. 点击 "Connect Cloud"
2. 在浏览器中登录 `http://localhost:3000/auth?desktop=1&device_id=<ID>`
3. 同意授权
4. Controller 自动轮询并获取 API Key

#### 步骤 C: 测试奖励 API

在 Nexu Web 中：
1. 导航到奖励页面
2. 调用 `GET /api/v1/rewards/status` 测试连接
3. 验证返回任务列表

---

## 5. 本地联调需要修改的地方

### 5.1 必需修改

| 项目 | 文件 | 修改项 | 当前值 | 本地值 |
|------|------|--------|--------|--------|
| Nexu | `apps/controller/src/store/nexu-config-store.ts` | `defaultCloudProfile.cloudUrl` | `https://nexu.io` | `http://localhost:3000` |
| Nexu | `apps/controller/src/store/nexu-config-store.ts` | `defaultCloudProfile.linkUrl` | `https://link.nexu.io` | 待确认 |
| Cloud | `apps/api/.env` | `WEB_URL` | `http://localhost:5173` | `http://localhost:5176` |
| Cloud | `apps/api/.env` | `NEXU_DESKTOP_MODE` | 无 | `true` |

### 5.2 推荐做法

**不修改代码**，而是使用环境变量或配置文件覆盖：

#### Nexu 侧
```bash
# 通过 Desktop App UI 创建和切换 Cloud Profile
# 无需修改代码
```

#### Cloud 侧
```bash
# 在 .env 中配置
PORT=3000
WEB_URL=http://localhost:5176
NEXU_DESKTOP_MODE=true
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev
```

---

## 6. 文档发现

### 6.1 现有文档

- **Nexu**: `AGENTS.md` 提供了全面的项目概览和命令参考
- **Cloud**: `.env.example` 提供了配置示例
- **两个项目**: 没有专门的"本地联调指南"

### 6.2 缺失的文档

1. **Cloud 本地开发启动指南**
   - Cloud API 和 Web 的启动命令
   - 数据库初始化步骤
   - Link Gateway 的本地地址

2. **Nexu-Cloud 联调指南**
   - 完整的端到端流程
   - Profile 配置示例
   - 故障排查步骤

3. **API Key 生成和验证流程**
   - 设备授权的详细步骤
   - API Key 的安全存储建议

---

## 7. 关键代码位置

### Nexu 侧

| 功能 | 文件 | 行号 |
|------|------|------|
| Cloud 配置存储 | `apps/controller/src/store/nexu-config-store.ts` | 81-85 |
| 设备注册请求 | `apps/controller/src/store/nexu-config-store.ts` | 1609-1625 |
| 轮询 API Key | `apps/controller/src/store/nexu-config-store.ts` | 504-601 |
| 奖励 API 调用 | `apps/controller/src/services/cloud-reward-service.ts` | 69-134 |
| Desktop 本地服务 | `apps/controller/src/services/desktop-local-service.ts` | 27-29 |

### Cloud 侧

| 功能 | 文件 | 行号 |
|------|------|------|
| 设备授权端点 | `apps/api/src/routes/desktop-auth-routes.ts` | 17-135 |
| API Key 生成 | `apps/api/src/routes/desktop-auth-routes.ts` | 241-254 |
| 奖励路由 | `apps/api/src/routes/reward-routes.ts` | 87-117 |
| API Key 验证 | `apps/api/src/middleware/api-key-auth.js` | TBD |

---

## 8. 问题和建议

### 8.1 发现的问题

1. **Link Gateway 地址不清楚**
   - 模型列表端点 `/v1/models` 在 Cloud 代码中找不到
   - 推测 Link Gateway 是外部服务或另外部署

2. **本地开发文档不完整**
   - 没有明确的"本地联调"指南
   - Cloud 项目的启动命令不清楚

3. **CORS 配置风险**
   - Cloud 的 CORS 只允许 `WEB_URL` 和默认值
   - 本地开发时需要确保 Nexu Web 地址在白名单中

### 8.2 改进建议

1. **创建 NEXU_CLOUD_LOCAL_DEV.md**
   ```markdown
   # Nexu-Cloud 本地联调指南
   
   ## 快速开始
   
   1. 启动 Cloud API
   2. 启动 Cloud Web
   3. 在 Nexu 中创建本地 Profile
   4. 授权并测试
   ```

2. **Cloud 项目添加环境变量文档**
   ```
   NEXU_CLOUD_URL=http://localhost:3000  # 可选：覆盖默认 URL
   LINK_GATEWAY_URL=http://localhost:???? # 可选：覆盖 Link Gateway
   ```

3. **Nexu 支持通过环境变量配置默认 Cloud Profile**
   ```typescript
   // 在启动时读取环境变量
   process.env.NEXU_CLOUD_URL
   process.env.NEXU_LINK_URL
   ```

---

## 9. 数据模型对齐

### 9.1 API Key 存储模式

**Cloud 端**:
```typescript
// 存储在 api_keys 表
{
  id: string,
  userId: string,
  name: string,
  keyPrefix: string,  // 用于识别 (nxk_...)
  keyHash: string,    // bcrypt 哈希（用于验证）
  status: "active" | "revoked"
}
```

**Nexu 端**:
```typescript
// 存储在 Desktop Cloud State
{
  apiKey: string,     // 明文密钥（仅在授权后获取一次）
  connectedAt: string,
  userName: string,
  userEmail: string
}
```

### 9.2 模型列表对齐

**Nexu 期望的模型格式**:
```typescript
{
  id: string,
  name: string,
  provider?: string
}
```

**Cloud Link Gateway 返回格式**:
```typescript
{
  data: [
    { id: string, owned_by?: string }  // ← 被映射为 provider
  ]
}
```

---

## 10. 总结与后续

### 主要发现

1. ✅ Nexu 和 Cloud 的集成架构清晰
2. ✅ 设备授权流程完整，包括 5 分钟过期机制
3. ⚠️ Link Gateway 实现位置不清楚
4. ⚠️ 本地联调文档缺失
5. ⚠️ 默认配置指向生产环境

### 下一步行动

1. 询问 Cloud 项目的维护者关于 Link Gateway 的位置
2. 编写本地联调快速指南
3. 在两个项目的 README 中添加"本地开发"部分
4. 考虑在 env.example 中提供本地开发配置示例

---

**调查完成日期**: 2026-04-01  
**报告版本**: 1.0
