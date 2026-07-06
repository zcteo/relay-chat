# RelayChat 开发交接说明

本文档面向没有历史上下文的新一轮开发，描述当前实现状态和开发约束。接口细节和数据库字段以 `docs/API.md` 为准。

## 项目目标

RelayChat 是一个部署在可访问 AI API 的服务器上的轻量问答网站。后端使用 FastAPI 提供静态页面、账号登录、访问认证、SQLite 数据存储和 AI API 转发；前端是静态 HTML/CSS/JS。

当前产品形态：

- 未登录时显示“本地”使用状态，设置、API Token、模型列表和会话历史保存在当前浏览器 `localStorage`。
- 登录后显示用户名和“注销”，账号数据保存在服务器 SQLite，可多端同步。
- 第一次登录后，如果当前浏览器存在本地数据，会询问是否上传到服务器账号；上传成功后再询问是否删除当前本地数据。
- 从登录切换回本地使用时自动注销；如果浏览器里已有本地数据，继续使用原本的本地数据。
- `/api/chat` 和 `/api/models` 只做上游 AI API 转发和协议适配。

## 目录结构

```text
relay-chat/
├── README.md
├── requirements.txt
├── server/
│   ├── __init__.py
│   ├── access.py          # 访问码校验和代理接口认证
│   ├── auth.py            # 密码哈希、登录 token、当前用户依赖
│   ├── config.py          # 环境变量和 .env 读取
│   ├── data_api.py        # 注册、登录、设置、会话、消息 API
│   ├── db.py              # SQLite schema、初始化和连接
│   ├── main.py            # FastAPI app、静态文件、路由挂载
│   ├── proxy_api.py       # /api/chat 和 /api/models 转发接口
│   └── rate_limit.py      # 单进程内存失败限流
├── static/
│   ├── index.html
│   ├── app.js
│   ├── auth.js
│   ├── favicon.ico
│   ├── markdown.js
│   ├── storage-browser.js
│   ├── storage-local.js
│   ├── storage-server.js
│   └── style.css
├── docs/
│   ├── API.md
│   ├── HANDOFF.md
│   ├── TODO.md
│   └── index.png
└── scripts/
    ├── install.py
    └── uninstall.py
```

## 接手顺序

1. 读 `README.md`，了解使用方式和安装方式。
2. 读本文档，了解当前实现边界和开发约束。
3. 读 `docs/API.md`，了解后端接口和数据库结构。
4. 读 `docs/TODO.md`，确认后续计划；TODO 中未勾选项不能当成已实现功能。
5. 改动前执行 `git status --short`，避免覆盖用户或上一轮会话留下的改动。

## 运行和安装

开发启动：

```bash
python3 -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

服务安装：

```bash
sudo python3 scripts/install.py
```

安装脚本是交互式的，不接收命令行参数。脚本自动检测服务管理器，支持 systemd 和 OpenWrt procd。默认安装到：

```text
/opt/relay-chat
```

安装目录结构：

```text
/opt/relay-chat/
├── server/
├── static/
├── data/
├── log/
├── .env
├── requirements.txt
├── uninstall.py
└── .venv/
```

安装规则：

- `server/` 和 `static/` 从源码目录复制到安装目录。
- `data/` 保存 SQLite 数据库。
- `log/` 保存日志文件路径预留。
- `.env` 保存服务管理器、监听地址、端口、访问码、注册码、数据库路径、日志路径等运行配置。
- systemd unit 是系统级，写入 `/etc/systemd/system/<service>.service`。
- OpenWrt init 脚本写入 `/etc/init.d/<service>`，使用 procd 托管进程。
- systemd 服务运行用户是当前真实用户；用 sudo 执行安装时取 `$SUDO_USER`。
- 安装脚本会把 `scripts/uninstall.py` 复制到安装目录。
- 安装和卸载都需要使用的公共函数统一写在 `scripts/uninstall.py`，`scripts/install.py` 直接导入复用；安装专用逻辑仍保留在 `scripts/install.py`。

卸载执行安装目录里的脚本：

```bash
sudo python3 /opt/relay-chat/uninstall.py
```

卸载脚本从同目录 `.env` 读取 `SERVICE_MANAGER`，删除固定服务名 `relay-chat` 对应的 systemd unit 或 OpenWrt init 脚本，并询问是否删除用户数据。选择删除会移除整个安装目录；选择保留会只删除 `server/` 和 `static/`。

修改后端代码后，如果当前以 systemd 运行：

```bash
sudo systemctl restart relay-chat.service
```

如果当前以 OpenWrt procd 运行：

```bash
/etc/init.d/relay-chat restart
```

修改目录结构、服务入口、依赖、虚拟环境位置或安装脚本后，需要重新运行：

```bash
sudo python3 scripts/install.py
```

只修改安装目录中的静态文件时刷新浏览器即可；源码目录中的静态文件变化需要重新安装或手动同步到安装目录。

## 后端现状

FastAPI 入口是 `server/main.py`。启动时调用 `init_db()` 初始化 SQLite 表。

路由模块：

- `server/data_api.py`：`/api/access`、注册、登录、注销、profile、settings、本地导入、会话和消息 API。
- `server/proxy_api.py`：`/api/models` 和 `/api/chat`。

完整接口和示例见 `docs/API.md`。

### 配置

`server/config.py` 只负责读取环境变量和 `.env`，不存放需要人工修改的部署配置。

后续修改监听地址、端口、数据库路径、日志路径、访问码、注册码等部署配置时，只改安装目录 `.env`，不要修改 Python 源码。

真实环境变量优先级高于 `.env`。

### 账号和 token

- 用户表和用户设置合并在 `users` 表。
- 用户、登录 token、会话、消息 ID 都是 SQLite 自增整数。
- 同一用户支持多端登录；每个设备一条 `login_tokens` 记录。
- `users` 表中 ID 最小的第一个注册账号具备重置其他账号密码的能力，`GET /api/profile` 通过 `user.resetPasswd` 返回给前端；不新增管理员字段。
- `PUT /api/password` 是唯一密码修改接口；不传 `username` 时修改当前账号密码并校验当前密码，传 `username` 时由具备 `resetPasswd` 能力的账号重置目标账号密码。
- 前端保存登录 token 明文；服务器只保存 `token_hash`。
- token 使用滑动有效期；成功使用 token 会刷新过期时间。
- `GET /api/profile` 会清理过期或已注销 token。

### 访问认证

- `ACCESS_CODE` 为空时，未登录本地使用和代理接口按开发开放模式放行。
- `ACCESS_CODE` 非空时，未登录进入页面先通过 `GET /api/access` 校验访问码。
- 未登录调用 `/api/chat`、`/api/models` 必须带 `X-Access-Code`。
- 已登录调用 `/api/chat`、`/api/models` 带 `Authorization: Bearer <token>`，不需要访问码。
- `REGISTRATION_CODE` 为空时开放注册；非空时注册请求必须传 `registrationCode`。
- 访问码和注册失败限流 key 为真实客户端 IP；登录密码错误限流 key 为真实客户端 IP + 用户名，用户名不存在时统一记为 `unknown`；真实 IP 优先读取 `X-Forwarded-For` 第一个地址，其次 `X-Real-IP`，最后使用连接 IP。
- 限流是单进程内存限流，只记录失败尝试；多进程或多实例部署需要改成 Redis、Nginx 或网关限流。

### 代理协议

协议值：

```text
anthropic
openai_chat
openai_responses
```

上游接口：

```text
anthropic        -> POST /v1/messages
openai_chat      -> POST /v1/chat/completions
openai_responses -> POST /v1/responses
models           -> GET  /v1/models
```

所有上游请求都带：

```http
Authorization: Bearer <token>
Content-Type: application/json
X-Origin-Agent: stepcode
```

Anthropic 额外带：

```http
anthropic-version: 2023-06-01
```

不要恢复 `anthropic-beta` header，也不要把 Anthropic 鉴权改成 `x-api-key`。

用户填写的 API URL 按“不带 `/v1`”处理，后端统一拼接 `/v1/...`。

thinking/reasoning 规则：

- `openai_chat`：传 `thinking: {"type": "enabled" | "disabled"}`。
- `openai_responses`：开启时传 OpenAI `reasoning: {"effort": "medium", "summary": "auto"}`。
- `anthropic`：关闭时传 `thinking: {"type": "disabled"}`，开启时不传 `thinking` 字段。

后端统一输出内部 SSE：

```text
data: {"type":"content","delta":"..."}\n\n
data: {"type":"thinking","delta":"..."}\n\n
data: {"type":"usage","usage":{...}}\n\n
data: {"type":"error","error":"..."}\n\n
data: {"type":"done"}\n\n
```

## 前端现状

前端主逻辑在 `static/app.js`。

模块划分：

- `static/auth.js`：服务器登录 token 的 localStorage 读写。
- `static/storage-browser.js`：浏览器级设置存储，登录和未登录共用。
- `static/storage-local.js`：本地模式 API 配置、会话和消息存储适配器。
- `static/storage-server.js`：登录后服务器 API 适配器。
- `static/markdown.js`：Markdown 渲染器。
- `static/style.css`：所有样式和主题变量。

不要把 Markdown 渲染逻辑塞回 `app.js`。

### localStorage

当前 key：

```js
const BROWSER_SETTINGS_KEY = "relaychat-browser-settings-v1";
const LOCAL_STATE_KEY = "relaychat-local-state-v1";
const SERVER_AUTH_KEY = "relaychat-server-auth-v1";
```

浏览器级设置保存在 `relaychat-browser-settings-v1`，登录和未登录共用，不参与账号同步：

```js
{
  theme: "auto",
  thinking: true,
  maxTokens: "",
  systemPrompt: "",
  historyCount: "6",
  accessCode: ""
}
```

`historyCount` 默认值为 6，留空或 0 表示附带全部历史。`accessCode` 是访问码，只保存在当前浏览器。

本地模式状态保存在 `relaychat-local-state-v1`：

```js
{
  settings: {
    protocol: "openai_responses",
    baseUrl: "",
    token: "",
    apiCredentials: {},
    model: "",
    models: []
  },
  sessions: [],
  currentId: null
}
```

未登录时，API 配置、模型列表和历史只存在 `relaychat-local-state-v1`。登录后，通过 `storage-server.js` 读写服务器账号数据，浏览器级设置仍然只保存在 `relaychat-browser-settings-v1`。

### API URL 和 Token

设置里的 API URL 是自定义 combobox：

- 左侧可编辑输入框。
- 右侧箭头展开已保存 URL 列表。
- 选择已保存 URL 后自动带出对应 Token。
- 点击“保存”时保存当前 URL/Token 到 `apiCredentials`。
- “获取模型”成功后也保存当前 URL/Token，并用接口结果覆盖 `settings.models`。
- “删除 URL”和“保存”“获取模型”在同一行。
- 未登录和已登录状态使用同一套行为；未登录保存到 localStorage，已登录保存到服务器账号。
- 服务器只保存当前 `baseUrl` 和 `apiCredentials` 映射；返回给前端的 `token` 由 `apiCredentials[baseUrl]` 派生。

不要改成原生 `select`/`datalist`，当前需求需要自定义样式、删除 URL 和自动带出 Token。

### 模型和协议

模型字段和 API URL 一样是自定义 combobox：

- 左侧可输入模型名。
- 右侧箭头展开已保存模型列表。
- 模型列表为空时显示“暂无已保存模型”。
- 输入列表外模型名后，失焦或按 Enter 会保存为当前模型，并加入 `settings.models`。
- 点击“获取模型”成功后，接口返回列表直接覆盖 `settings.models`。

协议下拉顺序：

```text
Anthropic
OpenAI Chat
OpenAI Responses
```

切换模型时自动推断协议：

```text
模型名包含 claude -> anthropic
其他模型          -> openai_chat
```

用户仍可以手动选择 `openai_responses`。不要增加 `auto` 协议项。

页面上有两处模型/协议选择：

1. 顶部模型名点击后的弹层。
2. 右上角三点菜单里的设置区。

两处需要保持同步，不要当成重复 UI 删除。

### 聊天和流式输出

生成中：

- 不允许发送新消息。
- Enter 不触发停止。
- 只有鼠标点击停止按钮才中断当前生成。
- 停止后在当前 assistant 消息末尾追加 `已停止生成`。

停止通过 `AbortController` 实现。

后端是真流式，前端还有打字机平滑显示：

- 缓冲多时加速追赶。
- 缓冲少时慢速输出。
- 用户主动向上滚动时暂停自动跟随。
- 离底部超过 256px 时显示回到底部按钮。
- 点击回到底部按钮后恢复自动跟随。

### Markdown

AI 正文和 thinking 都需要 Markdown 渲染；用户消息保持纯文本。

`markdown.js` 支持：

- 标题
- 列表
- 引用
- 分隔线
- 表格
- 代码块
- 行内代码
- 粗体
- 斜体
- 链接

渲染前会 HTML 转义，避免执行模型输出的 HTML。

代码块输出为 `.code-block` 容器，复制按钮逻辑在 `app.js` 中用事件委托处理，不放进 `markdown.js`。

### 外观和移动端

外观设置：

```text
自动 -> auto
浅色 -> light
深色 -> dark
```

主题通过 `document.documentElement.dataset.theme` 和 `dataset.resolvedTheme` 应用。

移动端布局：

- 侧边栏默认收起。
- 顶部第一行包含三横按钮、站点图标、站点标题和右侧三点按钮。
- 侧边栏弹出后右上角有关闭按钮。
- 移动端不显示第二行模型菜单。
- 设置菜单贴近当前 header 高度，避免底部溢出屏幕。

## UI 约束

整体目标是类 ChatGPT 的中性浅色/深色界面：

- 左侧浅灰侧边栏。
- 顶部模型选择。
- 右上角三点设置菜单。
- 底部悬浮输入框。
- 空会话时提示词和输入框居中组合。
- 用户消息右侧气泡。
- AI 消息不使用大色块。
- thinking 区域为引用块风格。

弹窗统一使用站内自定义弹窗，不使用浏览器原生 `alert`、`confirm`、`prompt`。

图标使用本地内联 SVG。不要引用 ChatGPT 私有 sprite 路径或外站 sprite。

`static/style.css` 使用 Prettier 多行格式。JS 文件使用项目当前 Prettier 风格，不要为了单个改动重排无关文件。

## 日志和安全

不要把 token、访问码、注册码写入日志。

`server/main.py` 的请求校验失败日志会脱敏以下字段：

```text
token
authorization
api_key
apikey
x-api-key
x-access-code
registrationcode
registration_code
```

公网部署建议：

- 使用 HTTPS。
- 配置访问码和注册码。
- 限制 systemd 运行用户权限。
- 保护安装目录 `.env` 和 SQLite 数据库文件权限。
- 如需多进程或多实例部署，把内存限流迁移到共享存储或网关。

## 开发注意事项

1. 登录后首页并行请求 `/api/profile` 和 `/api/sessions`。
2. 部署配置只写入环境变量或 `.env`；`server/config.py` 只做配置读取和默认值处理。
3. 用户填写的 API URL 按不带 `/v1` 处理。
4. 用户设置保存在 `users` 表，不存在独立 `user_settings` 表。
5. 账号 API Token 只存放在 `users.api_credentials_json` 的 URL/Token 映射中。
6. 用户、登录 token、会话、消息 ID 都使用 SQLite 自增整数。
7. 登录 token 明文只返回给前端，数据库只保存 token hash。
8. 代理接口日志不能记录明文 API Token。
9. 顶部模型菜单和右上角设置菜单都保留模型/协议选择，并保持同步。
10. 协议取值只有 `anthropic`、`openai_chat`、`openai_responses`。
11. Markdown 渲染逻辑保留在 `static/markdown.js`。
12. 不考虑旧数据迁移和旧 localStorage 兼容；按当前结构直接覆盖。

## 验证清单

后端和脚本语法：

```bash
python3 -m py_compile server/main.py server/proxy_api.py server/data_api.py server/auth.py server/db.py server/config.py server/access.py server/rate_limit.py
python3 -m py_compile scripts/install.py scripts/uninstall.py
```

前端 JS 语法：

```bash
node --check static/markdown.js
node --check static/auth.js
node --check static/storage-browser.js
node --check static/storage-local.js
node --check static/storage-server.js
node --check static/app.js
```

文档格式：

```bash
npx prettier --check README.md docs/API.md docs/HANDOFF.md docs/TODO.md
```

手工浏览器验证：

- 首页可打开。
- 未配置 `ACCESS_CODE` 时，未登录可直接进入本地界面。
- 配置 `ACCESS_CODE` 时，未登录首次打开出现访问码弹窗。
- 访问码错误返回 `401`，连续错误触发 `429`。
- 访问码正确后进入本地界面，并保存到 `relaychat-browser-settings-v1`。
- 未登录获取模型和聊天请求带 `X-Access-Code`。
- 设置里未登录显示“登录”，登录后显示用户名和“注销”。
- 配置 `REGISTRATION_CODE` 后，注册需要注册码和两次相同密码。
- 注册成功后返回登录界面。
- 登录后 `/api/profile` 和 `/api/sessions` 正常加载。
- 登录后获取模型和聊天请求带登录 token。
- API URL 下拉、保存、删除、自动带出 Token 正常。
- 模型下拉、手动输入、空列表提示正常。
- 模型/协议两个菜单同步。
- 空会话输入框和提示词在一起。
- 外观设置可切换自动/浅色/深色。
- 发送后流式输出，thinking 和正文都能渲染 Markdown。
- 生成中点击停止显示 `已停止生成`。
- 移动端侧边栏默认收起，三横按钮可打开，关闭按钮可关闭。
