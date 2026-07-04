# RelayChat 开发交接说明

本文档面向没有历史上下文的新一轮开发，用于快速理解项目现状、约束和后续改动注意事项。

## 项目目标

这是一个部署在“能访问 AI API 的服务器”上的轻量 AI 问答网站。

核心设计：

- 未登录时，前端保存设置、Token、模型列表和聊天历史到浏览器 `localStorage`。
- 登录后，服务器用 SQLite 保存 API URL/Token 配置、当前模型、协议、模型列表和对话记录。
- 后端的 `/api/chat`、`/api/models` 只做 AI API 转发和协议适配。
- 用户在页面里配置 API Base URL 和 Token。
- 用户填写的 API URL 不带 `/v1`，转发接口统一拼接 `/v1/...`。
- 页面风格参考 ChatGPT 浅色界面。

## 当前目录结构

```text
relay-chat/
├── README.md              # 面向使用者的启动/安装说明
├── .gitignore
├── requirements.txt       # Python 依赖
├── server/
│   ├── __init__.py
│   ├── auth.py            # 密码哈希、登录 token、当前用户依赖
│   ├── config.py          # 数据库路径等配置
│   ├── data_api.py        # 登录、设置、会话、消息等数据 API
│   ├── db.py              # SQLite 初始化和连接
│   ├── main.py            # FastAPI app、静态文件、路由挂载
│   └── proxy_api.py       # /api/chat 和 /api/models 转发接口
├── static/
│   ├── index.html         # 页面结构
│   ├── app.js             # 前端主逻辑
│   ├── auth.js            # 前端登录 token 读写
│   ├── favicon.ico
│   ├── markdown.js        # 独立 Markdown 渲染器
│   ├── storage-local.js   # localStorage 适配器
│   ├── storage-server.js  # 服务器 API 适配器
│   └── style.css          # 样式
├── docs/
│   ├── HANDOFF.md         # 本文件，面向新开发者
│   └── TODO.md            # 后续待办事项
└── scripts/
    ├── install.sh         # systemd 安装脚本
    └── uninstall.sh       # systemd 卸载脚本
```

## 运行方式

开发启动：

```bash
python3 -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

systemd 安装：

```bash
sudo ./scripts/install.sh
```

使用反向代理/HTTPS 时推荐：

```bash
sudo ./scripts/install.sh --host 127.0.0.1 --port 8000
```

日志：

```bash
journalctl -u relay-chat.service -f
```

改完代码后的部署/运行方式需要先检测当前环境：

```bash
systemctl is-active relay-chat.service
```

如果输出为 `active`，说明当前以 systemd 服务运行。

只修改普通 Python 后端代码时，直接重启部署：

```bash
sudo systemctl restart relay-chat.service
```

如果修改了目录结构、服务入口、依赖文件、虚拟环境位置或 `scripts/install.sh`，需要重新运行安装脚本生成 systemd unit，不能只 restart：

```bash
sudo ./scripts/install.sh
```

只修改 `static/` 下的静态前端文件时，不需要重启 systemd 服务；浏览器刷新即可加载新文件。

如果不是 systemd 运行，按开发方式直接启动项目：

```bash
python3 -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

## 后端说明

后端入口：

```text
server/main.py
```

FastAPI 路由：

- `GET /`
  - 返回 `static/index.html`
- `POST /api/models`
  - 请求上游：`<baseUrl>/v1/models`
  - 定义在 `server/proxy_api.py`
- `POST /api/chat`
  - 根据协议转发到不同上游接口，并统一输出内部 SSE 事件
  - 定义在 `server/proxy_api.py`
- `POST /api/register`
  - 注册账号，不自动登录
- `POST /api/login`
  - 登录账号，生成 7 天滑动有效期 token
- `POST /api/logout`
  - 注销当前 token
- `GET /api/profile`
  - 返回账号信息和服务器保存的 AI 配置，并清理过期/撤销 token
- `PUT/PATCH /api/settings`
  - 保存服务器账号下的当前 API URL、当前 API Token、多组 URL/Token、当前模型、协议和模型列表
- `POST /api/import-local`、`POST /api/import-local/skip`
  - 新用户首次登录后的本地数据导入或跳过导入
- `/api/sessions...`、`/api/sessions/{session_id}/messages`
  - 服务器账号下的会话和消息读写

静态文件路径使用 `Path(__file__)` 推导，不依赖进程工作目录：

```python
PROJECT_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_DIR / "static"
```

### 协议枚举

后端协议值为：

```text
anthropic
openai_chat
openai_responses
```

对应接口：

```text
anthropic        -> POST /v1/messages
openai_chat      -> POST /v1/chat/completions
openai_responses -> POST /v1/responses
```

### Header 约定

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

不要再加 `anthropic-beta`，之前已经明确删除。

### URL 约定

用户填写的 URL 永远按“不带 `/v1`”处理。

后端直接拼接：

```python
clean_base_url(req.base_url) + "/v1/models"
clean_base_url(req.base_url) + "/v1/messages"
clean_base_url(req.base_url) + "/v1/chat/completions"
clean_base_url(req.base_url) + "/v1/responses"
```

### 后端流式输出给前端的事件格式

后端统一输出 SSE，每个事件为：

```text
data: {"type":"content","delta":"..."}\n\n
data: {"type":"thinking","delta":"..."}\n\n
data: {"type":"error","error":"..."}\n\n
data: {"type":"done"}\n\n
```

前端只依赖这几种内部事件。

### 日志与脱敏

参数校验失败日志通过 `safe_json_body()` 脱敏，避免 token 出现在日志中。

已脱敏字段：

```text
token
authorization
api_key
apikey
x-api-key
```

继续改日志时注意不要记录明文 token。

## 前端说明

前端主逻辑：

```text
static/app.js
```

Markdown 渲染：

```text
static/markdown.js
```

不要把 Markdown 渲染逻辑塞回 `app.js`。

### localStorage 和服务器存储

本地存储 key：

```js
const LOCAL_STATE_KEY = "relaychat-state-v1"
const SERVER_AUTH_KEY = "relaychat-server-auth-v1"
```

状态大致结构：

```js
{
  settings: {
    theme,
    protocol,
    baseUrl,
    token,
    apiCredentials, // { [baseUrl]: token }
    model,
    models,
    thinking,
    temperature,
    maxTokens,
    systemPrompt
  },
  sessions: [
    {
      id,
      title,
      titleSource,
      createdAt,
      updatedAt,
      messages: [
        { role: 'user' | 'assistant', content, thinking? }
      ]
    }
  ],
  currentId
}
```

未登录时，设置和历史只存在浏览器本地。

登录后，服务器保存：

```text
api_base_url
api_token
api_credentials_json
selected_model
protocol
models_json
sessions
messages
```

用户表、会话表、消息表、登录 token 表的主键都是 SQLite `INTEGER PRIMARY KEY AUTOINCREMENT`。

`settings.apiCredentials` 和 `users.api_credentials_json` 保存多组 URL/Token，结构为 `{ "https://api.example.com": "sk-..." }`，URL 是唯一 key。当前使用的 URL/Token 仍同时保存在 `baseUrl`/`token` 和 `api_base_url`/`api_token`，用于聊天和模型转发请求。

登录 token 明文只保存在前端；服务器只保存 `token_hash`。`GET /api/profile` 每次请求会清理 `login_tokens` 表中过期或已撤销的 token。

`settings.models` 只用于模型下拉列表和账号同步保存，不要把不相关的本地状态传给 `/api/chat`、`/api/models`。

### 会话标题来源

`session.titleSource` 表示标题来源：

```text
default -> 默认/临时标题
model   -> 模型自动总结标题
user    -> 用户手动重命名
```

旧数据可能没有 `titleSource`，按 `default` 处理。

新会话首次回复后，如果 `titleSource` 缺失或为 `default`，前端会异步调用当前模型，只根据第一次用户消息和第一次助手回复生成简短标题，并更新左侧会话列表。

如果 `titleSource` 为 `user`，说明用户手动重命名过，自动标题生成绝对不能覆盖。

标题生成请求有独立的 `AbortController`。切换会话、新建会话、删除会话、清空会话、用户重命名、再次发送消息时，都需要取消正在运行的标题生成请求，避免后台辅助请求长时间占用上游连接。

标题生成请求有 30 秒前端超时，超时后自动 abort；它是辅助功能，不能因为上游模型长时间 thinking 阻塞用户继续使用。

### 协议选择 UI

页面上有两处模型/协议选择：

1. 左上角模型名点击后的弹层
2. 右上角三点菜单里的设置区

这是用户明确要求的，不要当成重复 UI 删除。

两处应保持同步。

### API URL/Token UI

设置里的 API URL 是自定义 combobox：

- 左侧是可编辑输入框。
- 右侧箭头展开已保存 URL 列表。
- 选择某个已保存 URL 后，自动把对应 Token 填入 Token 输入框。
- 点击“保存”时保存当前 URL/Token 到 `apiCredentials`。
- “获取模型”成功后也保存当前 URL/Token，并用最新请求结果覆盖 `settings.models`。
- “删除 URL”和“保存”“获取模型”在同一行，删除当前输入框里的 URL。
- 未登录和已登录状态都使用同一套行为；未登录保存到 localStorage，已登录保存到服务器账号。
- 不使用原生 `select`/`datalist`，因为需要稳定支持自定义样式、删除 URL 和自动带出 Token。

### 外观设置

设置菜单里有外观选择：

```text
自动
浅色
深色
```

value 分别为：

```text
auto
light
dark
```

默认值为 `auto`，保存在 `state.settings.theme`。自动模式使用 `prefers-color-scheme` 跟随浏览器/系统主题切换。

主题通过 `document.documentElement.dataset.theme` 和 `dataset.resolvedTheme` 应用：

- `data-theme` 保存用户选择：`auto` / `light` / `dark`
- `data-resolved-theme` 保存当前实际主题：`light` / `dark`

浅色和深色主题不要拆成两个 CSS 文件。当前主题差异主要是颜色 token，统一放在 `static/style.css` 的 CSS 变量里维护，避免重复布局规则。

协议下拉顺序必须为：

```text
Anthropic
OpenAI Chat
OpenAI Responses
```

value 分别为：

```text
anthropic
openai_chat
openai_responses
```

### 模型切换自动推断协议

模型字段和 API URL 一样使用自定义 combobox：

- 左侧可直接输入模型名。
- 右侧箭头展开当前已保存模型列表。
- 模型列表为空时显示“暂无已保存模型”。
- 输入模型列表外的模型名后，失焦或按 Enter 会保存为当前模型，并加入 `settings.models`。
- 点击“获取模型”成功后，使用接口返回的模型列表直接覆盖 `settings.models`，不保留用户手动输入但接口列表里没有的模型。
- 顶部模型弹层和设置里的模型字段保持同步。

切换模型时自动推断协议：

```text
模型名包含 claude -> anthropic
其他模型          -> openai_chat
```

用户仍可以手动把协议改成 `openai_responses`。

不要引入 `auto` 协议项。

### 聊天发送与停止

生成中：

- 不允许发送新消息。
- Enter 不触发停止，也不发送。
- 只有鼠标点击停止按钮才中断当前生成。
- 停止后需要显示 `已停止生成`。
- 即使 AI 已经输出了一部分内容，停止后也要在当前 assistant 消息末尾追加 `已停止生成`。

停止通过 `AbortController` 实现。

### 流式显示

后端是真流式，前端另有“打字机”平滑显示。

当前 `createTypewriter()` 使用动态速度：

- 缓冲多时加速追赶
- 缓冲少时慢速输出，避免“吐完一片停很久”

修改流式体验时注意不要破坏停止逻辑和 Markdown 渲染。

打字机滚动行为：

- 默认跟随最新消息向下滚动。
- 用户主动滚动消息区时，自动跟随会暂停，避免阅读开头内容时被拉回底部。
- 只有用户明确滚动消息区才暂停跟随；程序滚动和打字机输出触发的 `scroll` 事件不能把跟随状态改成暂停。
- 离底部超过 256px 时，在输入框上方显示 `.scroll-bottom` 悬浮按钮。
- 点击 `.scroll-bottom` 后立即滚到底部，并恢复后续打字机自动跟随。
- 小幅离底会暂停自动跟随，但不显示回到底部按钮。

### Markdown 渲染

AI 正文和 thinking 都需要 Markdown 渲染。

用户消息保持纯文本。

`markdown.js` 当前是轻量实现，支持：

- 标题
- 列表
- 引用
- 分隔线：`---`、`***`、`___`，支持超过 3 个字符，也支持中间有空格
- 代码块
- 行内代码
- 粗体
- 斜体
- 链接

渲染前会 HTML 转义，避免执行模型输出的 HTML。

代码块注意事项：

- 围栏支持反引号和波浪线：`````、`~~~`。
- 围栏前允许多个空格；渲染时会按开围栏的缩进整体剥掉代码内容缩进。
- 代码块输出为 `.code-block` 容器，里面包含右上角 `.copy-code` 复制按钮和 `<pre><code>`。
- 复制按钮逻辑在 `app.js`，使用事件委托绑定到 `.copy-code`；不要把复制逻辑塞进 `markdown.js`。
- 复制优先使用 Clipboard API，失败/非安全上下文时使用 textarea 兜底。
- 代码块图标使用本地内联 SVG，不引用外站 sprite。

### 空会话布局

新会话/空会话时，提示词和输入框放在一起，类似 ChatGPT：

```text
今天想聊点什么？
[ 输入框 ]
```

通过 `.main.empty-chat` 控制。

有消息后输入框回到底部。

### 会话列表

左侧会话列表行为：

- 点击会话切换。
- 鼠标悬停显示三点按钮。
- 三点菜单包含：
  1. 重命名
  2. 删除
- 当前重命名使用站内自定义弹窗，不使用浏览器原生 `prompt`。
- TODO 中要求未来改为直接编辑。
- 当前“新会话”按钮行为类似 ChatGPT：如果已经存在空白新会话，不重复创建。

## UI 约束

整体视觉目标：ChatGPT 风格浅色界面。

关键点：

- 左侧浅灰侧边栏
- 顶部左侧模型选择
- 顶部右侧三点设置菜单
- 底部悬浮输入框
- 空会话时输入框居中到提示词下方
- 用户消息右侧浅灰气泡
- AI 消息无大色块
- thinking 区域为浅灰引用块
- 浅色/深色主题都应接近 ChatGPT 对应主题的中性色风格

图标不直接引用 ChatGPT 私有 sprite 路径 `/cdn/assets/...`，因为本站会 404。

当前做法：使用内联 SVG 实现相似图标：

- 模型下拉箭头
- 发送按钮
- 停止按钮
- 代码块复制按钮

`static/style.css` 已使用 Prettier 格式化为多行 CSS。后续修改样式时保持可读格式，不要压回单行。

所有 JS 文件采用 Prettier 格式化和无分号风格。后续新增或修改 JS 时保持同一格式，不要重新引入行尾分号。

## 安全现状

当前已有应用内注册、登录和账号同步，但还没有 URL 白名单、注册限流、登录限流、邀请码或关闭开放注册配置。

公网裸露风险主要包括：

- SSRF：别人可让服务器请求任意 baseUrl
- 资源滥用：长连接、并发、带宽
- 被当代理跳板
- 暴力登录和批量注册
- 登录后 API Token 保存到服务器 SQLite 数据库，需要配合 HTTPS 和服务器文件权限保护

相关增强已经写在 `docs/TODO.md`：

- 配置文件 URL 白名单
- 注册/登录限流
- 邀请码或关闭开放注册

## 未来开发注意事项

1. 不要把 Token 打到日志里。
2. 不要恢复 `x-api-key` Anthropic 鉴权，目前要求 Bearer。
3. 不要恢复 `anthropic-beta` header。
4. 不要让用户填写带 `/v1` 的 URL 作为默认假设。
5. 不要把 Markdown 渲染逻辑混进 `app.js`。
6. 不要删除右上角设置里的模型/协议选择。
7. 不要增加 `auto` 协议选项。
8. 生成中不要允许发送新消息。
9. 停止按钮只能鼠标点击触发，不能由 Enter 触发。
10. 修改目录结构时，同步 `scripts/install.sh` 的 `uvicorn server.main:app`。
11. 修改功能或数据结构时，不考虑旧数据同步、旧数据迁移、旧 localStorage 兼容；按新逻辑直接覆盖。
12. 提交代码前需要先按项目约定格式化代码；JS 使用 Prettier 无分号风格，CSS 保持 Prettier 多行格式。

## 快速验证清单

改动后至少验证：

```bash
python3 -m py_compile server/main.py server/proxy_api.py server/data_api.py server/auth.py server/db.py server/config.py
bash -n scripts/install.sh
bash -n scripts/uninstall.sh
python3 -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

浏览器验证：

- 首页可打开
- `/static/app.js`、`/static/auth.js`、`/static/storage-local.js`、`/static/storage-server.js`、`/static/markdown.js`、`/static/style.css` 可加载
- 未登录时可以本地使用
- 设置里未登录显示“登录”，登录后显示用户名和“注销”
- 注册需要输入两次密码，注册成功后返回登录界面
- 登录后 `/api/profile` 和 `/api/sessions` 正常加载
- API URL 输入框右侧箭头能展开已保存 URL，选择后自动带出 Token
- 保存或获取模型成功后会记录当前 URL/Token；删除 URL 后该项不再出现在下拉列表
- 获取模型成功后顶部 toast 提示
- 模型输入列表外名称后，失焦会保存到模型列表；模型列表为空时右侧下拉显示“暂无已保存模型”
- 模型/协议左右两个菜单同步
- 空会话输入框和提示词在一起
- 外观设置可在自动/浅色/深色之间切换
- 自动外观跟随浏览器或系统深浅色设置
- 发送后流式输出
- 打字机输出时向上滚动能暂停自动跟随
- 点击回到底部按钮后，后续打字机输出能继续自动向下滚动
- Markdown 正文和 thinking 都能渲染
- Markdown 分隔线能渲染为横线
- 缩进围栏代码块能渲染，且代码内容没有额外整体缩进
- 代码块右上角复制按钮不占用额外一行，点击后能复制代码
- 生成中点击停止显示 `已停止生成`
