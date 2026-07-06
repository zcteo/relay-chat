# RelayChat API 文档

本文档按当前后端实现编写，覆盖所有公开接口、认证方式、示例请求/回复，以及 SQLite 数据库结构。

## 基础约定

服务默认地址示例：

```text
http://127.0.0.1:8000
```

请求和响应默认使用 JSON。除 `/api/chat` 外，成功响应都是 JSON；`/api/chat` 返回 `text/event-stream`。

用户填写的 AI API 地址不带 `/v1`，后端会按协议拼接：

```text
openai_chat      -> <baseUrl>/v1/chat/completions
openai_responses -> <baseUrl>/v1/responses
anthropic        -> <baseUrl>/v1/messages
models           -> <baseUrl>/v1/models
```

协议取值：

```text
openai_chat
openai_responses
anthropic
```

## 认证方式

### 登录 Token

登录成功后，前端保存服务端返回的 `token`。需要登录的接口统一带：

```http
Authorization: Bearer <token>
```

服务端只保存 token hash。token 是滑动有效期：请求成功使用 token 时会刷新过期时间；过期或注销后接口返回 `401`。

### 访问码

配置 `ACCESS_CODE` 后，未登录用户进入页面和调用代理接口需要带访问码：

```http
X-Access-Code: <access-code>
```

访问码由前端明文保存在当前浏览器 `localStorage`。服务端不建表保存访问码，只读取环境变量或 `.env`。

### 注册码

配置 `REGISTRATION_CODE` 后，注册接口必须传 `registrationCode`。未配置时允许开放注册。

### 常见错误

```json
{ "detail": "token_required" }
```

```json
{ "detail": "token_expired" }
```

```json
{ "detail": "invalid_access_code" }
```

```json
{ "detail": "too_many_attempts" }
```

## 接口列表

### GET /

返回前端首页 `static/index.html`。

示例请求：

```bash
curl http://127.0.0.1:8000/
```

示例回复：HTML 页面。

### GET /api/access

校验未登录访问码。`ACCESS_CODE` 未配置时直接通过。

请求头：

```http
X-Access-Code: abc123
```

示例请求：

```bash
curl -H "X-Access-Code: abc123" http://127.0.0.1:8000/api/access
```

示例回复：

```json
{
  "ok": true,
  "accessRequired": true
}
```

未配置访问码时：

```json
{
  "ok": true,
  "accessRequired": false
}
```

### POST /api/register

注册账号。注册成功后不自动登录，前端返回登录界面。

请求体：

```json
{
  "username": "alice",
  "password": "secret-password",
  "registrationCode": "register-code"
}
```

示例请求：

```bash
curl -X POST http://127.0.0.1:8000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret-password","registrationCode":"register-code"}'
```

示例回复：

```json
{
  "user": {
    "id": 1,
    "username": "alice",
    "resetPasswd": true
  },
  "ok": true
}
```

可能错误：

```json
{ "detail": "username_exists" }
```

```json
{ "detail": "invalid_registration_code" }
```

### POST /api/login

登录账号，返回登录 token 和是否需要提示上传本地数据。

请求体：

```json
{
  "username": "alice",
  "password": "secret-password"
}
```

示例请求：

```bash
curl -X POST http://127.0.0.1:8000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"secret-password"}'
```

示例回复：

```json
{
  "user": {
    "id": 1,
    "username": "alice",
    "resetPasswd": true
  },
  "token": "login-token",
  "shouldOfferLocalUpload": true
}
```

`shouldOfferLocalUpload` 为 `true` 时，前端如果发现当前浏览器有本地数据，会询问是否上传到服务器账号。

`resetPasswd` 表示当前账号是否可以重置其他账号密码；系统中第一个注册账号具备该能力。

### POST /api/logout

注销当前登录 token。只撤销当前设备 token，不影响同一账号其他设备。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl -X POST http://127.0.0.1:8000/api/logout \
  -H "Authorization: Bearer login-token"
```

示例回复：

```json
{
  "ok": true
}
```

### PUT /api/password

修改密码。当前账号修改自己的密码时必须传当前密码；具备 `resetPasswd` 能力的账号可以传 `username` 重置指定用户密码。

请求头：

```http
Authorization: Bearer <token>
```

修改自己的密码：

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}
```

重置指定用户密码：

```json
{
  "username": "bob",
  "newPassword": "new-password"
}
```

示例请求：

```bash
curl -X PUT http://127.0.0.1:8000/api/password \
  -H "Authorization: Bearer login-token" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword":"old-password","newPassword":"new-password"}'
```

示例回复：

```json
{
  "ok": true
}
```

当前账号修改自己的密码成功后会保留当前登录 token，并撤销同账号其他登录 token。重置指定用户密码成功后会撤销该用户全部登录 token。

### GET /api/profile

返回当前账号信息和云端设置。该接口也会清理已过期或已注销的登录 token。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl http://127.0.0.1:8000/api/profile \
  -H "Authorization: Bearer login-token"
```

示例回复：

```json
{
  "user": {
    "id": 1,
    "username": "alice"
  },
  "settings": {
    "baseUrl": "https://api.example.com",
    "token": "sk-example",
    "model": "gpt-4.1",
    "protocol": "openai_responses",
    "models": [
      {
        "id": "gpt-4.1",
        "name": "gpt-4.1"
      }
    ],
    "apiCredentials": {
      "https://api.example.com": "sk-example"
    }
  }
}
```

回复中的 `settings.token` 不单独存库，由服务端根据 `settings.baseUrl` 从 `settings.apiCredentials` 中取出。

前端打开首页且已登录时，会并行请求 `/api/profile` 和 `/api/sessions`。

### PUT /api/settings

完整保存当前账号的 AI 设置。

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "baseUrl": "https://api.example.com",
  "token": "sk-example",
  "model": "gpt-4.1",
  "protocol": "openai_responses",
  "models": [
    {
      "id": "gpt-4.1",
      "name": "gpt-4.1"
    }
  ],
  "apiCredentials": {
    "https://api.example.com": "sk-example"
  }
}
```

示例请求：

```bash
curl -X PUT http://127.0.0.1:8000/api/settings \
  -H "Authorization: Bearer login-token" \
  -H "Content-Type: application/json" \
  -d '{"baseUrl":"https://api.example.com","token":"sk-example","model":"gpt-4.1","protocol":"openai_responses","models":[{"id":"gpt-4.1","name":"gpt-4.1"}],"apiCredentials":{"https://api.example.com":"sk-example"}}'
```

示例回复：

```json
{
  "ok": true
}
```

### PATCH /api/settings

部分更新当前账号的 AI 设置。只更新请求体里出现的字段。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl -X PATCH http://127.0.0.1:8000/api/settings \
  -H "Authorization: Bearer login-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-5-sonnet-latest","protocol":"anthropic"}'
```

示例回复：

```json
{
  "ok": true
}
```

### POST /api/import-local

新用户首次登录后，把当前浏览器本地设置和会话导入服务器账号。

导入时会删除该账号现有会话，再写入上传的会话；同时设置 `first_login_completed = 1`，后续登录不再提示上传本地数据。

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "settings": {
    "baseUrl": "https://api.example.com",
    "token": "sk-example",
    "model": "gpt-4.1",
    "protocol": "openai_responses",
    "models": [
      {
        "id": "gpt-4.1",
        "name": "gpt-4.1"
      }
    ],
    "apiCredentials": {
      "https://api.example.com": "sk-example"
    }
  },
  "sessions": [
    {
      "title": "示例会话",
      "titleSource": "user",
      "createdAt": 1720000000000,
      "updatedAt": 1720000005000,
      "messages": [
        {
          "role": "user",
          "content": "你好",
          "thinking": "",
          "createdAt": 1720000000000
        },
        {
          "role": "assistant",
          "content": "你好，有什么可以帮你？",
          "thinking": "",
          "createdAt": 1720000005000
        }
      ]
    }
  ]
}
```

示例回复：

```json
{
  "ok": true
}
```

### POST /api/import-local/skip

新用户首次登录后，用户选择不上传本地数据时调用。服务端只记录已处理首次导入提示。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl -X POST http://127.0.0.1:8000/api/import-local/skip \
  -H "Authorization: Bearer login-token"
```

示例回复：

```json
{
  "ok": true
}
```

### GET /api/sessions

返回当前账号的会话列表，不返回消息正文。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl http://127.0.0.1:8000/api/sessions \
  -H "Authorization: Bearer login-token"
```

示例回复：

```json
{
  "sessions": [
    {
      "id": 1,
      "title": "示例会话",
      "titleSource": "user",
      "createdAt": "2026-07-05T10:00:00+00:00",
      "updatedAt": "2026-07-05T10:05:00+00:00",
      "messageCount": 2
    }
  ]
}
```

### POST /api/sessions

创建服务器账号下的新会话。

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "title": "新会话",
  "titleSource": "default"
}
```

示例回复：

```json
{
  "session": {
    "id": 2,
    "title": "新会话",
    "titleSource": "default",
    "createdAt": "2026-07-05T10:10:00+00:00",
    "updatedAt": "2026-07-05T10:10:00+00:00",
    "messageCount": 0
  }
}
```

### PUT /api/sessions/{session_id}

更新会话标题和标题来源。只能操作当前账号自己的会话。

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "title": "新的标题",
  "titleSource": "user"
}
```

示例回复：

```json
{
  "ok": true
}
```

会话不存在或不属于当前用户时：

```json
{ "detail": "session_not_found" }
```

### DELETE /api/sessions/{session_id}

删除会话。消息会通过外键级联删除。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl -X DELETE http://127.0.0.1:8000/api/sessions/2 \
  -H "Authorization: Bearer login-token"
```

示例回复：

```json
{
  "ok": true
}
```

### GET /api/sessions/{session_id}/messages

读取会话消息列表。只返回当前账号自己的消息。

请求头：

```http
Authorization: Bearer <token>
```

示例请求：

```bash
curl http://127.0.0.1:8000/api/sessions/1/messages \
  -H "Authorization: Bearer login-token"
```

示例回复：

```json
{
  "messages": [
    {
      "id": 1,
      "role": "user",
      "content": "你好",
      "thinking": "",
      "createdAt": "2026-07-05T10:00:00+00:00",
      "sortOrder": 1
    },
    {
      "id": 2,
      "role": "assistant",
      "content": "你好，有什么可以帮你？",
      "thinking": "",
      "createdAt": "2026-07-05T10:00:05+00:00",
      "sortOrder": 2
    }
  ]
}
```

### POST /api/sessions/{session_id}/messages

创建会话消息，并更新会话 `updated_at`。

请求头：

```http
Authorization: Bearer <token>
```

请求体：

```json
{
  "role": "assistant",
  "content": "你好，有什么可以帮你？",
  "thinking": "",
  "sortOrder": 2
}
```

`sortOrder` 可省略；省略时服务端按当前会话最大顺序号加 1。

示例回复：

```json
{
  "message": {
    "id": 2,
    "role": "assistant",
    "content": "你好，有什么可以帮你？",
    "thinking": "",
    "createdAt": "2026-07-05T10:00:05+00:00",
    "sortOrder": 2
  }
}
```

### POST /api/models

代理获取上游模型列表。接口本身只做转发和结果规整。

认证规则：

- 已登录：带 `Authorization: Bearer <token>`
- 未登录且配置访问码：带 `X-Access-Code: <access-code>`
- 未配置访问码：开发开放模式放行

请求体：

```json
{
  "protocol": "openai_responses",
  "baseUrl": "https://api.example.com",
  "token": "sk-example"
}
```

示例请求：

```bash
curl -X POST http://127.0.0.1:8000/api/models \
  -H "Content-Type: application/json" \
  -H "X-Access-Code: abc123" \
  -d '{"protocol":"openai_responses","baseUrl":"https://api.example.com","token":"sk-example"}'
```

上游请求：

```http
GET https://api.example.com/v1/models
Authorization: Bearer sk-example
Content-Type: application/json
X-Origin-Agent: stepcode
```

Anthropic 协议会额外带：

```http
anthropic-version: 2023-06-01
```

示例回复：

```json
{
  "models": [
    {
      "id": "gpt-4.1",
      "name": "gpt-4.1"
    },
    {
      "id": "claude-3-5-sonnet-latest",
      "name": "claude-3-5-sonnet-latest"
    }
  ]
}
```

### POST /api/chat

代理聊天请求，并统一转换为前端内部 SSE 事件。

认证规则同 `/api/models`。

请求体：

```json
{
  "protocol": "openai_chat",
  "baseUrl": "https://api.example.com",
  "token": "sk-example",
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "system",
      "content": "你是一个简洁的助手。"
    },
    {
      "role": "user",
      "content": "1+1 等于几？"
    }
  ],
  "max_tokens": 4096,
  "thinking": true
}
```

示例请求：

```bash
curl -N -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -H "X-Access-Code: abc123" \
  -d '{"protocol":"openai_chat","baseUrl":"https://api.example.com","token":"sk-example","model":"deepseek-chat","messages":[{"role":"user","content":"1+1 等于几？"}],"thinking":true}'
```

上游协议行为：

- `openai_chat`：请求 `<baseUrl>/v1/chat/completions`，body 使用 `messages`，并传 `thinking: {"type": "enabled" | "disabled"}`。
- `openai_responses`：请求 `<baseUrl>/v1/responses`，body 使用 `input`；开启 thinking 时传 OpenAI 官方 `reasoning: {"effort": "medium", "summary": "auto"}`。
- `anthropic`：请求 `<baseUrl>/v1/messages`；关闭 thinking 时传 `thinking: {"type": "disabled"}`，开启时不传 `thinking` 字段。

SSE 示例回复：

```text
data: {"type":"thinking","delta":"正在分析问题"}

data: {"type":"content","delta":"1+1 等于 2。"}

data: {"type":"done"}

```

内部事件类型：

- `content`：助手正文增量。
- `thinking`：thinking/reasoning 增量。
- `usage`：上游用量信息，目前主要来自 Anthropic `message_delta`。
- `error`：上游错误或代理错误。
- `done`：流式输出结束。

## 数据库结构

数据库默认为 SQLite，路径由 `DB_PATH` 控制；未配置时使用 `data/relay-chat.sqlite3`。所有主键均为 `INTEGER PRIMARY KEY AUTOINCREMENT`。

### users

保存账号和账号级 AI 设置。当前没有独立 `user_settings` 表，设置字段直接合并在 `users` 表。

| 字段                      | 类型    | 含义                                                                        |
| ------------------------- | ------- | --------------------------------------------------------------------------- |
| `id`                      | INTEGER | 用户自增 ID。                                                               |
| `username`                | TEXT    | 用户名，唯一。                                                              |
| `password_hash`           | TEXT    | PBKDF2-SHA256 密码哈希，格式为 `pbkdf2_sha256$salt$digest`。                |
| `api_base_url`            | TEXT    | 当前选中的 AI API Base URL，不带 `/v1`。                                    |
| `api_credentials_json`    | TEXT    | 多组 URL/Token 映射 JSON，结构为 `{ "baseUrl": "token" }`，URL 是唯一 key。 |
| `selected_model`          | TEXT    | 当前选择的模型名。                                                          |
| `protocol`                | TEXT    | 当前协议，取值为 `openai_chat`、`openai_responses`、`anthropic`。           |
| `models_json`             | TEXT    | 最新一次获取或保存的模型列表 JSON。                                         |
| `first_login_completed`   | INTEGER | 是否已经处理首次登录本地数据上传提示；`0` 表示还需要提示，`1` 表示已处理。  |
| `local_upload_offered_at` | TEXT    | 首次导入或跳过导入的时间。                                                  |
| `created_at`              | TEXT    | 用户创建时间，UTC ISO 字符串。                                              |
| `updated_at`              | TEXT    | 用户更新时间，UTC ISO 字符串。                                              |

索引：

```sql
CREATE UNIQUE INDEX idx_users_username ON users(username);
```

### login_tokens

保存多端登录 token。一个用户可以有多条有效 token。

| 字段           | 类型    | 含义                                                        |
| -------------- | ------- | ----------------------------------------------------------- |
| `id`           | INTEGER | 登录 token 自增 ID。                                        |
| `user_id`      | INTEGER | 所属用户 ID，关联 `users.id`。                              |
| `token_hash`   | TEXT    | 登录 token 的 SHA-256 hash，唯一；服务端不保存 token 明文。 |
| `created_at`   | TEXT    | token 创建时间，UTC ISO 字符串。                            |
| `expires_at`   | TEXT    | token 过期时间，UTC ISO 字符串。                            |
| `revoked_at`   | TEXT    | 注销时间；非空表示已注销。                                  |
| `last_used_at` | TEXT    | 最近一次成功使用时间。                                      |

外键：

```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

索引：

```sql
CREATE UNIQUE INDEX idx_login_tokens_hash ON login_tokens(token_hash);
CREATE INDEX idx_login_tokens_user_id ON login_tokens(user_id);
```

### sessions

保存服务器账号下的会话列表。

| 字段           | 类型    | 含义                                                                        |
| -------------- | ------- | --------------------------------------------------------------------------- |
| `id`           | INTEGER | 会话自增 ID。                                                               |
| `user_id`      | INTEGER | 所属用户 ID，关联 `users.id`。                                              |
| `title`        | TEXT    | 会话标题。                                                                  |
| `title_source` | TEXT    | 标题来源：`default` 默认标题，`model` 模型自动总结，`user` 用户手动重命名。 |
| `created_at`   | TEXT    | 会话创建时间，UTC ISO 字符串。                                              |
| `updated_at`   | TEXT    | 会话更新时间，UTC ISO 字符串；新增消息或改标题时更新。                      |

外键：

```sql
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
```

索引：

```sql
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
```

### messages

保存服务器账号下的会话消息。

| 字段         | 类型    | 含义                                       |
| ------------ | ------- | ------------------------------------------ |
| `id`         | INTEGER | 消息自增 ID。                              |
| `session_id` | INTEGER | 所属会话 ID，关联 `sessions.id`。          |
| `user_id`    | INTEGER | 所属用户 ID，关联 `users.id`。             |
| `role`       | TEXT    | 消息角色，目前保存 `user` 或 `assistant`。 |
| `content`    | TEXT    | 消息正文。                                 |
| `thinking`   | TEXT    | assistant 消息的 thinking/reasoning 内容。 |
| `created_at` | TEXT    | 消息创建时间，UTC ISO 字符串。             |
| `sort_order` | INTEGER | 会话内排序值。                             |

外键：

```sql
FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

索引：

```sql
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_user_id ON messages(user_id);
```

## 配置项

后端配置来自环境变量或项目/安装目录下 `.env`。真实环境变量优先级高于 `.env`。

| 配置                           | 默认值                    | 含义                                                                                  |
| ------------------------------ | ------------------------- | ------------------------------------------------------------------------------------- |
| `DATA_DIR`                     | `data`                    | 数据目录。                                                                            |
| `DB_PATH`                      | `data/relay-chat.sqlite3` | SQLite 数据库路径。                                                                   |
| `LOG_PATH`                     | `data/relay-chat.log`     | 预留日志路径。                                                                        |
| `LOGIN_TOKEN_DAYS`             | `7`                       | 登录 token 滑动有效期天数。                                                           |
| `ACCESS_CODE`                  | 空                        | 未登录访问码；为空时未登录访问码校验关闭。                                            |
| `REGISTRATION_CODE`            | 空                        | 注册码；为空时开放注册。                                                              |
| `REQUEST_LIMIT_MAX`            | `5`                       | 访问码、注册按 IP，登录按 IP+用户名的失败限流次数；用户名不存在时统一记为 `unknown`。 |
| `REQUEST_LIMIT_WINDOW_SECONDS` | `300`                     | 失败限流窗口秒数。                                                                    |
