# RelayChat 开发交接说明

本文档面向没有历史上下文的新一轮开发，用于快速理解项目现状、约束和后续改动注意事项。

## 项目目标

这是一个部署在“能访问 AI API 的服务器”上的轻量 AI 问答网站。

核心设计：

- 后端只做 API 转发和协议适配，不保存用户数据。
- 前端保存所有设置、Token、模型列表和聊天历史到浏览器 `localStorage`。
- 用户在页面里配置 API Base URL 和 Token。
- 用户填写的 API URL 不带 `/v1`，后端统一拼接 `/v1/...`。
- 页面风格参考 ChatGPT 浅色界面。

## 当前目录结构

```text
relay-chat/
├── README.md              # 面向使用者的启动/安装说明
├── TODO.md                # 后续待办事项
├── HANDOFF.md             # 本文件，面向新开发者
├── requirements.txt       # Python 依赖
├── .gitignore
├── etc/
│   ├── install.sh         # systemd 安装脚本
│   └── uninstall.sh       # systemd 卸载脚本
└── src/
    ├── __init__.py
    ├── main.py            # FastAPI 后端
    └── static/
        ├── index.html     # 页面结构
        ├── style.css      # 样式
        ├── app.js         # 前端主逻辑
        └── markdown.js    # 独立 Markdown 渲染器
```

## 运行方式

开发启动：

```bash
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000
```

systemd 安装：

```bash
sudo ./etc/install.sh
```

使用反向代理/HTTPS 时推荐：

```bash
sudo ./etc/install.sh --host 127.0.0.1 --port 8000
```

日志：

```bash
journalctl -u relay-chat.service -f
```

改完代码后的部署/运行方式需要先检测当前环境：

```bash
systemctl is-active relay-chat.service
```

如果输出为 `active`，说明当前以 systemd 服务运行，直接重启部署：

```bash
sudo systemctl restart relay-chat.service
```

如果不是 systemd 运行，按开发方式直接启动项目：

```bash
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000
```

## 后端说明

后端入口：

```text
src/main.py
```

FastAPI 路由：

- `GET /`
  - 返回 `src/static/index.html`
- `POST /api/models`
  - 请求上游：`<baseUrl>/v1/models`
- `POST /api/chat`
  - 根据协议转发到不同上游接口，并统一输出内部 SSE 事件

静态文件路径使用 `Path(__file__)` 推导，不依赖进程工作目录：

```python
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
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
src/static/app.js
```

Markdown 渲染：

```text
src/static/markdown.js
```

不要把 Markdown 渲染逻辑塞回 `app.js`。

### localStorage

本地存储 key：

```js
const KEY = 'relaychat-state-v1';
```

状态大致结构：

```js
{
  settings: {
    protocol,
    baseUrl,
    token,
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

当前所有设置和历史都只存在浏览器本地。

### 协议选择 UI

页面上有两处模型/协议选择：

1. 左上角模型名点击后的弹层
2. 右上角三点菜单里的设置区

这是用户明确要求的，不要当成重复 UI 删除。

两处应保持同步。

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
- 当前重命名仍使用 `prompt`，TODO 中要求未来改为直接编辑。
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

图标不直接引用 ChatGPT 私有 sprite 路径 `/cdn/assets/...`，因为本站会 404。

当前做法：使用内联 SVG 实现相似图标：

- 模型下拉箭头
- 发送按钮
- 停止按钮
- 代码块复制按钮

`src/static/style.css` 已使用 Prettier 格式化为多行 CSS。后续修改样式时保持可读格式，不要压回单行。

所有 JS 文件采用 Prettier 格式化和无分号风格。后续新增或修改 JS 时保持同一格式，不要重新引入行尾分号。

## 安全现状

当前没有登录认证，也没有 URL 白名单。

公网裸露风险主要不是别人读取你的浏览器 localStorage，而是：

- SSRF：别人可让服务器请求任意 baseUrl
- 资源滥用：长连接、并发、带宽
- 被当代理跳板

相关增强已经写在 `TODO.md`：

- 访问认证
- 配置文件 URL 白名单
- 数据保存到后端

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
10. 修改目录结构时，同步 `etc/install.sh` 的 `uvicorn src.main:app`。
11. 修改功能或数据结构时，不考虑旧数据同步、旧数据迁移、旧 localStorage 兼容；按新逻辑直接覆盖。

## 快速验证清单

改动后至少验证：

```bash
python3 -m py_compile src/main.py
bash -n etc/install.sh
bash -n etc/uninstall.sh
python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000
```

浏览器验证：

- 首页可打开
- `/static/app.js`、`/static/markdown.js`、`/static/style.css` 可加载
- 获取模型成功后顶部 toast 提示
- 模型/协议左右两个菜单同步
- 空会话输入框和提示词在一起
- 发送后流式输出
- Markdown 正文和 thinking 都能渲染
- Markdown 分隔线能渲染为横线
- 缩进围栏代码块能渲染，且代码内容没有额外整体缩进
- 代码块右上角复制按钮不占用额外一行，点击后能复制代码
- 生成中点击停止显示 `已停止生成`
