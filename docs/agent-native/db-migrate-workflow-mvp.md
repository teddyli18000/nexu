# DB Migrate Workflow MVP（Apply API）

## 目标

- 在 CI 中自动识别变更 migration SQL，并生成 manifest。
- 在存在 migration 文件时，真实调用 migrate apply API 执行迁移。
- 在无 migration 文件时安全跳过，不阻塞流水线。

## 当前实现

- Workflow 文件：`.github/workflows/db-migrate.yml`
- 触发方式：`push` 到 `main`（用于 PR 合并后触发）
- 并发控制：同一分支仅保留最新一次运行（`cancel-in-progress: true`）
- API Endpoint：`https://5jhbys8c46.execute-api.us-east-1.amazonaws.com/migrate/apply`
- 认证方式：`x-api-key: ${{ secrets.NEXU_DB_MIGRATE_API_KEY }}`（仅 Secret 注入，不明文输出）

## 执行逻辑

1. `checkout` 仓库（`fetch-depth: 0`）。
2. 使用 `github.event.before...github.sha` 作为本次 push 的 diff range。
3. 过滤该范围内 `apps/api/migrations/**/*.sql` 的变更文件。
4. 若无 SQL 变更：
   - 设置 `has_migrations=false`
   - 写入 Step Summary（`skipped` + diff range）
   - 直接结束，不调用 API。
5. 若有 SQL 变更：
   - 生成 manifest（`$RUNNER_TEMP/nexu-db-migration-manifest.json`）
   - 设置 `has_migrations=true` 与 `manifest_path`
   - 调用 migrate apply API（`POST`，`--data @manifest`）
   - 输出 HTTP 状态码 + 响应体（同时写入 Step Summary）
   - 非 2xx 直接 `exit 1` 使 Job 失败。

## Manifest 结构

- 顶层字段：`repository` / `ref` / `sha` / `runId` / `eventName` / `generatedAt`
- `files[]` 字段：
  - `path`
  - `sha256`
  - `sql`（完整 SQL 内容）

## API 调用与输出

- 请求头：
  - `content-type: application/json`
  - `x-api-key: ${{ secrets.NEXU_DB_MIGRATE_API_KEY }}`
- 请求体：`--data @${manifest_path}`
- 响应文件：
  - 原始响应：`$RUNNER_TEMP/migrate-apply-response.json`
  - 美化响应：`$RUNNER_TEMP/migrate-apply-response-pretty.json`
- 可观测性：
  - 控制台输出 `HTTP status` 与响应体
  - `GITHUB_STEP_SUMMARY` 展示检测结果、文件列表、调用结果与响应详情

## 已验证场景（2026-03-06）

- 无 migration 文件：`success`，跳过调用。
- 同 path + 同 hash 重跑：`success`，文件状态为 `skipped`。
- 同 path + 不同 hash：`failure`，HTTP `409`（路径冲突拦截）。
- 多个 migration SQL：`success`，可同时出现 `applied` + `skipped`。

## 现阶段约束

- 仍为 MVP：目前通过 `push main` 实现“PR 合并后触发”，若存在直接 push 到 main 也会触发。
- 环境审批、OIDC、分环境路由等增强能力尚未接入。

## 说明

- 历史验证使用过 comment-only 的 mock migration 文件；正式合并前已移除，不会进入主分支。
