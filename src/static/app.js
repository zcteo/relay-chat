const $ = (id) => document.getElementById(id)
const KEY = "relaychat-state-v1"

const defaultState = {
  settings: {
    theme: "auto",
    protocol: "openai_responses",
    baseUrl: "",
    token: "",
    model: "",
    models: [],
    thinking: false,
    temperature: "",
    maxTokens: "",
    systemPrompt: "",
  },
  sessions: [],
  currentId: null,
}
let state = load()
let sending = false
let currentAbort = null
let generationStopped = false
let followScroll = true
let userScrollIntent = false
let userScrollIntentTimer = null

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
function load() {
  try {
    const loaded = {
      ...structuredClone(defaultState),
      ...(JSON.parse(localStorage.getItem(KEY)) || {}),
    }
    loaded.settings = {
      ...structuredClone(defaultState.settings),
      ...(loaded.settings || {}),
    }
    return loaded
  } catch {
    return structuredClone(defaultState)
  }
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(state))
}
function current() {
  return state.sessions.find((s) => s.id === state.currentId)
}
function ensureSession() {
  if (!state.sessions.length) newSession()
  if (!state.currentId) state.currentId = state.sessions[0].id
}
function isBlankSession(s) {
  return (
    !!s &&
    (!s.messages || s.messages.length === 0) &&
    (!s.title || s.title === "新会话")
  )
}
function newSession() {
  const cur = current()
  if (isBlankSession(cur)) {
    render()
    return
  }
  const existing = state.sessions.find(isBlankSession)
  if (existing) {
    state.currentId = existing.id
    save()
    render()
    return
  }
  const s = {
    id: uid(),
    title: "新会话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
  state.sessions.unshift(s)
  state.currentId = s.id
  save()
  render()
}

function syncSettingsToUI() {
  const s = state.settings
  $("theme").value = s.theme || "auto"
  $("protocol").value = s.protocol || "openai_responses"
  $("settingsProtocol").value = s.protocol || "openai_responses"
  $("baseUrl").value = s.baseUrl || ""
  $("token").value = s.token || ""
  $("thinking").checked = !!s.thinking
  $("temperature").value = s.temperature ?? ""
  $("maxTokens").value = s.maxTokens ?? ""
  $("systemPrompt").value = s.systemPrompt || ""
  renderModels()
}
function syncSettingsFromUI() {
  Object.assign(state.settings, {
    theme: $("theme").value,
    protocol: $("protocol").value,
    baseUrl: $("baseUrl").value.trim(),
    token: $("token").value.trim(),
    model: $("model").value || state.settings.model,
    thinking: $("thinking").checked,
    temperature: $("temperature").value,
    maxTokens: $("maxTokens").value,
    systemPrompt: $("systemPrompt").value,
  })
  save()
  applyTheme()
}
function renderModels() {
  const selects = [$("model"), $("settingsModel")]
  for (const sel of selects) sel.innerHTML = ""
  const models = [...(state.settings.models || [])]
  if (!models.length && state.settings.model)
    models.push({ id: state.settings.model, name: state.settings.model })
  for (const m of models) {
    for (const sel of selects) {
      const opt = document.createElement("option")
      opt.value = m.id
      opt.textContent = m.name || m.id
      sel.appendChild(opt)
    }
  }
  if (state.settings.model)
    for (const sel of selects) sel.value = state.settings.model
}
function inferProtocolFromModel(model) {
  return String(model || "")
    .toLowerCase()
    .includes("claude")
    ? "anthropic"
    : "openai_chat"
}
function applyProtocolForModel(model) {
  state.settings.protocol = inferProtocolFromModel(model)
  if ($("protocol")) $("protocol").value = state.settings.protocol
  if ($("settingsProtocol"))
    $("settingsProtocol").value = state.settings.protocol
}
function renderModelLabel() {
  const model = state.settings.model || "选择模型"
  $("modelLabel").textContent = model
}
function resolvedTheme() {
  const theme = state.settings.theme || "auto"
  if (theme === "dark" || theme === "light") return theme
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}
function applyTheme() {
  const theme = state.settings.theme || "auto"
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.resolvedTheme = resolvedTheme()
}

function closeSessionMenus() {
  document
    .querySelectorAll(".session-menu")
    .forEach((m) => m.classList.add("hidden"))
}
function renameSession(id) {
  const s = state.sessions.find((x) => x.id === id)
  if (!s) return
  const title = prompt("重命名会话", s.title || "新会话")
  if (title === null) return
  const next = title.trim()
  if (!next) return
  s.title = next
  s.updatedAt = Date.now()
  save()
  renderSessions()
}
function deleteSession(id) {
  const s = state.sessions.find((x) => x.id === id)
  if (!s || !confirm("删除该会话？")) return
  state.sessions = state.sessions.filter((x) => x.id !== id)
  if (state.currentId === id) state.currentId = state.sessions[0]?.id || null
  save()
  render()
}
function renderSessions() {
  $("sessions").innerHTML = ""
  for (const s of state.sessions) {
    const item = document.createElement("div")
    item.className = "session" + (s.id === state.currentId ? " active" : "")
    item.title = new Date(s.updatedAt || s.createdAt).toLocaleString()

    const name = document.createElement("div")
    name.className = "session-title"
    name.textContent = s.title || "未命名会话"
    const more = document.createElement("button")
    more.className = "session-more"
    more.type = "button"
    more.textContent = "⋯"
    more.title = "更多"
    const menu = document.createElement("div")
    menu.className = "session-menu hidden"
    const rename = document.createElement("button")
    rename.type = "button"
    rename.textContent = "重命名"
    const del = document.createElement("button")
    del.type = "button"
    del.className = "danger-item"
    del.textContent = "删除"
    menu.append(rename, del)

    more.onclick = (e) => {
      e.stopPropagation()
      const hidden = menu.classList.contains("hidden")
      closeSessionMenus()
      if (hidden) menu.classList.remove("hidden")
    }
    rename.onclick = (e) => {
      e.stopPropagation()
      closeSessionMenus()
      renameSession(s.id)
    }
    del.onclick = (e) => {
      e.stopPropagation()
      closeSessionMenus()
      deleteSession(s.id)
    }
    item.onclick = () => {
      state.currentId = s.id
      closeSessionMenus()
      save()
      render()
    }
    item.append(name, more, menu)
    $("sessions").appendChild(item)
  }
}
function renderMessages() {
  const box = $("messages")
  box.innerHTML = ""
  const s = current()
  const empty = !s || !s.messages.length
  document.querySelector(".main").classList.toggle("empty-chat", empty)
  if (empty) {
    const p = document.createElement("div")
    p.className = "muted"
    p.textContent = "开始一个新问题，数据只会保存在本地浏览器。"
    box.appendChild(p)
    return
  }
  for (const m of s.messages) box.appendChild(messageEl(m))
  scrollMessagesToBottom()
  updateScrollBottomButton()
}
function messageEl(m) {
  const div = document.createElement("div")
  div.className = "msg " + m.role
  const role = document.createElement("div")
  role.className = "role"
  role.textContent = m.role === "user" ? "你" : "AI"
  div.appendChild(role)
  if (m.role === "assistant") {
    const th = document.createElement("div")
    th.className = "thinking"
    th.innerHTML = MarkdownLite.render(m.thinking || "")
    div.appendChild(th)
  }
  const c = document.createElement("div")
  c.className = "content"
  if (m.role === "assistant") c.innerHTML = MarkdownLite.render(m.content || "")
  else c.textContent = m.content || ""
  div.appendChild(c)
  return div
}
function render() {
  ensureSession()
  renderSessions()
  renderMessages()
  syncSettingsToUI()
  renderModelLabel()
}
function setError(text) {
  const box = $("messages")
  const e = document.createElement("div")
  e.className = "error"
  e.textContent = text
  box.appendChild(e)
  autoScrollMessages()
}
function showToast(text) {
  const el = $("toast")
  el.textContent = text
  el.classList.remove("hidden")
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => el.classList.add("hidden"), 2200)
}
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement("textarea")
  ta.value = text
  ta.setAttribute("readonly", "")
  ta.style.position = "fixed"
  ta.style.left = "-9999px"
  document.body.appendChild(ta)
  ta.select()
  document.execCommand("copy")
  ta.remove()
}
async function copyCode(button) {
  const code = button.closest(".code-block")?.querySelector("code")
  if (!code) return
  try {
    await copyText(code.textContent || "")
    button.classList.add("copied")
    button.title = "已复制"
    button.setAttribute("aria-label", "已复制")
    clearTimeout(button.copyTimer)
    button.copyTimer = setTimeout(() => {
      button.classList.remove("copied")
      button.title = "复制代码"
      button.setAttribute("aria-label", "复制代码")
    }, 1200)
  } catch {
    showToast("复制失败")
  }
}

function isMessagesAtBottom() {
  const box = $("messages")
  return box.scrollHeight - box.scrollTop - box.clientHeight <= 4
}
function shouldShowScrollBottomButton() {
  const box = $("messages")
  return box.scrollHeight - box.scrollTop - box.clientHeight > 256
}
function updateScrollBottomButton() {
  const button = $("scrollBottom")
  if (!button) return
  const composer = $("composer")
  if (composer) button.style.bottom = `${composer.offsetHeight + 34}px`
  const hidden =
    !shouldShowScrollBottomButton() ||
    document.querySelector(".main").classList.contains("empty-chat")
  button.classList.toggle("hidden", hidden)
}
function scrollMessagesToBottom() {
  const box = $("messages")
  box.scrollTop = box.scrollHeight
  followScroll = true
  updateScrollBottomButton()
}
function autoScrollMessages() {
  if (!followScroll) {
    updateScrollBottomButton()
    return
  }
  scrollMessagesToBottom()
}
function markUserScrollIntent() {
  userScrollIntent = true
  clearTimeout(userScrollIntentTimer)
  userScrollIntentTimer = setTimeout(() => {
    userScrollIntent = false
  }, 250)
}
function clearUserScrollIntentSoon() {
  clearTimeout(userScrollIntentTimer)
  userScrollIntentTimer = setTimeout(() => {
    userScrollIntent = false
  }, 80)
}
function handleMessagesScroll() {
  if (userScrollIntent) followScroll = isMessagesAtBottom()
  updateScrollBottomButton()
}

function createTypewriter(contentEl, thinkingEl) {
  let contentQueue = ""
  let thinkingQueue = ""
  let shownContent = ""
  let shownThinking = ""
  let timer = null
  let resolveIdle = null

  function take(queue, n) {
    const part = queue.slice(0, n)
    return [part, queue.slice(n)]
  }
  function chunkSize(total) {
    if (total > 800) return 18
    if (total > 400) return 12
    if (total > 180) return 8
    if (total > 80) return 5
    if (total > 30) return 3
    return 1
  }
  function nextDelay(total) {
    if (total > 300) return 8
    if (total > 120) return 14
    if (total > 40) return 22
    return 32
  }
  function tick() {
    const total = contentQueue.length + thinkingQueue.length
    if (!total) {
      timer = null
      if (resolveIdle) {
        const r = resolveIdle
        resolveIdle = null
        r()
      }
      return
    }

    const n = chunkSize(total)
    if (thinkingQueue) {
      const got = take(thinkingQueue, n)
      shownThinking += got[0]
      thinkingQueue = got[1]
      thinkingEl.innerHTML = MarkdownLite.render(shownThinking)
    } else if (contentQueue) {
      const got = take(contentQueue, n)
      shownContent += got[0]
      contentQueue = got[1]
      contentEl.innerHTML = MarkdownLite.render(shownContent)
    }
    autoScrollMessages()
    timer = setTimeout(
      tick,
      nextDelay(contentQueue.length + thinkingQueue.length),
    )
  }
  function start() {
    if (!timer)
      timer = setTimeout(
        tick,
        nextDelay(contentQueue.length + thinkingQueue.length),
      )
  }
  return {
    pushContent(text) {
      if (!text) return
      contentQueue += text
      start()
    },
    pushThinking(text) {
      if (!text) return
      thinkingQueue += text
      start()
    },
    async finish() {
      if (!timer && !contentQueue && !thinkingQueue) return
      await new Promise((resolve) => {
        resolveIdle = resolve
        start()
      })
    },
  }
}

async function loadModels() {
  syncSettingsFromUI()
  if (!state.settings.baseUrl || !state.settings.token)
    return alert("请先填写 API URL 和 Token")
  $("loadModels").disabled = true
  $("loadModels").textContent = "获取中..."
  try {
    const r = await fetch("/api/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.settings),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.detail || r.statusText)
    state.settings.models = data.models || []
    const hasCurrent = state.settings.models.some(
      (m) => m.id === state.settings.model,
    )
    if ((!state.settings.model || !hasCurrent) && state.settings.models[0]) {
      state.settings.model = state.settings.models[0].id
      applyProtocolForModel(state.settings.model)
    }
    save()
    renderModels()
    renderModelLabel()
    showToast(`获取模型成功，已保存（${state.settings.models.length} 个模型）`)
  } catch (e) {
    alert("获取模型失败：" + e.message)
  } finally {
    $("loadModels").disabled = false
    $("loadModels").textContent = "获取模型"
  }
}

function requestMessages(session) {
  const msgs = []
  if (state.settings.systemPrompt.trim())
    msgs.push({ role: "system", content: state.settings.systemPrompt.trim() })
  for (const m of session.messages)
    msgs.push({ role: m.role, content: m.content || "" })
  return msgs
}
function setSendingUI(active) {
  sending = active
  $("send").classList.toggle("stop", active)
  $("send").disabled = false
  $("send").setAttribute("aria-label", active ? "停止" : "发送")
}
function stopGeneration() {
  generationStopped = true
  if (currentAbort) currentAbort.abort()
}
function autoResizeInput() {
  const el = $("input")
  const max = Math.max(96, Math.floor($("messages").clientHeight / 3))
  el.style.height = "auto"
  const base = 24
  const next = Math.max(base, Math.min(el.scrollHeight, max))
  el.style.height = next + "px"
  el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden"
  updateScrollBottomButton()
}
async function sendMessage(text) {
  if (sending) return
  syncSettingsFromUI()
  if (!state.settings.baseUrl || !state.settings.token || !state.settings.model)
    return alert("请先配置 URL、Token 并选择模型")
  const s = current()
  s.messages.push({ role: "user", content: text })
  const payloadMessages = requestMessages(s)
  if (!s.title || s.title === "新会话")
    s.title = text.slice(0, 24).replace(/\s+/g, " ") || "新会话"
  const assistant = { role: "assistant", content: "", thinking: "" }
  s.messages.push(assistant)
  s.updatedAt = Date.now()
  save()
  render()

  const msgNodes = $("messages").querySelectorAll(".msg.assistant")
  const node = msgNodes[msgNodes.length - 1]
  const contentEl = node.querySelector(".content")
  const thinkingEl = node.querySelector(".thinking")
  const typer = createTypewriter(contentEl, thinkingEl)
  currentAbort = new AbortController()
  generationStopped = false
  setSendingUI(true)
  try {
    const payload = {
      ...state.settings,
      messages: payloadMessages,
      temperature:
        state.settings.temperature === ""
          ? null
          : Number(state.settings.temperature),
      max_tokens:
        state.settings.maxTokens === ""
          ? null
          : Number(state.settings.maxTokens),
    }
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: currentAbort.signal,
    })
    if (!resp.ok || !resp.body) throw new Error(await resp.text())
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split("\n\n")
      buf = parts.pop() || ""
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data:"))
        if (!line) continue
        const ev = JSON.parse(line.slice(5))
        if (ev.type === "content") {
          assistant.content += ev.delta
          typer.pushContent(ev.delta)
        } else if (ev.type === "thinking") {
          assistant.thinking += ev.delta
          typer.pushThinking(ev.delta)
        } else if (ev.type === "error")
          throw new Error(
            typeof ev.error === "string" ? ev.error : JSON.stringify(ev.error),
          )
        autoScrollMessages()
      }
    }
    await typer.finish()
  } catch (e) {
    if (e.name === "AbortError") {
      if (generationStopped && !assistant.content.includes("已停止生成")) {
        assistant.content += (assistant.content ? "\n\n" : "") + "已停止生成"
        contentEl.innerHTML = MarkdownLite.render(assistant.content)
        autoScrollMessages()
      }
    } else {
      setError("请求失败：" + e.message)
    }
  } finally {
    currentAbort = null
    generationStopped = false
    setSendingUI(false)
    s.updatedAt = Date.now()
    save()
    renderSessions()
  }
}

$("newChat").onclick = newSession
$("deleteChat").onclick = () => {
  const s = current()
  if (!s || !confirm("删除当前会话？")) return
  state.sessions = state.sessions.filter((x) => x.id !== s.id)
  state.currentId = state.sessions[0]?.id || null
  closeMenu()
  save()
  render()
}
$("deleteAllChats").onclick = () => {
  if (!state.sessions.length || !confirm("删除全部会话？此操作不可恢复。"))
    return
  state.sessions = []
  state.currentId = null
  closeMenu()
  save()
  render()
}
$("saveSettings").onclick = () => {
  syncSettingsFromUI()
  showToast("设置已保存到浏览器本地")
}
$("loadModels").onclick = loadModels
function setModelFromSelect(value, infer = true) {
  state.settings.model = value
  if (infer) applyProtocolForModel(state.settings.model)
  $("model").value = state.settings.model
  $("settingsModel").value = state.settings.model
  save()
  renderModelLabel()
}
$("model").onchange = () => setModelFromSelect($("model").value, true)
$("settingsModel").onchange = () =>
  setModelFromSelect($("settingsModel").value, true)
$("settingsProtocol").onchange = () => {
  state.settings.protocol = $("settingsProtocol").value
  $("protocol").value = state.settings.protocol
  save()
  renderModelLabel()
}
$("send").onclick = (e) => {
  if (sending) {
    e.preventDefault()
    stopGeneration()
  }
}
$("composer").onsubmit = (e) => {
  e.preventDefault()
  if (sending) return
  const text = $("input").value.trim()
  if (!text) return
  $("input").value = ""
  autoResizeInput()
  sendMessage(text)
}
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    if (!sending) $("composer").requestSubmit()
  }
})
$("input").addEventListener("input", autoResizeInput)
$("messages").addEventListener("wheel", markUserScrollIntent, { passive: true })
$("messages").addEventListener("touchstart", markUserScrollIntent, {
  passive: true,
})
$("messages").addEventListener("touchmove", markUserScrollIntent, {
  passive: true,
})
$("messages").addEventListener("pointerdown", markUserScrollIntent)
document.addEventListener("pointerup", clearUserScrollIntentSoon)
$("messages").addEventListener("scroll", handleMessagesScroll)
$("scrollBottom").onclick = () => {
  userScrollIntent = false
  clearTimeout(userScrollIntentTimer)
  scrollMessagesToBottom()
}
window.addEventListener("resize", autoResizeInput)
function closeMenu() {
  $("appMenu").classList.add("hidden")
}
function toggleMenu() {
  $("appMenu").classList.toggle("hidden")
  $("modelMenu").classList.add("hidden")
}
function closeModelMenu() {
  $("modelMenu").classList.add("hidden")
}
function toggleModelMenu() {
  $("modelMenu").classList.toggle("hidden")
  $("appMenu").classList.add("hidden")
}
function closePopovers() {
  closeMenu()
  closeModelMenu()
  closeSessionMenus()
}
$("menuToggle").onclick = (e) => {
  e.stopPropagation()
  toggleMenu()
}
$("modelSwitcher").onclick = (e) => {
  e.stopPropagation()
  toggleModelMenu()
  setTimeout(() => $("model").focus(), 0)
}
$("appMenu").onclick = (e) => e.stopPropagation()
$("modelMenu").onclick = (e) => e.stopPropagation()
document.addEventListener("click", closePopovers)
document.addEventListener("click", (e) => {
  const button = e.target.closest(".copy-code")
  if (!button) return
  e.preventDefault()
  e.stopPropagation()
  copyCode(button)
})
$("protocol").addEventListener("change", () => {
  state.settings.protocol = $("protocol").value
  $("settingsProtocol").value = state.settings.protocol
  save()
  renderModelLabel()
})
for (const id of [
  "theme",
  "baseUrl",
  "token",
  "thinking",
  "temperature",
  "maxTokens",
  "systemPrompt",
])
  $(id).addEventListener("change", () => {
    syncSettingsFromUI()
    renderModelLabel()
  })
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)")
if (colorSchemeQuery.addEventListener)
  colorSchemeQuery.addEventListener("change", applyTheme)
else colorSchemeQuery.addListener(applyTheme)
applyTheme()
render()
autoResizeInput()
