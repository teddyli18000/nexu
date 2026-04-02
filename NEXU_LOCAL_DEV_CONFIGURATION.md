# Nexu 本地开发配置与启动流程详细调查

**调查日期**: 2026-04-01  
**调查员**: C（跨项目调查员）  
**项目**: Nexu  

---

## 执行总结

Nexu 是一个复杂的桌面-优先 OpenClaw 平台，包含三个主要启动路径：

1. **Web-only 开发** (`pnpm dev`): 仅运行 Controller + Web，快速迭代
2. **Desktop 开发** (`pnpm start`): 完整 Electron + 所有服务，使用 launchd 管理
3. **Desktop tmux 开发** (`apps/desktop/dev.sh start`): tmux 内运行的完整栈

本地开发不需要外部 PostgreSQL，所有状态保存在 `.tmp/desktop/nexu-home/` 中。

---

## 1. 启动脚本架构

### 1.1 启动命令速查

| 命令 | 启动内容 | 使用场景 | 端口 |
|------|--------|---------|------|
| `pnpm dev` | Controller + Web | Web 开发、快速迭代 | Controller: 3010, Web: 5173 |
| `pnpm dev:controller` | Controller 仅 | 调试后端 API | 3010 |
| `pnpm start` | 完整 Desktop 栈 (launchd) | 完整功能测试 | 控制器: 50800, OpenClaw: 18789 |
| `pnpm start:bg` | 后台启动 (tmux) | 后台运行 | 同上 |
| `pnpm stop` | 停止所有服务 | 清理 | - |
| `pnpm restart` | 重启所有服务 | 快速重启 | - |
| `pnpm status` | 显示服务状态 | 诊断 | - |
| `pnpm logs` | 查看实时日志 | 调试问题 | - |

### 1.2 启动脚本位置

```
nexu/
├── scripts/
│   ├── dev-launchd.sh          # 主启动脚本 (launchd 模式)
│   ├── dev-launchd-bg.sh       # 后台启动脚本 (tmux)
│   ├── dev-launchd.sh          # 启动入口
│   └── ...
├── apps/
│   ├── controller/
│   │   ├── src/index.ts        # Controller 主入口
│   │   └── src/app/env.ts      # 环境变量配置
│   ├── web/
│   │   ├── vite.config.ts      # Vite 配置 & 代理设置
│   │   └── src/main.tsx        # Web 主入口
│   └── desktop/
│       ├── dev.sh              # Desktop 启动脚本
│       └── scripts/dev-env.sh   # 环境设置脚本
└── package.json                # 根项目配置
```

---

## 2. 详细启动流程

### 2.1 `pnpm dev` 流程 (Web 开发)

```bash
pnpm dev
```

**执行链路**:
```
pnpm dev
  → package.json: "dev" script
    → NODE_OPTIONS=--conditions=development concurrently
      └─ pnpm --filter @nexu/controller dev
         └ tsx watch src/index.ts
         └ 监听端口 3010 (HOST=127.0.0.1)
         └ 读取 .env 配置
         └ 启动 OpenClaw 进程管理
      
      └─ pnpm --filter @nexu/web dev
         └ vite (Vite 开发服务器)
         └ 监听端口 5173
         └ 配置代理: /v1 → http://localhost:3010
         └ 配置代理: /api → http://localhost:3010
```

**Controller 启动细节** (`apps/controller/src/index.ts`):
```typescript
// 1. 创建容器 (加载所有服务)
const container = await createContainer();

// 2. 启动后台任务 (runtime 同步、health checks)
const stopBackgroundLoops = await bootstrapController(container);

// 3. 创建 Hono 应用
const app = createApp(container);

// 4. 启动 HTTP 服务器
const server = serve({
  fetch: app.fetch,
  hostname: container.env.host,    // 默认 127.0.0.1
  port: container.env.port,        // 默认 3010
});

// 5. 安装信号处理器 (SIGINT/SIGTERM)
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

**Web 启动细节** (`apps/web/vite.config.ts`):
```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,                     // 监听端口
    proxy: {
      '/v1': 'http://localhost:3010',        // API 代理
      '/api': 'http://localhost:3010',       // API 代理
      '/openapi.json': 'http://localhost:3010'  // OpenAPI 规范
    }
  }
});
```

### 2.2 `pnpm start` 流程 (Desktop 完整栈)

```bash
pnpm start
```

**执行链路**:
```
pnpm start
  → package.json: "start" script
    → ./scripts/dev-launchd.sh start

      Step 1: 全清理 (full_cleanup)
        ├─ pkill -9 Electron 进程
        ├─ launchctl bootout 所有 launchd 服务
        ├─ pkill openclaw/controller 进程
        └─ lsof 检查并杀死占用的端口进程

      Step 2: 构建所有工件
        ├─ rm -rf dist 目录 (确保干净构建)
        ├─ pnpm build
        │  ├─ packages/shared → dist
        │  ├─ apps/controller → dist
        │  └─ apps/desktop → dist-electron
        └─ 确保 apps/desktop/dist/index.html 存在

      Step 3: 清理旧的 plist 文件
        └─ rm -f $PLIST_DIR/*.plist

      Step 4: 启动文件监听器 (后台)
        ├─ Controller TSC 监听
        │  ├─ tsc --watch
        │  └─ 成功编译后 → launchctl kickstart 重启服务
        └─ Web 文件监听
           ├─ 每 3s 轮询检查源文件
           └─ 检测到变化 → pnpm build @nexu/web

      Step 5: 启动 Electron (阻塞)
        └─ NEXU_USE_LAUNCHD=1 \
           NEXU_HOME=$DEV_NEXU_HOME \
           apps/desktop/scripts/dev-env.sh \
           pnpm exec electron apps/desktop
           
           ├─ Electron 启动后自动创建 launchd 服务:
           │  ├─ io.nexu.controller.dev
           │  └─ io.nexu.openclaw.dev
           └─ 监听 localhost:50800 (Controller) 和 18789 (OpenClaw)
```

**Electron 启动流程**:
```typescript
// apps/desktop/main/index.ts
// 启动时决定是使用 launchd 还是本地进程管理

if (NEXU_USE_LAUNCHD) {
  // launchd 模式: 创建 plist 文件并通过 launchctl 管理
  await bootstrapWithLaunchd(container);
} else {
  // 本地进程模式: 直接启动 Controller 和 OpenClaw
  startLocalProcesses();
}
```

### 2.3 `pnpm start:bg` / `apps/desktop/dev.sh start` 流程 (Tmux 模式)

```bash
pnpm start:bg
# 或
./apps/desktop/dev.sh start
```

**执行链路**:
```
./apps/desktop/dev.sh start
  → Tmux 管理 (不使用 launchd)
    ├─ 杀死残留进程
    ├─ 构建所有工件
    └─ tmux new-session -d -s "nexu-desktop"
       └─ ./apps/desktop/scripts/dev-run.sh <launch_id>
          ├─ 设置环境变量
          ├─ 启动 Controller (监听 localhost:50800)
          ├─ 启动 OpenClaw (监听 localhost:18789)
          └─ 启动 Web (监听 localhost:5173 via Vite)
```

---

## 3. 环境变量与配置

### 3.1 顶层配置文件

**文件**: `/Users/qiyuan/Documents/Code/anthhub/ai/refly-team/nexu/.env`

```bash
# Database (仅开发模式使用, Web 可能需要)
DATABASE_URL=postgresql://nexu:nexu@localhost:5433/nexu_dev

# Auth
BETTER_AUTH_SECRET=nexu-dev-secret-change-in-production

# OAuth (留空将跳过 OAuth 按钮)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Encryption
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# Slack 集成
SLACK_CLIENT_ID=9430356045782.10623920877696
SLACK_CLIENT_SECRET=2e00925bb211c391f8da97990e060dc6
SLACK_SIGNING_SECRET=e01d16261dbe2e357b408ac96bea22b4

# Gateway / Internal Auth
GATEWAY_TOKEN=gw-secret-token
INTERNAL_API_TOKEN=gw-secret-token
SKILL_API_TOKEN=gw-secret-token

# Analytics
VITE_AMPLITUDE_API_KEY=489fa61cb058d4c6926cdefe259124f8

# 模型配置
DEFAULT_MODEL_ID=anthropic/claude-sonnet-4
LITELLM_BASE_URL=https://litellm.powerformer.net
LITELLM_API_KEY=sk-Ox1sdew3is9X1saArnu3Rg

# Email
RESEND_API_KEY=re_J4v6CBbL_27J9hJspso9o682CdFENcdSf
EMAIL_SENDER="Nexu <noreply@nexu.io>"

# Server
PORT=3000                              # Web 后端端口 (旧配置)
WEB_URL=http://localhost:5173          # Web 前端 URL

# OpenClaw State (本地开发)
OPENCLAW_STATE_DIR=/Users/qiyuan/.openclaw
```

### 3.2 Controller 环境变量 (schema)

**文件**: `apps/controller/src/app/env.ts`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | development | 运行环境 |
| `PORT` | 3010 | Controller 监听端口 |
| `HOST` | 127.0.0.1 | Controller 监听地址 |
| `NEXU_HOME` | ~/.nexu | Nexu 配置主目录 |
| `OPENCLAW_STATE_DIR` | $NEXU_HOME/runtime/openclaw/state | OpenClaw 状态目录 |
| `OPENCLAW_CONFIG_PATH` | $OPENCLAW_STATE_DIR/openclaw.json | OpenClaw 配置文件 |
| `OPENCLAW_GATEWAY_PORT` | 18789 | OpenClaw 网关端口 |
| `OPENCLAW_GATEWAY_TOKEN` | - | OpenClaw 网关认证令牌 |
| `WEB_URL` | http://localhost:5173 | Web 前端地址 |
| `DEFAULT_MODEL_ID` | link/gemini-3-flash-preview | 默认模型 ID |
| `RUNTIME_MANAGE_OPENCLAW_PROCESS` | false | 是否由 Controller 管理 OpenClaw 进程 |
| `RUNTIME_SYNC_INTERVAL_MS` | 2000 | Runtime 同步间隔 |
| `RUNTIME_HEALTH_INTERVAL_MS` | 5000 | Runtime 健康检查间隔 |

### 3.3 Local Dev 特定配置

#### `pnpm start` 模式:
```bash
# 这些由启动脚本自动设置
NEXU_USE_LAUNCHD=1              # 启用 launchd 管理
NEXU_HOME=$REPO_ROOT/.tmp/desktop/nexu-home   # 开发模式主目录
NEXU_WORKSPACE_ROOT=$REPO_ROOT  # 工作空间根目录

# 服务端口 (在 dev-launchd.sh 中定义)
CONTROLLER_PORT=50800           # 开发模式 Controller 端口
OPENCLAW_PORT=18789             # OpenClaw 网关端口
```

#### 日志和状态目录:
```bash
# 启动脚本创建:
$REPO_ROOT/.tmp/desktop/nexu-home/          # 开发主目录
$REPO_ROOT/.tmp/desktop/nexu-home/logs/     # 日志目录
$REPO_ROOT/.tmp/launchd/                    # launchd plist 文件
$REPO_ROOT/.tmp/launchd/runtime-ports.json  # 端口信息

# 访问:
pnpm logs   # 查看实时日志
```

---

## 4. 本地开发的实际步骤

### 4.1 初始化 (首次设置)

```bash
cd /Users/qiyuan/Documents/Code/anthhub/ai/refly-team/nexu

# 1. 安装依赖
pnpm install

# 2. 确保 OpenClaw runtime 正确
pnpm openclaw-runtime:install
```

### 4.2 Web 开发工作流 (快速迭代)

```bash
# Terminal 1: 启动 Controller + Web
pnpm dev

# 打开浏览器
open http://localhost:5173

# Web 会自动代理 API 请求到 Controller
# Controller 自动启动 OpenClaw
```

**日志输出示例**:
```
> @nexu/controller@0.0.1 dev
  tsx watch src/index.ts

[17:30:45] Starting compilation in watch mode...

> @nexu/web@0.0.1 dev
  vite

  VITE v6.1.1  ready in 245 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h + enter to show help

[controller] Controller started - localhost:3010
[controller] OpenClaw gateway listening on port 18789
```

### 4.3 Desktop 完整测试工作流

```bash
# 启动完整栈
pnpm start

# Electron 窗口自动打开，显示 Nexu Desktop 应用
# 日志实时输出到终端

# 监听文件变化:
# - Controller 代码变化 → 自动重编译 → launchctl 重启服务
# - Web 代码变化 → 自动重构建 → 刷新页面查看

# 停止所有服务
pnpm stop

# 查看服务状态
pnpm status
```

### 4.4 后台开发工作流 (后台运行)

```bash
# 启动并在后台运行
pnpm start:bg

# 应用在后台通过 tmux 运行
# 继续使用 terminal

# 查看后台日志
pnpm logs:bg

# 停止后台服务
pnpm stop:bg

# 重启后台服务
pnpm restart:bg
```

---

## 5. 启动时的清理和初始化

### 5.1 全清理流程 (每次启动前)

在 `dev-launchd.sh` 中自动执行:

```bash
full_cleanup() {
  # 1. 杀死 Electron 进程
  pkill -9 -f "Electron.*apps/desktop"
  
  # 2. Bootout launchd 服务
  launchctl bootout gui/<uid>/io.nexu.openclaw.dev
  launchctl bootout gui/<uid>/io.nexu.controller.dev
  
  # 3. 杀死残留进程
  pkill -9 -f "openclaw.mjs gateway"
  pkill -9 -f "controller/dist/index.js"
  
  # 4. 释放端口
  lsof -ti :50800 | xargs kill -9
  lsof -ti :18789 | xargs kill -9
}
```

### 5.2 Plist 文件管理

```bash
# 自动创建的 plist 文件位置
$REPO_ROOT/.tmp/launchd/io.nexu.controller.dev.plist
$REPO_ROOT/.tmp/launchd/io.nexu.openclaw.dev.plist

# 每次启动前清理旧 plist 确保重新生成
rm -f $REPO_ROOT/.tmp/launchd/*.plist
```

### 5.3 构建工件清理

```bash
# 清理过期的 dist 目录
rm -rf packages/shared/dist
rm -rf apps/controller/dist
rm -rf apps/desktop/dist-electron

# 重新构建所有工件
pnpm build
```

---

## 6. 关键配置点

### 6.1 Port 映射

| 组件 | Web Dev | Desktop (launchd) | 说明 |
|------|---------|-------------------|------|
| Web (Vite) | 5173 | 5173 (via Electron) | React 开发服务器 |
| Controller | 3010 | 50800 (launchd) | HTTP API 服务器 |
| OpenClaw | N/A | 18789 | OpenClaw 网关 |

### 6.2 代理设置

**Web → Controller 代理** (vite.config.ts):
```typescript
proxy: {
  '/v1': 'http://localhost:3010',      // Controller API
  '/api': 'http://localhost:3010',     // Controller API
  '/openapi.json': 'http://localhost:3010'  // OpenAPI spec
}
```

**Desktop 模式**: Web 通过 Electron 内嵌，直接访问本地服务

### 6.3 文件监听和热更新

**Controller** (dev-launchd.sh):
```bash
# 启动 TSC 监听
tsc --watch

# 成功编译后
launchctl kickstart -k gui/<uid>/io.nexu.controller.dev
# 自动重启 Controller
```

**Web** (dev-launchd.sh):
```bash
# 每 3s 轮询检查源文件
while true; do
  hash=$(find apps/web/src -name '*.ts' -o -name '*.tsx' | md5)
  if [ "$hash" != "$last_hash" ]; then
    pnpm --filter @nexu/web build
  fi
  sleep 3
done
```

---

## 7. 故障排查

### 7.1 常见问题

| 问题 | 症状 | 解决方案 |
|------|------|---------|
| Port 已被占用 | `address already in use` | `pnpm stop` 或 `pnpm reset-state` |
| Electron 无法启动 | 窗口不出现，进程退出 | `pnpm logs` 查看错误，检查 Electron 版本 |
| Controller 无法连接 OpenClaw | 504 错误 | 检查 OpenClaw 进程，查看 `pnpm status` |
| Web 代码更新不生效 | 刷新页面无变化 | 清理浏览器缓存，或重启 `pnpm start` |
| 磁盘空间不足 | 构建失败 | 运行 `pnpm reset-state` 清理 `.tmp/` |

### 7.2 诊断命令

```bash
# 查看所有服务状态
pnpm status

# 查看实时日志
pnpm logs

# 杀死并清理所有进程
pnpm stop

# 完全重置本地状态
pnpm reset-state

# 检查端口占用
lsof -i :3010  # Controller
lsof -i :18789 # OpenClaw
lsof -i :5173  # Web
```

### 7.3 手动重启单个服务

```bash
# 需要 launchd 时
UID=$(id -u)
DOMAIN="gui/$UID"

# 重启 Controller
launchctl kickstart -k "$DOMAIN/io.nexu.controller.dev"

# 重启 OpenClaw
launchctl kickstart -k "$DOMAIN/io.nexu.openclaw.dev"

# 查看服务状态
launchctl print "$DOMAIN/io.nexu.controller.dev"
```

---

## 8. 高级配置

### 8.1 自定义端口

在启动脚本中设置环境变量:

```bash
# 修改 dev-launchd.sh 或通过环境变量覆盖
CONTROLLER_PORT=9000 \
OPENCLAW_PORT=19000 \
pnpm start
```

### 8.2 使用远程 OpenClaw

```bash
# 不使用本地 OpenClaw，而是连接远程网关
RUNTIME_MANAGE_OPENCLAW_PROCESS=false \
OPENCLAW_GATEWAY_PORT=8080 \
pnpm dev
```

### 8.3 连接到 Cloud 服务

```bash
# 在 .env 中配置
CLOUD_URL=http://localhost:3000  # Cloud API 服务器
LITELLM_BASE_URL=...             # 模型提供者
```

---

## 9. 生产与开发差异

### 9.1 数据存储位置

| 模式 | 配置目录 | 运行时目录 | 日志 |
|------|---------|-----------|------|
| 开发 (`pnpm dev`) | `~/.nexu/` | `~/.openclaw/` (或通过 OPENCLAW_STATE_DIR) | 控制台 |
| 开发 (`pnpm start`) | `.tmp/desktop/nexu-home/` | `.tmp/desktop/nexu-home/runtime/` | `.tmp/desktop/nexu-home/logs/` |
| 打包应用 | `~/.nexu/` | `~/Library/Application Support/@nexu/desktop/` | `~/.nexu/logs/` |

### 9.2 进程管理

| 模式 | 管理方式 | 优势 | 劣势 |
|------|---------|------|------|
| `pnpm dev` | 前台进程 | 简单，快速 | 无法关闭终端 |
| `pnpm start` | launchd 服务 | 模拟真实环境，稳定 | 复杂性高 |
| `pnpm start:bg` | tmux 会话 | 后台运行，可持久化 | tmux 额外学习成本 |

---

## 10. 性能优化

### 10.1 增量编译

```bash
# 仅构建改变的包
pnpm --filter @nexu/web build

# 避免从零构建
pnpm build  # 第一次较慢
pnpm build  # 第二次使用缓存，快速
```

### 10.2 ESM 导入优化

```bash
# 检查 ESM 导入问题
pnpm check:esm-imports
```

### 10.3 类型检查和 Linting

```bash
# 后台运行类型检查（不阻塞启动）
pnpm typecheck

# 检查代码风格
pnpm lint

# 自动修复
pnpm lint:fix
```

---

## 11. 关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| Controller 启动 | `apps/controller/src/index.ts` | 7-47 |
| 环境变量 | `apps/controller/src/app/env.ts` | 40-142 |
| Web 代理配置 | `apps/web/vite.config.ts` | 15-22 |
| Launchd 启动 | `scripts/dev-launchd.sh` | 156-232 |
| Desktop 启动 | `apps/desktop/dev.sh` | 129-159 |
| Electron 主进程 | `apps/desktop/main/index.ts` | TBD |

---

## 12. 快速参考卡

### 启动
```bash
pnpm dev          # Web 开发
pnpm start        # Desktop 完整测试
pnpm start:bg     # 后台运行
```

### 停止与诊断
```bash
pnpm stop         # 停止服务
pnpm status       # 查看状态
pnpm logs         # 查看日志
pnpm reset-state  # 完全重置
```

### 构建与测试
```bash
pnpm build        # 构建所有
pnpm typecheck    # 类型检查
pnpm lint         # 代码检查
pnpm test         # 运行测试
```

### 代码生成
```bash
pnpm generate-types  # 生成 OpenAPI SDK
```

---

**调查完成日期**: 2026-04-01  
**报告版本**: 1.0
