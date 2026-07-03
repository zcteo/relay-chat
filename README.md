# RelayChat

部署在可访问 AI API 的服务器上的轻量问答网站。后端使用 Python/FastAPI 转发请求，前端为静态页面。

全部功能都是 vibe coding 实现，坚决不写一行代码，狠狠的压榨 AI 就完事了

## 功能

- 浏览器本地保存设置、Token、模型列表、多会话历史
- 多会话聊天，提问时自动携带上下文
- 支持模型列表获取：`/v1/models`
- 支持三种协议：
  - `Anthropic` -> `/v1/messages`
  - `OpenAI Chat` -> `/v1/chat/completions`
  - `OpenAI Responses` -> `/v1/responses`
- 切换模型时自动推断协议：
  - 模型名包含 `claude` -> Anthropic
  - 其他模型 -> OpenAI Chat
- 支持流式显示和前端逐字输出效果
- 用户向上查看历史时暂停自动滚动，离底部较远时显示回到底部按钮
- 支持 thinking/reasoning 展示
- 支持外观设置：自动、浅色、深色；自动模式跟随浏览器或系统主题
- 支持轻量 Markdown 渲染：标题、列表、引用、分隔线、链接、行内代码、围栏代码块
- 代码块支持右上角复制按钮
- 生成中可点击停止按钮打断；生成中不能发送新消息
- 类 ChatGPT 界面：左侧会话列表、顶部模型选择、右上角设置菜单

## 启动

```bash
pip install -r requirements.txt
python3 -m uvicorn server.main:app --host 0.0.0.0 --port 8000
```

访问：

```text
http://服务器IP:8000
```

## 注意

- 用户填写的 API URL 不带 `/v1`，后端会自动拼接 `/v1/...`。
- 转发请求默认带：`X-Origin-Agent: stepcode`。
- Anthropic 鉴权也使用：`Authorization: Bearer <token>`。
- Token 当前保存在浏览器 `localStorage`，生产公网部署建议配合 HTTPS 和访问认证。
- 安全增强计划见 `docs/TODO.md`。

## systemd 安装

安装并启动服务：

```bash
sudo ./scripts/install.sh
```

默认配置：

```text
服务名: relay-chat
监听: 0.0.0.0:8000
运行用户: 当前用户；sudo 执行时为 sudo 调用用户
```

参数形式覆盖默认值：

```bash
sudo ./scripts/install.sh --service-name relay-chat --host 127.0.0.1 --port 8000 --user zzc
```

如果使用 Nginx/Caddy 做 HTTPS 反代，推荐只监听本机：

```bash
sudo ./scripts/install.sh --host 127.0.0.1 --port 8000
```

查看状态：

```bash
systemctl status relay-chat.service
```

查看日志：

```bash
journalctl -u relay-chat.service -f
```

修改后端代码后重新部署当前服务：

```bash
sudo systemctl restart relay-chat.service
```

只修改 `static/` 下的前端静态文件时，刷新浏览器即可生效。

卸载 systemd 服务：

```bash
sudo ./scripts/uninstall.sh
```

卸载自定义服务名：

```bash
sudo ./scripts/uninstall.sh --service-name relay-chat
```
