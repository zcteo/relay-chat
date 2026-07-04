# 服务器存储版本方案

状态：本文档是账号同步存储功能的设计记录，用于理解设计背景和 API 意图。当前实现和开发约束以 `docs/HANDOFF.md` 及代码为准；如果本文档与代码不一致，先核对代码，再同步更新交接文档。

本文档描述 RelayChat 账号同步存储的完整设计。目标是让未登录本地使用和登录账号同步同时存在，并保持两套数据边界清晰。

## 目标

- 未登录时，数据只保存在当前浏览器。
- 登录后，通过账号在服务器保存配置和历史。
- 设置界面未登录时显示“登录”按钮；登录后显示用户名和“注销”按钮。
- 同一用户可多端登录。
- 服务器只保存：
  - API Base URL
  - API Token
  - 多组 URL/Token
  - 当前所选模型
  - 当前协议
  - 模型列表
  - 对话记录
- 服务器不保存主题等纯本机偏好。
- 除“新用户第一次登录后主动上传本地数据”外，不做本地数据和服务器数据的自动同步或合并。

## 登录状态行为

### 首次访问

前端读取 `SERVER_AUTH_KEY`：

- 没有服务器 token：加载浏览器 localStorage 中的本地数据，设置界面显示“登录”按钮。
- 有服务器 token：请求账号信息、AI 配置和会话列表。

### 未登录本地使用

- 使用 localStorage 保存完整状态。
- 不需要登录。
- 数据不会上传到服务器。
- 不参与多设备同步。

### 登录账号同步

- 需要登录。
- 登录后从服务器加载账号信息、AI 配置和会话列表。
- 首页默认显示一个空的新会话状态。
- 不自动加载任何历史会话消息。
- 用户点击历史会话时，再请求该会话消息。
- 用户在空新会话中发送第一条消息时，再创建服务器会话。

### 从未登录切换到登录

- 显示登录/注册界面。
- 登录成功后加载服务器数据。
- 默认不读取、不迁移、不处理当前本地数据。
- 只有服务器判断该账号仍需首次导入提示时，才询问是否上传当前本地数据。

### 从登录切换到未登录

- 自动调用登出接口。
- 清除当前设备保存的服务器登录 token。
- 加载以前的本地 localStorage 数据。
- 不下载服务器数据到本地。

## 新用户首次上传本地数据

仅在用户第一次登录账号后触发。

流程：

1. 用户登录成功。
2. 服务器返回 `shouldOfferLocalUpload`。
3. 如果 `shouldOfferLocalUpload` 为 `true`，且当前浏览器存在本地数据，前端询问是否上传本地数据。
4. 用户确认后，前端调用 `POST /api/import-local` 上传本地数据。
5. 上传成功后，前端询问用户是否删除当前本地数据。
6. 用户选择删除时，前端清除离线本地聊天和 AI 配置数据，但保留服务器登录态。
7. 用户拒绝上传时，前端调用 `POST /api/import-local/skip`，服务器后续不再提示。

约束：

- 上传只发生在用户明确确认后。
- 上传成功后是否删除本地数据也需要用户明确确认。
- 后续登录不再重复提示。
- 不做本地和服务器数据合并。

## 登录 Token 机制

登录账号同步使用单层登录 token，不使用 refresh token。

规则：

- 登录成功后生成随机 token。
- 数据库只保存 token hash。
- 前端保存明文 token。
- token 默认有效期为 7 天。
- 同一用户可以在多端同时登录，每次登录生成一条独立 token 记录。
- 每次使用有效 token 访问需要登录的接口时，服务器把该 token 的过期时间重置为当前时间加 7 天。
- token 过期时间只在服务器内部管理，不通过响应体或响应头告诉前端。
- 如果用户超过 7 天没有使用该 token，再次请求服务器接口时返回 `401`。
- 前端收到 `401` 后清除服务器登录 token，并显示登录界面。
- 前端不主动倒计时、不提前刷新、不显示剩余登录时间。
- `GET /api/profile` 每次请求时清理一次 `login_tokens` 表中已过期或已撤销的 token。

登出规则：

- `POST /api/logout` 只撤销当前设备 token。
- 不影响同一用户在其他设备上的 token。

## 前端本地 Key

当前不再保存独立模式 key。前端通过是否存在服务器登录态判断使用账号数据还是本地数据：

```js
const LOCAL_STATE_KEY = "relaychat-state-v1"
const SERVER_AUTH_KEY = "relaychat-server-auth-v1"
```

`SERVER_AUTH_KEY` 示例：

```js
{
  token: "",
  user: {
    id: "",
    username: ""
  }
}
```

不保存 token 过期时间。

## 前端文件规划

```text
static/
├── index.html
├── app.js                  # 主 UI、聊天流、模式切换
├── markdown.js             # Markdown 渲染，继续独立维护
├── storage-local.js        # localStorage 适配器
├── storage-server.js       # 服务器 API 适配器
├── auth.js                 # 登录 token 保存、401 处理、登出
└── style.css
```

前端主 UI 不应直接关心数据来自 localStorage 还是服务器。建议抽象统一存储接口：

```js
storage.loadInitialData()
storage.saveSettings(settings)
storage.createSession(session)
storage.updateSession(session)
storage.deleteSession(id)
storage.loadMessages(sessionId)
storage.createMessage(sessionId, message)
storage.updateMessage(messageId, patch)
```

## 后端文件规划

```text
server/
├── __init__.py
├── main.py                 # FastAPI app、静态文件、路由挂载、公共异常处理
├── config.py               # 数据库路径、token 密钥、7 天有效期等配置
├── db.py                   # SQLite 连接、初始化、事务工具
├── auth.py                 # 密码哈希、token 签发、token 校验、滑动续期
├── proxy_api.py            # /api/chat 和 /api/models 转发接口
└── data_api.py             # 注册、登录、登出、profile、settings、sessions、messages
```

## 数据库规划

### users

账号和服务器版 AI 配置放在同一张表。

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  api_base_url TEXT NOT NULL DEFAULT '',
  api_token TEXT NOT NULL DEFAULT '',
  api_credentials_json TEXT NOT NULL DEFAULT '{}',
  selected_model TEXT NOT NULL DEFAULT '',
  protocol TEXT NOT NULL DEFAULT 'openai_responses',
  models_json TEXT NOT NULL DEFAULT '[]',
  first_login_completed INTEGER NOT NULL DEFAULT 0,
  local_upload_offered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### login_tokens

支持同一用户多端登录。

```sql
CREATE TABLE login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### sessions

```sql
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### messages

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  thinking TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### 索引

```sql
CREATE UNIQUE INDEX idx_users_username ON users(username);
CREATE UNIQUE INDEX idx_login_tokens_hash ON login_tokens(token_hash);
CREATE INDEX idx_login_tokens_user_id ON login_tokens(user_id);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
```

## API 设计

所有需要登录的接口都使用：

```http
Authorization: Bearer <token>
```

token 有效时，服务器内部自动把当前 token 续期 7 天。响应中不返回过期时间。

### POST /api/register

注册新用户，不自动登录。

请求：

```json
{
  "username": "alice",
  "password": "password"
}
```

返回：

```json
{
  "user": {
    "id": 1,
    "username": "alice"
  },
  "ok": true
}
```

作用：

- 创建用户。
- 初始化空服务器配置。
- 前端注册成功后返回登录界面，由用户再登录。

### POST /api/login

登录已有用户。

请求：

```json
{
  "username": "alice",
  "password": "password"
}
```

返回：

```json
{
  "user": {
    "id": 1,
    "username": "alice"
  },
  "token": "...",
  "shouldOfferLocalUpload": false
}
```

作用：

- 校验用户名和密码。
- 创建当前设备新的登录 token。
- 不影响同一用户其他设备 token。
- 返回是否需要提示首次上传本地数据。

### POST /api/logout

登出当前设备。

认证：需要 token。

返回：

```json
{
  "ok": true
}
```

作用：

- 撤销当前 token。
- 不影响同一用户其他设备。

### GET /api/profile

获取账号信息和服务器版 AI 配置。

认证：需要 token。

返回：

```json
{
  "user": {
    "id": 1,
    "username": "alice"
  },
  "settings": {
    "baseUrl": "https://api.example.com",
    "token": "sk-...",
    "apiCredentials": {
      "https://api.example.com": "sk-...",
      "https://api.backup.example.com": "sk-backup..."
    },
    "model": "gpt-4.1",
    "protocol": "openai_chat",
    "models": [{ "id": "gpt-4.1" }, { "id": "claude-sonnet-4" }]
  }
}
```

作用：

- 页面进入登录账号同步后加载账号和 AI 配置。
- 不返回会话列表。
- 不返回消息。
- 不创建新会话。

### PUT /api/settings

完整保存服务器版 AI 配置。

认证：需要 token。

请求：

```json
{
  "baseUrl": "https://api.example.com",
  "token": "sk-...",
  "apiCredentials": {
    "https://api.example.com": "sk-..."
  },
  "model": "gpt-4.1",
  "protocol": "openai_chat",
  "models": [{ "id": "gpt-4.1" }]
}
```

作用：

- 覆盖保存用户的当前 API Base URL、当前 API Token、多组 URL/Token、当前模型、协议和模型列表。

### PATCH /api/settings

局部更新服务器版 AI 配置。

认证：需要 token。

请求示例：

```json
{
  "model": "claude-sonnet-4",
  "protocol": "anthropic",
  "models": [{ "id": "claude-sonnet-4" }]
}
```

作用：

- 用于切换模型、切换协议、刷新模型列表、修改 URL、API Token 或多组 URL/Token。
- 只更新请求中出现的字段。

### POST /api/import-local

新用户首次登录后上传本地数据。

认证：需要 token。

请求：

```json
{
  "settings": {
    "baseUrl": "https://api.example.com",
    "token": "sk-...",
    "apiCredentials": {
      "https://api.example.com": "sk-..."
    },
    "model": "gpt-4.1",
    "protocol": "openai_chat",
    "models": []
  },
  "sessions": [
    {
      "id": 1,
      "title": "本地会话",
      "titleSource": "model",
      "createdAt": "2026-07-03T10:00:00Z",
      "updatedAt": "2026-07-03T10:30:00Z",
      "messages": [
        {
          "role": "user",
          "content": "你好",
          "thinking": "",
          "createdAt": "2026-07-03T10:00:00Z"
        }
      ]
    }
  ]
}
```

返回：

```json
{
  "ok": true
}
```

作用：

- 把本地 API 配置和会话记录导入服务器。
- 覆盖该新用户当前服务器配置。
- 写入上传的会话和消息。
- 标记首次上传流程已处理，后续不再提示。

### POST /api/import-local/skip

用户拒绝首次上传本地数据。

认证：需要 token。

返回：

```json
{
  "ok": true
}
```

作用：

- 标记首次上传流程已处理。
- 后续登录不再提示上传。

### GET /api/sessions

获取服务器会话列表摘要。

认证：需要 token。

返回：

```json
{
  "sessions": [
    {
      "id": 1,
      "title": "之前的会话",
      "titleSource": "model",
      "createdAt": "2026-07-03T10:00:00Z",
      "updatedAt": "2026-07-03T10:30:00Z",
      "messageCount": 8
    }
  ]
}
```

作用：

- 渲染左侧会话列表。
- 不返回消息正文。

### POST /api/sessions

创建服务器会话。

认证：需要 token。

请求：

```json
{
  "title": "新会话",
  "titleSource": "default"
}
```

返回：

```json
{
  "session": {
    "id": 1,
    "title": "新会话",
    "titleSource": "default",
    "createdAt": "2026-07-03T10:00:00Z",
    "updatedAt": "2026-07-03T10:00:00Z",
    "messageCount": 0
  }
}
```

作用：

- 用户在空新会话中发送第一条消息时创建服务器会话。
- 点击“新会话”时不需要立即调用该接口。

### PUT /api/sessions/{session_id}

更新会话标题或元数据。

认证：需要 token。

请求：

```json
{
  "title": "新的标题",
  "titleSource": "user"
}
```

作用：

- 用户重命名会话。
- 模型自动总结标题后更新会话标题。
- 服务器需要校验该会话属于当前用户。

### DELETE /api/sessions/{session_id}

删除会话。

认证：需要 token。

返回：

```json
{
  "ok": true
}
```

作用：

- 删除指定会话和该会话下所有消息。
- 服务器需要校验该会话属于当前用户。

### GET /api/sessions/{session_id}/messages

获取指定会话的消息。

认证：需要 token。

返回：

```json
{
  "messages": [
    {
      "id": 1,
      "role": "user",
      "content": "你好",
      "thinking": "",
      "createdAt": "2026-07-03T10:00:00Z",
      "sortOrder": 1
    }
  ]
}
```

作用：

- 用户点击历史会话时加载消息。
- 第一版可以返回该会话全部消息。
- 后续如单会话过长，可扩展分页参数。

### POST /api/sessions/{session_id}/messages

新增消息。

认证：需要 token。

请求：

```json
{
  "role": "assistant",
  "content": "你好，有什么可以帮你？",
  "thinking": "",
  "sortOrder": 2
}
```

返回：

```json
{
  "message": {
    "id": 2,
    "role": "assistant",
    "content": "你好，有什么可以帮你？",
    "thinking": "",
    "createdAt": "2026-07-03T10:01:00Z",
    "sortOrder": 2
  }
}
```

作用：

- 保存用户消息。
- 保存助手最终回复。
- 服务器需要校验会话属于当前用户。

### POST /api/models

现有模型列表代理接口，继续保留。

作用：

- 根据前端传入的 `baseUrl` 和 `token` 请求上游 `/v1/models`。
- 模型列表获取成功后，前端用接口返回结果直接覆盖 `settings.models`；用户手动输入但接口列表里没有的模型不需要保留。
- 登录账号同步中，前端再调用 `PUT /api/settings` 保存当前 URL/Token、多组 URL/Token 和最新 `models`。

### POST /api/chat

现有聊天代理接口，继续保留。

作用：

- 根据协议转发到上游聊天接口。
- 继续输出现有内部 SSE 事件。
- 不强行绑定服务器会话保存逻辑。
- 登录账号同步中，前端在用户消息创建、助手回复完成、停止生成等节点调用消息 API 保存数据。

## 首页加载流程

### 未登录本地使用

1. 前端读取 `LOCAL_STATE_KEY`。
2. 渲染本地设置和本地会话列表。
3. 如果没有当前会话，显示空新会话。

### 登录账号同步

1. 前端读取 `SERVER_AUTH_KEY`。
2. 如果没有 token，读取本地数据并显示登录按钮。
3. 如果有 token，并行请求：

```text
GET /api/profile
GET /api/sessions
```

4. 两个接口都带 `Authorization: Bearer <token>`。
5. 任意接口返回 `401`：
   - 清除 `SERVER_AUTH_KEY`。
   - 读取本地数据。
   - 显示登录界面。
6. 请求成功后：
   - 用 `/api/profile` 渲染账号信息和 AI 配置。
   - 用 `/api/sessions` 渲染左侧历史列表。
   - 主区域显示空新会话。
   - 不请求消息。
   - 不创建服务器会话。

## 登录账号同步聊天流程

### 空新会话发送第一条消息

1. 用户在空新会话输入消息。
2. 前端调用 `POST /api/sessions` 创建服务器会话。
3. 前端调用 `POST /api/sessions/{session_id}/messages` 保存用户消息。
4. 前端调用 `POST /api/chat` 开始流式生成。
5. 生成过程中前端继续按现有打字机逻辑渲染。
6. 生成完成后，前端调用 `POST /api/sessions/{session_id}/messages` 保存助手消息。
7. 如果需要自动总结标题，标题生成完成后调用 `PUT /api/sessions/{session_id}` 更新标题。

### 历史会话继续聊天

1. 用户点击历史会话。
2. 前端调用 `GET /api/sessions/{session_id}/messages` 加载消息。
3. 用户发送新消息。
4. 前端调用 `POST /api/sessions/{session_id}/messages` 保存用户消息。
5. 前端调用 `POST /api/chat` 开始流式生成。
6. 生成完成后保存助手消息。

### 停止生成

1. 用户点击停止按钮。
2. 前端中断当前 `AbortController`。
3. 前端在当前 assistant 消息末尾追加 `已停止生成`。
4. 登录账号同步调用消息保存或更新接口，确保服务器记录也包含 `已停止生成`。

## 过期处理

任意需要登录的接口返回 `401` 时：

1. 前端清除 `SERVER_AUTH_KEY`。
2. 切回未登录状态。
3. 加载当前浏览器已有的本地数据。
4. 显示登录界面。

## 实施顺序

1. 抽象前端存储接口，先让现有 localStorage 走 `storage-local.js`。
2. 增加服务器登录态管理和 `401` 统一处理。
3. 增加设置内登录/注销入口。
4. 增加 SQLite 初始化、users、login_tokens、sessions、messages。
5. 实现 `POST /api/register`、`POST /api/login`、`POST /api/logout`。
6. 实现 `GET /api/profile`、`PUT /api/settings`、`PATCH /api/settings`。
7. 实现 `POST /api/import-local`、`POST /api/import-local/skip`。
8. 实现会话和消息 API。
9. 接入登录账号同步首页加载：并行请求 `/api/profile` 和 `/api/sessions`。
10. 接入登录账号同步聊天保存流程。
11. 验证未登录本地使用不受登录账号同步逻辑影响。

## 注意事项

- 不新增 `/api/me`。
- 不使用 `/api/auth/*` 和 `/api/cloud/*` 层级。
- 不向前端返回 token 过期时间。
- 不在日志中记录 API Token 或登录 token。
- 服务器存储版本中的 API Token 当前按需求保存到服务器；后续如公网部署，应考虑加密保存。
- 现有 `/api/models` 和 `/api/chat` 的协议适配规则继续保留。
- 用户填写的 API URL 仍按不带 `/v1` 处理。
- Anthropic 仍使用 Bearer，不恢复 `x-api-key`，不添加 `anthropic-beta`。
