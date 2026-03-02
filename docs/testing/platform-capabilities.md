# Slack & Discord 能力验证

> 返回 [测试总览](../TESTING.md)
>
> 需要真实 Slack workspace / Discord server。建议创建专用测试环境。

## 1. Slack 能力验证

### 1.1 消息处理

- [ ] **DM 对话：** 直接给 bot 发私信 → bot 正常回复
- [ ] **Channel @mention：** 在频道 @bot → bot 回复
- [ ] **线程回复：** bot 回复出现在正确的 thread 中
- [ ] **长文本分块：** 让 bot 生成 >4000 字符回复 → 正确分多条发送
- [ ] **消息编辑通知：** 编辑消息后 bot 不重复回复（`message_changed` subtype 处理）
- [ ] **Bot 消息忽略：** bot 自己的消息不触发回复循环

### 1.2 Streaming 模式

| 模式 | 配置值 | 预期行为 |
|------|--------|---------|
| 关闭 | `streaming: "off"` | 等待完整生成后一次性发送 |
| 逐步更新 | `streaming: "partial"` | 同一条消息持续更新内容 |
| 追加模式 | `streaming: "block"` | 新内容追加到已有消息 |
| 进度指示 | `streaming: "progress"` | "思考中..." 指示器 → 最终完整回复 |

### 1.3 Agent Tools

- [ ] **Web search：** 问 bot "今天的新闻" → 返回网页搜索结果
- [ ] **Web fetch：** 让 bot 抓取指定 URL 内容 → 返回页面摘要
- [ ] **Cron 定时任务：** 让 bot 设置 "每分钟提醒我" → 定时消息发送
- [ ] **Exec sandbox：** 让 bot 执行 `echo hello` → 返回 sandbox 输出
- [ ] **Emoji reaction：** 让 bot 给消息加 emoji → 消息出现 reaction
- [ ] **Pin 消息：** 让 bot pin 一条消息 → 消息被 pin

### 1.4 多 Bot 路由

- [ ] **同 pool 多 bot：** bot-A 在 workspace-A 回复，bot-B 在 workspace-B 回复，互不干扰
- [ ] **Binding 映射：** Slack accountId → 正确 agentId，验证 config bindings 生效
- [ ] **Default agent：** 未明确绑定的请求 → 路由到 default agent

### 1.5 错误恢复

- [ ] **Gateway 重启：** 重启 Gateway pod → Slack 消息在重启后恢复响应
- [ ] **Slack retry：** 模拟超时 → Slack 发 retry → `x-slack-retry-num` 被跳过
- [ ] **LLM 调用失败：** 设置无效 model ID → bot 返回错误消息（不崩溃）
- [ ] **Credential 过期：** 更换 Slack token 后未更新 Nexu → 签名验证失败 → 清晰错误日志

### 1.6 Slack API 限流行为

- [ ] **Tier 1 限流：** 快速发送多条消息 → bot 响应是否被 429 影响
- [ ] **SDK retry：** OpenClaw Slack SDK 配置 2 次 retry、500ms-3s 指数退避
- [ ] **多 channel 并发：** 多个 channel 同时收到消息 → 各自独立回复

---

## 2. Discord 能力验证

### 2.1 消息处理

- [ ] **Guild 文本频道：** 在频道发送消息 → bot 正常回复
- [ ] **DM 对话：** 给 bot 发私信 → bot 正常回复
- [ ] **线程回复：** bot 回复出现在正确的 thread 中
- [ ] **长文本分块：** bot 生成 >2000 字符回复 → 正确分多条发送（Discord 限制 2000 字符/条）
- [ ] **Bot 消息忽略：** bot 不回复自己或其他 bot 的消息（`allowBots: false` 默认）
- [ ] **@mention 触发：** 配置 `requireMention: true` 后，仅 @bot 才回复

### 2.2 交互组件

- [ ] **Buttons：** bot 发送带按钮的消息 → 点击按钮触发 agent 处理
- [ ] **Select menus：** bot 发送下拉选择 → 选择后触发 agent 处理
- [ ] **Modals：** agent 弹出表单 → 填写提交 → agent 接收数据
- [ ] **Embeds：** bot 发送带 embed 的消息（标题、颜色、字段、图片）
- [ ] **Slash commands：** 注册自定义 /命令 → 执行后返回结果

### 2.3 高级功能

- [ ] **Forum channel：** 在论坛频道发帖 → bot 自动创建 thread 并回复
- [ ] **Emoji reaction：** 让 bot 给消息加 emoji → 消息出现 reaction
- [ ] **Pin 消息：** 让 bot pin/unpin 消息
- [ ] **文件上传：** bot 发送文件附件
- [ ] **Voice message：** bot 发送语音消息（OGG/Opus 格式）
- [ ] **Poll 投票：** bot 创建投票 → 用户可投票
- [ ] **Sticker：** bot 发送贴纸

### 2.4 Guild 管理（Agent Tools）

- [ ] **memberInfo：** 查询用户信息（角色、昵称、加入时间）
- [ ] **roleAdd / roleRemove：** 给用户添加/移除角色
- [ ] **channelCreate / channelEdit：** 创建/编辑频道
- [ ] **channelList：** 列出 guild 所有频道
- [ ] **eventCreate / eventList：** 创建/列出 scheduled events
- [ ] **timeout / kick / ban：** 管理员操作（需要对应权限）

### 2.5 多 Bot 路由

- [ ] **同 pool 多 bot：** bot-A 在 guild-A 回复，bot-B 在 guild-B 回复
- [ ] **Binding 映射：** Discord accountId → 正确 agentId
- [ ] **Per-guild 配置：** 不同 guild 不同 `groupPolicy` / `requireMention` 设置生效
- [ ] **Per-channel 配置：** 特定频道启用/禁用 bot、频道级别 system prompt

### 2.6 Thread Binding & Session

- [ ] **/focus 命令：** 在 thread 中执行 → thread 绑定到当前 session
- [ ] **TTL 过期：** thread binding 在 24h 后自动解绑
- [ ] **Subagent thread：** 启用 `spawnSubagentSessions` → subagent 自动创建新 thread

### 2.7 错误恢复

- [ ] **WebSocket 断连重连：** 网络中断后自动重连（指数退避）
- [ ] **Rate limit 429：** 快速发送多条消息 → SDK 自动 retry（3 次、500ms-30s 指数退避）
- [ ] **权限不足：** bot 缺少 `SEND_MESSAGES` 权限 → 清晰错误日志（不崩溃）
- [ ] **DM 被禁：** 用户禁止 DM → 错误码 50007 → 清晰提示
- [ ] **Gateway 重启：** Gateway pod 重启后 Discord bot 自动重连

### 2.8 Discord Streaming 模式

| 模式 | 配置值 | 预期行为 |
|------|--------|---------|
| 关闭 | `streaming: "off"` | 完整回复一次性发送 |
| 逐步更新 | `streaming: "partial"` | 同一条消息持续编辑更新 |
| 块追加 | `streaming: "block"` | 内容按块追加到消息 |
| 进度指示 | `streaming: "progress"` | "思考中..." → 最终回复 |
