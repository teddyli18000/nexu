# Nexu-Cloud 本地联调配置 — 完整调查索引

## 📋 调查概览

本次调查针对 **Nexu 和 Cloud 两个项目在本地开发环境中的联调配置**，涵盖：

- ✅ Nexu 本地开发配置与启动流程
- ✅ Cloud 本地开发配置与启动流程  
- ✅ 两个项目的设备授权集成流程
- ✅ API URL 配置与数据流向
- ✅ 环境变量配置与验证清单
- ✅ 故障排查与最佳实践

**调查日期**：2026-04-01  
**调查范围**：Nexu (`/Users/qiyuan/Documents/Code/anthhub/ai/refly-team/nexu`) + Cloud (`/Users/qiyuan/Documents/Code/anthhub/ai/refly-team/cloud`)

---

## 📚 文档导航

本调查生成了以下三份核心文档：

### 1. **NEXU_LOCAL_DEV_CONFIGURATION.md**
   - **长度**：~450 行
   - **内容**：
     - Nexu 项目结构（apps/controller, apps/web, apps/desktop）
     - 启动命令参考（pnpm dev, pnpm start, pnpm start:bg）
     - 三种启动路径的完整执行流程
     - 环境变量 schema（PORT, HOST, NEXU_HOME, OPENCLAW_GATEWAY_PORT 等）
     - 端口映射表（5173, 3010, 50800, 18789）
     - 文件监视与热更新机制
     - 本地目录结构（.tmp/desktop/nexu-home/ vs ~/.nexu/）
     - 故障排查指南
     - 性能优化建议
     - 快速参考卡
   - **何时查看**：需要了解 Nexu Desktop 的启动机制和环境配置

### 2. **CLOUD_LOCAL_DEV_CONFIGURATION.md**
   - **长度**：~400 行
   - **内容**：
     - Cloud 项目结构（apps/api, apps/web, packages/shared）
     - 启动命令参考（pnpm dev, pm2 start）
     - 并发启动流程（API + Web）
     - PM2 配置详解（ecosystem.config.cjs）
     - 环境变量配置表（DATABASE_URL, BETTER_AUTH_* 等）
     - Web 端口配置（Vite 代理到 API）
     - Desktop 本地认证回落机制
     - 数据库初始化（迁移、种子数据、本地联调测试）
     - API 设计模式（路由注册、中间件顺序）
     - 故障排查指南
     - 常见命令速查表
   - **何时查看**：需要理解 Cloud API 的启动和 Desktop 集成配置

### 3. **NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md**
   - **长度**：~500 行
   - **内容**：
     - 双项目启动架构（独立启动 vs 并行启动）
     - 端口映射全景表
     - **4 步 Device Authorization 流程**（注册 → 登录 → 授权 → 轮询）
     - 关键端点对照表
     - API 调用链拓扑图
     - 本地联调工作流（初次设置 → 日常开发 → 验证集成）
     - 集成验证脚本（curl 示例）
     - 环境变量校验清单（项目间依赖关系）
     - **常见集成问题与解决方案**（4 大类）
     - 性能优化与调试最佳实践
     - 完整的 Device Authorization 测试脚本
   - **何时查看**：需要在本地同时运行两个项目进行集成测试

---

## 🔑 核心发现

### A. Device Authorization 流程（关键集成点）

```
Desktop                    Cloud API                Browser
   │                          │                        │
   ├──register device────────→│                        │
   │                          │                        │
   │                          │                        │
   │◄─────────── 打开浏览器 ───┴──────────────────────→│
   │                          │                        │
   │                          │◄──── 用户登录 ────────│
   │                          │                        │
   │  (前端调用)             │                        │
   │◄──────────────────────────────────────────────── │
   │  POST /api/v1/auth/desktop-authorize             │
   │  { deviceId }           │◄─ 需要登录会话 ────── │
   │  ─────────────────────→  │                        │
   │                          │                        │
   │◄────── 轮询结果 ────────│                        │
   │  POST /api/auth/device-poll                      │
   │  返回: apiKey, userId, userName                  │
   │                          │                        │
```

**在 Cloud API 中的实现**：
- `/api/auth/device-register` — 无认证，任何人可调用
- `/api/v1/auth/desktop-authorize` — 需要登录会话（浏览器用户）
- `/api/auth/device-poll` — 无认证，Desktop 轮询结果

### B. 关键环境变量

| 项目 | 变量 | 默认值 | Desktop 模式下的值 |
|------|------|--------|------------------|
| Nexu Controller | `CLOUD_API_URL` | (未定义) | 需设置为 Cloud API 地址 |
| Nexu Controller | `PORT` | 3010 | 或用 50800（launchd mode） |
| Cloud API | `NEXU_DESKTOP_MODE` | (undefined) | **`true`** — 启用 Desktop 回落 |
| Cloud API | `WEB_URL` | `http://localhost:5173` | 用于 CORS |
| Both | `DATABASE_URL` | 都指向 localhost:5433 | **必须指向同一数据库** |

### C. 本地启动的三种模式

#### 模式 1: 仅开发（快速开发迭代）
```bash
# 终端 1: Nexu Web + Controller
cd nexu && pnpm dev        # 5173 + 3010

# 终端 2: Cloud API + Web
cd cloud && pnpm dev       # 3000 + 5173 (会冲突！)
```
⚠️ **端口冲突**：两个 Web 都用 5173，需要错开或修改

#### 模式 2: 完整 Desktop 开发（需要 Electron）
```bash
cd nexu && pnpm start      # 完整栈：Electron + Controller + Web + OpenClaw
# 同时在另一终端启动 Cloud
cd cloud && pnpm dev
```

#### 模式 3: PM2 管理（生产级开发）
```bash
cd cloud && pm2 start ecosystem.config.cjs
# 自动启动、监视、重启、日志管理
```

---

## 🔄 数据流向与 API 调用链

### Nexu → Cloud

```
Nexu Controller (3010)
  ├─ [设备授权] POST /api/auth/device-register (Cloud 3000)
  ├─ [设备授权] POST /api/auth/device-poll (Cloud 3000)
  ├─ [积分查询] GET /api/v1/rewards/status (Cloud 3000)
  └─ [积分领取] POST /api/v1/rewards/claim (Cloud 3000)

Nexu Web (5173)
  └─ [Vite 代理] /api → localhost:3000 (Nexu Controller)
```

### Cloud → Database

```
Cloud API (3000)
  └─ PostgreSQL (localhost:5433)
      ├─ device_authorizations (设备授权状态)
      ├─ api_keys (API 密钥)
      ├─ users (应用用户)
      ├─ credit_balances (积分余额)
      └─ credit_usages (积分使用记录)
```

---

## ✅ 本地联调验证清单

### 初次设置（一次性）

- [ ] Node.js >= 24 已安装
- [ ] pnpm 10.26.0 已安装
- [ ] PostgreSQL 14+ 运行在 localhost:5433（docker-compose）
- [ ] `nexu/.env` 中 `DATABASE_URL` 指向 localhost:5433
- [ ] `cloud/apps/api/.env` 中 `DATABASE_URL` 指向 localhost:5433
- [ ] Cloud 数据库迁移已应用（`pnpm db:migrate` 或 `pnpm db:push`）

### 日常开发前

- [ ] Docker 容器运行：`docker-compose ps` 看 postgres
- [ ] 数据库可连接：`psql -h localhost -p 5433 -U nexu -d nexu_dev`
- [ ] 环境变量已加载：`grep NEXU_DESKTOP_MODE cloud/apps/api/.env`

### 启动后验证

- [ ] Nexu Controller 就绪：`curl http://localhost:3010/health`
- [ ] Cloud API 就绪：`curl http://localhost:3000/health`
- [ ] Nexu Web 可访问：`http://localhost:5173`
- [ ] Cloud Web 可访问：`http://localhost:5173`（需端口改动）
- [ ] Device Authorization 流程运行：查看日志，无 500 错误

---

## 🐛 故障排查速查

| 症状 | 原因 | 解决方案 |
|------|------|---------|
| `curl http://localhost:3000/health` 超时 | Cloud API 未启动 | `pnpm dev` 或 `pm2 start` |
| API 日志显示 "database_connection_retry" | PostgreSQL 未启动 | `docker-compose up -d` |
| Web 无法访问 API（CORS 错误） | `WEB_URL` 配置错误 | 检查 API 中的 cors() 配置 |
| `POST /api/auth/device-register` 返回 404 | 路由未注册或 API 版本不对 | 检查 Cloud API 中的 `registerDesktopDeviceRoutes()` |
| Device Authorization 流程卡在 "pending" | 浏览器端尚未调用授权端点 | 手动调用 `POST /api/v1/auth/desktop-authorize` |
| 两个 Web 都想用 5173 | 端口冲突 | 修改其中一个的 vite.config.ts 中的 port |

---

## 📖 如何使用这些文档

### 场景 1: 首次本地开发

```
1. 阅读 NEXU_LOCAL_DEV_CONFIGURATION.md § 2-4
   └─ 了解环境变量和基本启动

2. 阅读 CLOUD_LOCAL_DEV_CONFIGURATION.md § 2-4
   └─ 了解 Cloud 的启动方式

3. 阅读 NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md § 5.1
   └─ 初次设置步骤（数据库、种子数据等）
```

### 场景 2: 集成测试 Device Authorization 流程

```
1. 查阅 NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md § 3
   └─ 理解 4 步流程

2. 查阅 NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md § 5.3
   └─ 运行验证脚本

3. 查阅 NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md § 9.1
   └─ 运行完整的测试脚本
```

### 场景 3: 故障排查

```
1. 查阅各项目的 "故障排查" 部分
   └─ Nexu: NEXU_LOCAL_DEV_CONFIGURATION.md § 11
   └─ Cloud: CLOUD_LOCAL_DEV_CONFIGURATION.md § 11

2. 查阅 NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md § 7
   └─ 集成相关的常见问题
```

### 场景 4: 快速参考

```
- 启动命令 → 各文档的 § 2 或快速参考表
- 环境变量 → 各文档的 § 3 或 § 8（Cloud 的环境变量校验）
- 常用命令 → CLOUD_LOCAL_DEV_CONFIGURATION.md § 12
- 端口信息 → NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md § 2
```

---

## 🎯 关键见解与建议

### 1. **Desktop 模式是集成的关键**
   - 启用 `NEXU_DESKTOP_MODE=true` 后，Cloud API 自动为 `/api/v1/*` 注入 Desktop 用户上下文
   - 无需登录即可测试 API（通过 `desktopAuthMiddleware`）
   - 这是 Nexu 和 Cloud 的核心集成点

### 2. **设备授权流程需要浏览器参与**
   - 前 2 步（注册、轮询）可由 Nexu Desktop 自动完成
   - 第 3 步（授权）需要真实的浏览器登录和会话
   - 第 4 步（获取 API Key）回到 Desktop，无需额外认证

### 3. **端口规划很重要**
   - Nexu Web: 5173
   - Cloud Web: 需改为 5174 或其他端口（避免冲突）
   - API: 3000（Cloud） + 3010（Nexu Controller）
   - OpenClaw: 18789（仅 Nexu Desktop）

### 4. **环境变量必须一致**
   - 两个项目都必须指向同一 PostgreSQL (`localhost:5433`)
   - `NEXU_DESKTOP_MODE=true` 必须在 Cloud API 中启用
   - `WEB_URL` 必须与实际访问的前端地址一致（CORS）

### 5. **本地联调测试脚本很有用**
   - Cloud 提供了 `db-test/credit-grant.ts` 脚本，可直接测试后端链路
   - 避免了通过 HTTP 的复杂性，专注于业务逻辑验证
   - 推荐在重要业务逻辑变更后运行

---

## 📞 后续步骤

如需进一步深入：

1. **实现 CLOUD_API_URL 配置**（Nexu Controller）
   - 在 `apps/controller/src/app/env.ts` 中添加 `CLOUD_API_URL` schema
   - 更新云服务集成（积分查询、领取等）

2. **统一端口配置**
   - 修改其中一个 Web 的 Vite 配置，避免 5173 冲突
   - 更新相应的环境变量

3. **自动化集成测试**
   - 创建 E2E 测试脚本，自动验证 Device Authorization 流程
   - 在 CI/CD 中运行，确保集成不破裂

4. **生产环境适配**
   - 从本文档的 localhost 配置迁移到生产 URL
   - API Gateway（Link） 的集成配置

---

## 📄 文档快速索引

| 文档 | 用途 | 何时查看 |
|------|------|---------|
| NEXU_LOCAL_DEV_CONFIGURATION.md | Nexu 启动、环境、架构 | 开发 Nexu 功能或故障排查 |
| CLOUD_LOCAL_DEV_CONFIGURATION.md | Cloud 启动、环境、架构 | 开发 Cloud 功能或故障排查 |
| NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md | Device Authorization + 集成测试 | **集成两个项目时必读** |
| LOCAL_INTEGRATION_INVESTIGATION_INDEX.md | 本文档，导航和快速参考 | 查找内容、规划工作 |

---

## 🏁 总结

通过这三份文档，可以：

✅ **独立开发**：理解每个项目的启动和配置  
✅ **集成开发**：知道如何同时运行两个项目  
✅ **问题排查**：快速定位和解决常见问题  
✅ **验证集成**：运行脚本验证 Device Authorization 流程  
✅ **快速参考**：查阅命令、端口、环境变量等信息  

**建议**：在书签中保存 `NEXU_CLOUD_CROSS_INTEGRATION_SUMMARY.md`，它是日常开发时最常查阅的文档。

---

**调查完成日期**：2026-04-01  
**调查范围**：源代码分析 + 配置文件审查 + 架构理解  
**覆盖率**：完整
