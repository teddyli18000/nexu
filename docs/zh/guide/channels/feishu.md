# 飞书

只需获取 App ID 和 App Secret，即可将飞书机器人接入 nexu。

## 第一步：创建飞书应用

1. 打开 [飞书开放平台](https://open.feishu.cn/app)，登录你的飞书账号，点击「创建企业自建应用」。

![飞书开放平台应用列表](/assets/feishu/step1-app-list.png)

2. 填写应用名称、描述，选择图标，点击「创建」。

![创建企业自建应用](/assets/feishu/step1-create-app.png)

3. 进入「凭证与基础信息」页面，复制以下两个参数：
   - **App ID**
   - **App Secret**

![获取 App ID 和 App Secret](/assets/feishu/step1-credentials.png)

## 第二步：导入应用权限

在飞书开放平台，进入你的应用，点击左侧「权限管理」，然后点击「批量开通」，将以下 JSON 粘贴导入：

::: details 点击展开权限 JSON
```json
{
  "scopes": {
    "tenant": [
      "board:whiteboard:node:create",
      "board:whiteboard:node:delete",
      "board:whiteboard:node:read",
      "board:whiteboard:node:update",
      "calendar:calendar.acl:create",
      "calendar:calendar.acl:delete",
      "calendar:calendar.acl:read",
      "calendar:calendar.event:create",
      "calendar:calendar.event:delete",
      "calendar:calendar.event:read",
      "calendar:calendar.event:reply",
      "calendar:calendar.event:update",
      "calendar:calendar.free_busy:read",
      "calendar:calendar:create",
      "calendar:calendar:delete",
      "calendar:calendar:read",
      "calendar:calendar:subscribe",
      "calendar:calendar:update",
      "cardkit:card:write",
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "docs:document.comment:create",
      "docs:document.comment:read",
      "docs:document.comment:update",
      "docs:document.comment:write_only",
      "docs:permission.member:create",
      "docx:document.block:convert",
      "docx:document:create",
      "docx:document:readonly",
      "docx:document:write_only",
      "drive:drive.metadata:readonly",
      "drive:drive.search:readonly",
      "drive:drive:version",
      "drive:drive:version:readonly",
      "im:app_feed_card:write",
      "im:biz_entity_tag_relation:read",
      "im:biz_entity_tag_relation:write",
      "im:chat",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.announcement:read",
      "im:chat.announcement:write_only",
      "im:chat.chat_pins:read",
      "im:chat.chat_pins:write_only",
      "im:chat.collab_plugins:read",
      "im:chat.collab_plugins:write_only",
      "im:chat.managers:write_only",
      "im:chat.members:bot_access",
      "im:chat.members:read",
      "im:chat.members:write_only",
      "im:chat.menu_tree:read",
      "im:chat.menu_tree:write_only",
      "im:chat.moderation:read",
      "im:chat.tabs:read",
      "im:chat.tabs:write_only",
      "im:chat.top_notice:write_only",
      "im:chat.widgets:read",
      "im:chat.widgets:write_only",
      "im:chat:create",
      "im:chat:delete",
      "im:chat:moderation:write_only",
      "im:chat:operate_as_owner",
      "im:chat:read",
      "im:chat:readonly",
      "im:chat:update",
      "im:datasync.feed_card.time_sensitive:write",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message.pins:read",
      "im:message.pins:write_only",
      "im:message.reactions:read",
      "im:message.reactions:write_only",
      "im:message.urgent",
      "im:message.urgent.status:write",
      "im:message.urgent:phone",
      "im:message.urgent:sms",
      "im:message:readonly",
      "im:message:recall",
      "im:message:send_as_bot",
      "im:message:send_multi_depts",
      "im:message:send_multi_users",
      "im:message:send_sys_msg",
      "im:message:update",
      "im:resource",
      "im:tag:read",
      "im:tag:write",
      "im:url_preview.update",
      "im:user_agent:read",
      "sheets:spreadsheet.meta:read",
      "sheets:spreadsheet.meta:write_only",
      "sheets:spreadsheet:create",
      "sheets:spreadsheet:read",
      "sheets:spreadsheet:write_only",
      "task:task:read",
      "task:task:write",
      "task:tasklist:read",
      "task:tasklist:write",
      "wiki:member:create",
      "wiki:member:retrieve",
      "wiki:member:update",
      "wiki:wiki:readonly"
    ],
    "user": [
      "contact:contact.base:readonly"
    ]
  }
}
```
:::

这些权限涵盖了消息收发、文档读写、日历管理、电子表格操作等能力，确保 nexu Agent 的各项 Skills 能正常工作。

## 第三步：在 nexu 中填入凭证

打开 nexu 客户端，在飞书渠道配置中填入 App ID 和 App Secret，点击「Connect」。

![在 nexu 中填入凭证](/assets/feishu/step3-nexu-connect.jpeg)

## 第四步：发布应用并测试

1. 回到飞书开放平台，进入「版本管理与发布」。

![版本管理与发布](/assets/feishu/step4-version-manage.png)

2. 点击「创建版本」，填写版本号和更新说明，点击「保存」。

![创建版本](/assets/feishu/step4-create-version.png)

3. 点击「确认发布」，等待审核通过。

![确认发布](/assets/feishu/step4-publish.png)

4. 等待审核通过后，在 nexu 客户端点击「Chat」即可跳转到飞书与机器人对话 🎉

![飞书已连接](/assets/feishu/step3-connected.png)

## 常见问题

**Q: 需要公网服务器吗？**

不需要。nexu 使用飞书长连接（WebSocket）模式，无需公网 IP 或回调地址。

**Q: 为什么需要这么多权限？**

这些权限对应 nexu Agent 的各项 Skills（消息、文档、日历、电子表格等）。如果你只需要基础聊天功能，可以只开通 `im:` 开头的权限。

