# Feishu

All you need is an App ID and App Secret to connect your Feishu bot to nexu.

## Step 1: Create a Feishu app

1. Go to the [Feishu Open Platform](https://open.feishu.cn/app), sign in, and click "Create Custom App".

![Feishu Open Platform app list](/assets/feishu/step1-app-list.png)

2. Fill in the app name, description, choose an icon, and click "Create".

![Create Custom App](/assets/feishu/step1-create-app.png)

3. On the "Credentials & Basic Info" page, copy these two values:
   - **App ID**
   - **App Secret**

![Get App ID and App Secret](/assets/feishu/step1-credentials.png)

## Step 2: Import app permissions

In the Feishu Open Platform, go to your app, click "Permission Management" on the left sidebar, then click "Batch Enable" and paste the following JSON:

::: details Click to expand permissions JSON
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

These permissions cover messaging, document read/write, calendar management, spreadsheet operations, and more — ensuring all nexu Agent Skills work properly.

## Step 3: Add credentials to nexu

Open the nexu client, enter the App ID and App Secret in the Feishu channel settings, and click "Connect".

![Add credentials in nexu](/assets/feishu/step3-nexu-connect.jpeg)

## Step 4: Publish and test

1. Go back to the Feishu Open Platform, navigate to "Version Management & Release".

![Version Management & Release](/assets/feishu/step4-version-manage.png)

2. Click "Create Version", fill in the version number and release notes, then click "Save".

![Create Version](/assets/feishu/step4-create-version.png)

3. Click "Publish" and wait for approval.

![Publish](/assets/feishu/step4-publish.png)

4. Once approved, click "Chat" in the nexu client to jump to Feishu and chat with your bot 🎉

![Feishu connected](/assets/feishu/step3-connected.png)

## FAQ

**Q: Do I need a public server?**

No. nexu uses Feishu's long-connection (WebSocket) mode — no public IP or callback URL required.

**Q: Why are so many permissions needed?**

These permissions correspond to various nexu Agent Skills (messaging, docs, calendar, spreadsheets, etc.). If you only need basic chat, you can enable just the `im:` scopes.

