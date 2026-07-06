const $ = (id) => document.getElementById(id)
const TITLE_GENERATION_TIMEOUT_MS = 30000

const defaultBrowserSettings = {
  theme: "auto",
  thinking: true,
  maxTokens: "",
  systemPrompt: "",
  historyCount: "6",
  accessCode: "",
}
const defaultModeSettings = {
  protocol: "openai_responses",
  baseUrl: "",
  token: "",
  apiCredentials: {},
  model: "",
  models: [],
}
const defaultState = {
  settings: {
    ...defaultBrowserSettings,
    ...defaultModeSettings,
  },
  sessions: [],
  currentId: null,
}
let serverAuth = RelayAuth.loadServerAuth()
let serverReady = !serverAuth?.token
let state = serverAuth?.token ? structuredClone(defaultState) : loadLocal()
let sending = false
let currentAbort = null
let titleAbort = null
let titleAbortSessionId = null
let generationStopped = false
let followScroll = true
let userScrollIntent = false
let userScrollIntentTimer = null
let popoverPointerStartedInside = false

function pick(source, keys) {
  const out = {}
  for (const key of keys) out[key] = source[key]
  return out
}
function browserSettings() {
  return pick(state.settings, Object.keys(defaultBrowserSettings))
}
function modeSettings() {
  return pick(state.settings, Object.keys(defaultModeSettings))
}
function mergedSettings(modeSettingsValue = {}) {
  return {
    ...RelayBrowserSettings.load(defaultBrowserSettings),
    ...structuredClone(defaultModeSettings),
    ...(modeSettingsValue || {}),
  }
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
function showModal({
  title = "提示",
  message = "",
  confirmText = "确定",
  cancelText = "取消",
  showCancel = false,
  input = false,
  inputLabel = "内容",
  inputType = "text",
  defaultValue = "",
} = {}) {
  return new Promise((resolve) => {
    const modal = $("customModal")
    const inputWrap = $("modalInputWrap")
    const inputEl = $("modalInput")
    const fieldsEl = $("modalFields")
    const cancel = $("modalCancel")
    const confirm = $("modalConfirm")

    $("modalTitle").textContent = title
    $("modalMessage").textContent = message
    $("modalInputLabel").textContent = inputLabel
    confirm.textContent = confirmText
    cancel.textContent = cancelText
    cancel.classList.toggle("hidden", !showCancel)
    inputWrap.classList.toggle("hidden", !input)
    fieldsEl.classList.add("hidden")
    fieldsEl.replaceChildren()
    inputEl.type = inputType
    inputEl.value = defaultValue || ""
    modal.classList.remove("hidden")

    function cleanup(value) {
      modal.classList.add("hidden")
      confirm.onclick = null
      cancel.onclick = null
      inputEl.onkeydown = null
      resolve(value)
    }

    confirm.onclick = () => cleanup(input ? inputEl.value : true)
    cancel.onclick = () => cleanup(input ? null : false)
    inputEl.onkeydown = (e) => {
      if (e.key === "Enter") cleanup(inputEl.value)
      if (e.key === "Escape") cleanup(null)
    }
    if (input) setTimeout(() => inputEl.focus(), 0)
    else setTimeout(() => confirm.focus(), 0)
  })
}
function showAlert(message, title = "提示") {
  return showModal({ title, message, showCancel: false })
}
function showConfirm(message, title = "确认") {
  return showModal({ title, message, showCancel: true })
}
function showPrompt(message, defaultValue = "", title = "输入") {
  return showModal({
    title,
    message,
    input: true,
    defaultValue,
    showCancel: true,
  })
}
function showFormModal({
  title = "提示",
  message = "",
  fields = [],
  confirmText = "确定",
  cancelText = "取消",
} = {}) {
  return new Promise((resolve) => {
    const modal = $("customModal")
    const inputWrap = $("modalInputWrap")
    const fieldsEl = $("modalFields")
    const cancel = $("modalCancel")
    const confirm = $("modalConfirm")
    const inputs = {}

    $("modalTitle").textContent = title
    $("modalMessage").textContent = message
    confirm.textContent = confirmText
    cancel.textContent = cancelText
    cancel.classList.remove("hidden")
    inputWrap.classList.add("hidden")
    fieldsEl.classList.remove("hidden")
    fieldsEl.replaceChildren()

    for (const field of fields) {
      const label = document.createElement("label")
      label.textContent = field.label
      const input = document.createElement("input")
      input.type = field.type || "text"
      input.autocomplete = field.autocomplete || "off"
      input.value = field.defaultValue || ""
      label.appendChild(input)
      fieldsEl.appendChild(label)
      inputs[field.name] = input
    }

    function cleanup(value) {
      modal.classList.add("hidden")
      fieldsEl.classList.add("hidden")
      fieldsEl.replaceChildren()
      confirm.onclick = null
      cancel.onclick = null
      document.onkeydown = null
      resolve(value)
    }

    confirm.onclick = () => {
      const values = {}
      for (const [name, input] of Object.entries(inputs))
        values[name] = input.value
      cleanup(values)
    }
    cancel.onclick = () => cleanup(null)
    document.onkeydown = (e) => {
      if (e.key === "Escape") cleanup(null)
    }
    const first = Object.values(inputs)[0]
    if (first) setTimeout(() => first.focus(), 0)
    modal.classList.remove("hidden")
  })
}
function saveServerAuth(auth) {
  serverAuth = auth
  RelayAuth.saveServerAuth(auth)
}
function savedAccessCode() {
  return state.settings.accessCode || ""
}
function setSavedAccessCode(code) {
  state.settings.accessCode = String(code || "").trim()
  saveBrowser()
}
function clearSavedAccessCode() {
  state.settings.accessCode = ""
  saveBrowser()
}
function proxyHeaders() {
  const headers = { "Content-Type": "application/json" }
  if (isServerMode() && serverAuth?.token)
    headers.Authorization = `Bearer ${serverAuth.token}`
  else {
    const code = savedAccessCode()
    if (code) headers["X-Access-Code"] = code
  }
  return headers
}
function loadLocal() {
  const localState = RelayLocalStorage.load({
    settings: structuredClone(defaultModeSettings),
    sessions: [],
    currentId: null,
  })
  return {
    ...structuredClone(defaultState),
    ...localState,
    settings: mergedSettings(localState.settings),
  }
}
function saveBrowser() {
  RelayBrowserSettings.save(browserSettings())
}
function saveLocal() {
  RelayLocalStorage.save({
    settings: modeSettings(),
    sessions: state.sessions,
    currentId: state.currentId,
  })
}
function saveMode() {
  if (!isServerMode()) saveLocal()
}
function saveState() {
  saveBrowser()
  if (!isServerMode()) saveLocal()
}
function current() {
  return state.sessions.find((s) => s.id === state.currentId)
}
function isServerMode() {
  return !!serverAuth?.token
}
function hasLocalData() {
  return RelayLocalStorage.hasData()
}
function clearLocalData() {
  RelayLocalStorage.clear()
}
function handleTokenExpired() {
  saveServerAuth(null)
  serverReady = true
  state = loadLocal()
  render()
  renderAuthGate()
}
function hideGates() {
  $("authGate").classList.add("hidden")
}
function renderAccountStatus() {
  const status = $("accountStatus")
  if (!status) return
  const username = serverAuth?.user?.username
  status.textContent =
    isServerMode() && username ? `已登录：${username}` : "未登录，正在本地使用"
  $("openLogin").classList.toggle("hidden", isServerMode() && !!username)
  $("logoutAccount").classList.toggle("hidden", !(isServerMode() && !!username))
  $("changePassword").classList.toggle("hidden", !(isServerMode() && !!username))
  $("resetPassword").classList.toggle(
    "hidden",
    !(isServerMode() && serverAuth?.user?.resetPasswd),
  )
}
function renderAuthGate() {
  $("authGate").classList.remove("hidden")
  renderLoginView()
  renderAccountStatus()
}
function renderLoginView() {
  $("authTitle").textContent = "登录"
  $("authIntro").textContent = "登录后可通过账号同步 API 配置和对话记录。"
  $("authPasswordConfirmWrap").classList.add("hidden")
  $("authRegistrationCodeWrap").classList.add("hidden")
  $("loginButton").classList.remove("hidden")
  $("registerButton").classList.remove("hidden")
  $("backToLoginButton").classList.add("hidden")
  $("submitRegisterButton").classList.add("hidden")
  $("authPassword").value = ""
  $("authPasswordConfirm").value = ""
  $("authRegistrationCode").value = ""
  setTimeout(() => $("authUsername").focus(), 0)
}
function renderRegisterView() {
  $("authTitle").textContent = "注册"
  $("authIntro").textContent = "创建账号后返回登录界面。"
  $("authPasswordConfirmWrap").classList.remove("hidden")
  $("authRegistrationCodeWrap").classList.remove("hidden")
  $("loginButton").classList.add("hidden")
  $("registerButton").classList.add("hidden")
  $("backToLoginButton").classList.remove("hidden")
  $("submitRegisterButton").classList.remove("hidden")
  $("authPassword").value = ""
  $("authPasswordConfirm").value = ""
  $("authRegistrationCode").value = ""
  setTimeout(() => $("authUsername").focus(), 0)
}
async function verifyAccessCode(code) {
  const headers = {}
  if (code) headers["X-Access-Code"] = code
  const resp = await fetch("/api/access", { headers })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const err = new Error(data.detail || data.error || resp.statusText)
    err.status = resp.status
    throw err
  }
  return data
}
async function requireLocalAccess() {
  if (isServerMode()) return true
  const savedCode = savedAccessCode()
  if (savedCode) {
    try {
      await verifyAccessCode(savedCode)
      return true
    } catch (e) {
      if (e.status === 429) await showAlert("尝试过于频繁，请稍后再试")
      clearSavedAccessCode()
    }
  }
  try {
    const data = await verifyAccessCode("")
    if (!data.accessRequired) return true
  } catch (e) {
    if (e.status === 429) await showAlert("尝试过于频繁，请稍后再试")
  }
  while (!isServerMode()) {
    const code = await showModal({
      title: "访问认证",
      message: "请输入访问码后继续使用。",
      input: true,
      inputLabel: "访问码",
      inputType: "password",
      confirmText: "进入",
      showCancel: false,
    })
    if (!code || !String(code).trim()) continue
    try {
      await verifyAccessCode(code)
      setSavedAccessCode(code)
      return true
    } catch (e) {
      await showAlert(
        e.status === 429
          ? "尝试过于频繁，请稍后再试"
          : "访问码错误，请重新输入",
      )
    }
  }
  return false
}
async function handleProxyUnauthorized() {
  if (isServerMode()) {
    handleTokenExpired()
    throw new Error("登录已过期，请重新登录")
  }
  clearSavedAccessCode()
  await requireLocalAccess()
  throw new Error("访问认证已失效，请重新发送请求")
}
function applyServerSettings(settings) {
  state.settings = mergedSettings(settings)
  state.settings.apiCredentials = normalizeApiCredentials(
    state.settings.apiCredentials,
  )
}
async function loadServerHome() {
  if (!serverAuth?.token) {
    serverReady = false
    renderAuthGate()
    return
  }
  serverReady = false
  hideGates()
  try {
    const data = await RelayServerStorage.loadHome(
      serverAuth,
      handleTokenExpired,
    )
    saveServerAuth({ ...serverAuth, user: data.profile.user })
    state = structuredClone(defaultState)
    applyServerSettings(data.profile.settings)
    state.sessions = data.sessions
    state.currentId = null
    serverReady = true
    render()
    autoResizeInput()
  } catch (e) {
    if (serverAuth) showToast(e.message)
  }
}
async function authenticate(path) {
  const username = $("authUsername").value.trim()
  const password = $("authPassword").value
  if (!username || !password) return showAlert("请输入用户名和密码")
  const data = await RelayServerStorage.authenticate(path, username, password)
  saveServerAuth({ token: data.token, user: data.user })
  hideGates()
  await loadServerHome()
  await maybeOfferLocalUpload(data.shouldOfferLocalUpload)
}
async function registerAccount() {
  const username = $("authUsername").value.trim()
  const password = $("authPassword").value
  const confirmPassword = $("authPasswordConfirm").value
  const registrationCode = $("authRegistrationCode").value.trim()
  if (!username || !password || !confirmPassword)
    return showAlert("请输入用户名和两次密码")
  if (password !== confirmPassword) return showAlert("两次输入的密码不一致")
  await RelayServerStorage.authenticate("/api/register", username, password, {
    registrationCode,
  })
  await showAlert("注册完成，请登录")
  renderLoginView()
}
async function maybeOfferLocalUpload(shouldOffer) {
  if (!shouldOffer || !hasLocalData()) {
    if (shouldOffer)
      await RelayServerStorage.skipImport(serverAuth, handleTokenExpired)
    return
  }
  if (!(await showConfirm("是否将当前浏览器里的本地数据上传到服务器账号？"))) {
    await RelayServerStorage.skipImport(serverAuth, handleTokenExpired)
    return
  }
  const localState = loadLocal()
  await RelayServerStorage.importLocal(
    serverAuth,
    handleTokenExpired,
    localState,
  )
  showToast("本地数据已上传到服务器")
  if (await showConfirm("上传成功，是否删除当前浏览器里的本地数据？"))
    clearLocalData()
  await loadServerHome()
}
async function saveServerSettings(patch = null) {
  if (!isServerMode() || !serverReady || !serverAuth?.token) return
  try {
    await RelayServerStorage.saveSettings(
      serverAuth,
      handleTokenExpired,
      state,
      patch,
    )
  } catch (e) {
    console.warn("保存服务器设置失败", e)
  }
}
async function selectSession(id) {
  if (state.currentId !== id) cancelTitleGeneration()
  state.currentId = id
  closeSidebar()
  closeSessionMenus()
  if (isServerMode()) {
    const s = current()
    if (s && !s.messagesLoaded) {
      try {
        s.messages = await RelayServerStorage.loadMessages(
          serverAuth,
          handleTokenExpired,
          id,
        )
        s.messagesLoaded = true
      } catch (e) {
        showToast(e.message)
      }
    }
  } else {
    saveState()
  }
  render()
}
async function createServerSessionFromText(text) {
  const title = text.slice(0, 24).replace(/\s+/g, " ") || "新会话"
  const session = await RelayServerStorage.createSession(
    serverAuth,
    handleTokenExpired,
    title,
  )
  state.sessions.unshift(session)
  state.currentId = session.id
  return session
}
async function saveServerMessage(session, message) {
  if (!isServerMode() || !session?.id || session.isTemporary) return null
  try {
    return await RelayServerStorage.createMessage(
      serverAuth,
      handleTokenExpired,
      session,
      message,
    )
  } catch (e) {
    showToast("保存消息失败：" + e.message)
    return null
  }
}
async function updateServerSession(session) {
  if (!isServerMode() || !session?.id || session.isTemporary) return
  try {
    await RelayServerStorage.updateSession(
      serverAuth,
      handleTokenExpired,
      session,
    )
  } catch (e) {
    showToast("保存会话失败：" + e.message)
  }
}
function cancelTitleGeneration(sessionId = null) {
  if (!titleAbort) return
  if (sessionId && titleAbortSessionId !== sessionId) return
  titleAbort.abort()
  titleAbort = null
  titleAbortSessionId = null
}
function ensureSession() {
  if (isServerMode()) return
  if (!state.sessions.length) newSession()
  if (!state.currentId) state.currentId = state.sessions[0].id
}
function isBlankSession(s) {
  return (
    !!s &&
    (!s.messages || s.messages.length === 0) &&
    (!s.title || s.title === "新会话") &&
    (!s.titleSource || s.titleSource === "default")
  )
}
function newSession() {
  cancelTitleGeneration()
  closeSidebar()
  if (isServerMode()) {
    state.currentId = null
    render()
    return
  }
  const cur = current()
  if (isBlankSession(cur)) {
    render()
    return
  }
  const existing = state.sessions.find(isBlankSession)
  if (existing) {
    state.currentId = existing.id
    saveState()
    render()
    return
  }
  const s = {
    id: uid(),
    title: "新会话",
    titleSource: "default",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  }
  state.sessions.unshift(s)
  state.currentId = s.id
  saveState()
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
  $("maxTokens").value = s.maxTokens ?? ""
  $("historyCount").value = s.historyCount ?? "6"
  $("systemPrompt").value = s.systemPrompt || ""
  renderSavedBaseUrls()
  renderModels()
}
function normalizeApiCredentials(credentials) {
  const out = {}
  for (const [url, token] of Object.entries(credentials || {})) {
    const cleanUrl = String(url || "").trim()
    if (cleanUrl) out[cleanUrl] = String(token || "")
  }
  return out
}
function rememberCredential(baseUrl, token) {
  state.settings.apiCredentials = normalizeApiCredentials(
    state.settings.apiCredentials,
  )
  if (baseUrl) state.settings.apiCredentials[baseUrl] = token
}
function apiSettingsFromUI() {
  return {
    baseUrl: $("baseUrl").value.trim(),
    token: $("token").value.trim(),
  }
}
function browserSettingsFromUI() {
  return {
    theme: $("theme").value,
    thinking: $("thinking").checked,
    maxTokens: $("maxTokens").value,
    historyCount: $("historyCount").value,
    systemPrompt: $("systemPrompt").value,
  }
}
function modeSettingsFromUI({ includeApi = false } = {}) {
  const model =
    $("settingsModel").value.trim() ||
    $("model").value.trim() ||
    state.settings.model
  const next = {
    protocol: $("protocol").value,
    model,
  }
  if (includeApi) {
    const api = apiSettingsFromUI()
    Object.assign(next, api)
    rememberCredential(api.baseUrl, api.token)
  }
  return next
}
function syncBrowserSettingsFromUI() {
  Object.assign(state.settings, browserSettingsFromUI())
  saveBrowser()
  applyTheme()
}
function syncModeSettingsFromUI({
  includeApi = false,
  saveServer = false,
} = {}) {
  const next = modeSettingsFromUI({ includeApi })
  Object.assign(state.settings, next)
  rememberModel(state.settings.model)
  saveMode()
  if (saveServer) saveServerSettings()
}
function syncSettingsFromUI(options = {}) {
  syncBrowserSettingsFromUI()
  syncModeSettingsFromUI(options)
}
function renderSavedBaseUrls() {
  const menu = $("savedBaseUrlMenu")
  if (!menu) return
  menu.innerHTML = ""
  const credentials = normalizeApiCredentials(state.settings.apiCredentials)
  const urls = Object.keys(credentials).sort()
  if (!urls.length) {
    const empty = document.createElement("div")
    empty.className = "url-combo-empty"
    empty.textContent = "暂无已保存 URL"
    menu.appendChild(empty)
    return
  }
  for (const url of urls) {
    const item = document.createElement("button")
    item.type = "button"
    item.className = "url-combo-item"
    item.textContent = url
    item.onclick = () => {
      $("baseUrl").value = url
      $("token").value = credentials[url] || ""
      menu.classList.add("hidden")
    }
    menu.appendChild(item)
  }
}
function closeSavedBaseUrlMenu() {
  const menu = $("savedBaseUrlMenu")
  if (menu) menu.classList.add("hidden")
}
function normalizeModels(models) {
  const out = []
  const seen = new Set()
  for (const model of models || []) {
    const id = String(model?.id || model?.name || "").trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ ...model, id, name: model.name || id })
  }
  return out
}
function rememberModel(model) {
  const id = String(model || "").trim()
  if (!id) return
  const models = normalizeModels(state.settings.models)
  if (!models.some((item) => item.id === id)) models.push({ id, name: id })
  state.settings.models = models
}
function renderModels() {
  $("model").value = state.settings.model || ""
  $("settingsModel").value = state.settings.model || ""
  renderModelOptions("modelOptionsMenu")
  renderModelOptions("settingsModelOptionsMenu")
}
function renderModelOptions(menuId) {
  const menu = $(menuId)
  if (!menu) return
  menu.innerHTML = ""
  const models = normalizeModels(state.settings.models)
  if (!models.length) {
    const empty = document.createElement("div")
    empty.className = "model-combo-empty"
    empty.textContent = "暂无已保存模型"
    menu.appendChild(empty)
    return
  }
  for (const model of models) {
    const item = document.createElement("button")
    item.type = "button"
    item.className = "model-combo-item"
    item.textContent = model.name || model.id
    item.title = model.id
    item.onclick = () => {
      setModel(model.id, true)
      closeModelOptionsMenus()
    }
    menu.appendChild(item)
  }
}
function closeModelOptionsMenus() {
  $("modelOptionsMenu").classList.add("hidden")
  $("settingsModelOptionsMenu").classList.add("hidden")
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
async function renameSession(id) {
  const s = state.sessions.find((x) => x.id === id)
  if (!s) return
  const title = await showPrompt("重命名会话", s.title || "新会话")
  if (title === null) return
  const next = title.trim()
  if (!next) return
  cancelTitleGeneration(id)
  s.title = next
  s.titleSource = "user"
  s.updatedAt = Date.now()
  saveState()
  await updateServerSession(s)
  renderSessions()
}
async function deleteSession(id) {
  const s = state.sessions.find((x) => x.id === id)
  if (!s || !(await showConfirm("删除该会话？"))) return
  cancelTitleGeneration(id)
  if (isServerMode()) {
    try {
      await RelayServerStorage.deleteSession(serverAuth, handleTokenExpired, id)
    } catch (e) {
      return showToast("删除失败：" + e.message)
    }
  }
  state.sessions = state.sessions.filter((x) => x.id !== id)
  if (state.currentId === id)
    state.currentId = isServerMode() ? null : state.sessions[0]?.id || null
  saveState()
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
    item.onclick = () => selectSession(s.id)
    item.append(name, more, menu)
    $("sessions").appendChild(item)
  }
}
function renderMessages() {
  const box = $("messages")
  box.innerHTML = ""
  if (isServerMode() && !serverReady) {
    document.querySelector(".main").classList.add("empty-chat")
    if (!serverAuth?.token) renderAuthGate()
    return
  }
  const s = current()
  const empty = !s || !s.messages.length
  document.querySelector(".main").classList.toggle("empty-chat", empty)
  if (empty) {
    const p = document.createElement("div")
    p.className = "muted"
    p.textContent = isServerMode()
      ? "已登录，发送第一条消息后会同步到账号。"
      : "开始一个新问题，数据只会保存在本地浏览器。"
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
  renderAccountStatus()
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
  const api = apiSettingsFromUI()
  if (!api.baseUrl || !api.token) return showAlert("请先填写 API URL 和 Token")
  $("loadModels").disabled = true
  $("loadModels").textContent = "获取中..."
  try {
    const requestSettings = { ...state.settings, ...api }
    const r = await fetch("/api/models", {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify(apiSettings(requestSettings)),
    })
    const data = await r.json().catch(() => ({}))
    if (r.status === 401) await handleProxyUnauthorized()
    if (r.status === 429) throw new Error("尝试过于频繁，请稍后再试")
    if (!r.ok) throw new Error(data.detail || r.statusText)
    syncSettingsFromUI({ includeApi: true })
    state.settings.models = data.models || []
    const hasCurrent = state.settings.models.some(
      (m) => m.id === state.settings.model,
    )
    if ((!state.settings.model || !hasCurrent) && state.settings.models[0]) {
      state.settings.model = state.settings.models[0].id
      applyProtocolForModel(state.settings.model)
    }
    saveMode()
    await saveServerSettings()
    renderModels()
    renderModelLabel()
    showToast(`获取模型成功，已保存（${state.settings.models.length} 个模型）`)
  } catch (e) {
    await showAlert("获取模型失败：" + e.message)
  } finally {
    $("loadModels").disabled = false
    $("loadModels").textContent = "获取模型"
  }
}

function requestMessages(session) {
  const msgs = []
  if (state.settings.systemPrompt.trim())
    msgs.push({ role: "system", content: state.settings.systemPrompt.trim() })
  for (const m of selectedHistoryMessages(session))
    msgs.push({ role: m.role, content: m.content || "" })
  return msgs
}
function isStoppedMessage(message) {
  return String(message?.content || "").includes("已停止生成")
}
function selectedHistoryMessages(session) {
  const messages = session.messages || []
  const raw = String(state.settings.historyCount ?? "").trim()
  const limit = Math.max(0, Number(raw) || 0)
  if (limit === 0) return messages
  const tail = []
  let completePairs = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const assistant = messages[i]
    const user = messages[i - 1]
    if (
      assistant?.role === "assistant" &&
      assistant.content &&
      !isStoppedMessage(assistant) &&
      user?.role === "user"
    ) {
      if (completePairs < limit) {
        tail.unshift(user, assistant)
        completePairs += 1
      }
      i -= 1
      continue
    }
    if (i === messages.length - 1 && assistant?.role === "user") {
      tail.unshift(assistant)
    }
  }
  return tail
}
function apiSettings(settings = state.settings) {
  return {
    protocol: settings.protocol,
    baseUrl: settings.baseUrl,
    token: settings.token,
    model: settings.model,
    thinking: settings.thinking,
  }
}
function titleCanBeAutoGenerated(session) {
  return (
    !!session &&
    (!session.titleSource || session.titleSource === "default") &&
    (session.messages || []).some((m) => m.role === "user") &&
    (session.messages || []).some((m) => m.role === "assistant" && m.content)
  )
}
function normalizeGeneratedTitle(text) {
  return String(text || "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^标题[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 28)
}
async function readChatStreamText(resp) {
  if (!resp.ok || !resp.body) throw new Error(await resp.text())
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let text = ""
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
      if (ev.type === "content") text += ev.delta
      else if (ev.type === "error")
        throw new Error(
          typeof ev.error === "string" ? ev.error : JSON.stringify(ev.error),
        )
    }
  }
  return text
}
async function generateSessionTitle(sessionId) {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!titleCanBeAutoGenerated(session)) return
  cancelTitleGeneration()

  const firstUser = session.messages.find((m) => m.role === "user")
  const firstAssistant = session.messages.find(
    (m) => m.role === "assistant" && m.content,
  )
  const sourceMessages = [firstUser, firstAssistant]
    .filter(Boolean)
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").slice(0, 1200),
    }))

  const controller = new AbortController()
  titleAbort = controller
  titleAbortSessionId = sessionId
  const timeout = setTimeout(
    () => controller.abort(),
    TITLE_GENERATION_TIMEOUT_MS,
  )

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify({
        ...apiSettings(),
        thinking: false,
        messages: [
          {
            role: "system",
            content:
              "你是会话标题生成器。根据对话内容生成一个简短中文标题。只输出标题，不要解释，不要引号，不要句号，最多12个汉字。",
          },
          ...sourceMessages,
        ],
      }),
      signal: controller.signal,
    })
    if (resp.status === 401) await handleProxyUnauthorized()
    if (resp.status === 429) throw new Error("尝试过于频繁，请稍后再试")
    const title = normalizeGeneratedTitle(await readChatStreamText(resp))
    const latest = state.sessions.find((s) => s.id === sessionId)
    if (!title || !titleCanBeAutoGenerated(latest)) return
    latest.title = title
    latest.titleSource = "model"
    latest.updatedAt = Date.now()
    saveState()
    await updateServerSession(latest)
    renderSessions()
  } catch (e) {
    if (e.name === "AbortError") return
    console.warn("生成会话标题失败", e)
  } finally {
    clearTimeout(timeout)
    if (titleAbort === controller) {
      titleAbort = null
      titleAbortSessionId = null
    }
  }
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
  if (isServerMode() && !serverReady) return renderAuthGate()
  cancelTitleGeneration()
  syncSettingsFromUI()
  if (!state.settings.baseUrl || !state.settings.token || !state.settings.model)
    return showAlert("请先配置 URL、Token 并选择模型")
  let s = current()
  if (isServerMode() && !s) {
    try {
      s = await createServerSessionFromText(text)
    } catch (e) {
      return showToast("创建服务器会话失败：" + e.message)
    }
  }
  if (!s) {
    newSession()
    s = current()
  }
  if (!s.messagesLoaded && isServerMode()) s.messagesLoaded = true
  const userMessage = { role: "user", content: text, thinking: "" }
  s.messages.push(userMessage)
  const payloadMessages = requestMessages(s)
  if (!s.title || s.title === "新会话") {
    s.title = text.slice(0, 24).replace(/\s+/g, " ") || "新会话"
    s.titleSource = "default"
  }
  const assistant = { role: "assistant", content: "", thinking: "" }
  s.messages.push(assistant)
  s.updatedAt = Date.now()
  saveState()
  await saveServerMessage(s, userMessage)
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
      ...apiSettings(),
      messages: payloadMessages,
      max_tokens:
        state.settings.maxTokens === ""
          ? null
          : Number(state.settings.maxTokens),
    }
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: proxyHeaders(),
      body: JSON.stringify(payload),
      signal: currentAbort.signal,
    })
    if (resp.status === 401) await handleProxyUnauthorized()
    if (resp.status === 429) throw new Error("尝试过于频繁，请稍后再试")
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
    const wasStopped = generationStopped
    currentAbort = null
    generationStopped = false
    setSendingUI(false)
    s.updatedAt = Date.now()
    saveState()
    if (assistant.content || assistant.thinking)
      await saveServerMessage(s, assistant)
    renderSessions()
    if (!wasStopped && assistant.content) generateSessionTitle(s.id)
  }
}

$("newChat").onclick = newSession
$("deleteChat").onclick = async () => {
  const s = current()
  if (!s) return
  closeMenu()
  await deleteSession(s.id)
}
$("deleteAllChats").onclick = async () => {
  if (
    !state.sessions.length ||
    !(await showConfirm("删除全部会话？此操作不可恢复。"))
  )
    return
  cancelTitleGeneration()
  if (isServerMode()) {
    for (const s of [...state.sessions]) {
      try {
        await RelayServerStorage.deleteSession(
          serverAuth,
          handleTokenExpired,
          s.id,
        )
      } catch (e) {
        return showToast("删除失败：" + e.message)
      }
    }
  }
  state.sessions = []
  state.currentId = null
  closeMenu()
  saveState()
  render()
}
$("saveSettings").onclick = () => {
  syncSettingsFromUI({ includeApi: true, saveServer: true })
  showToast(isServerMode() ? "设置已保存到服务器" : "设置已保存到浏览器本地")
}
$("loadModels").onclick = loadModels
$("savedBaseUrlToggle").onclick = (e) => {
  e.stopPropagation()
  renderSavedBaseUrls()
  $("savedBaseUrlMenu").classList.toggle("hidden")
}
$("savedBaseUrlMenu").onclick = (e) => e.stopPropagation()
$("deleteSavedBaseUrl").onclick = async () => {
  const url = $("baseUrl").value.trim()
  if (!url) return showAlert("请选择要删除的 URL")
  if (!(await showConfirm(`删除已保存的 URL？\n${url}`))) return
  state.settings.apiCredentials = normalizeApiCredentials(
    state.settings.apiCredentials,
  )
  delete state.settings.apiCredentials[url]
  if ($("baseUrl").value.trim() === url) {
    $("baseUrl").value = ""
    $("token").value = ""
    state.settings.baseUrl = ""
    state.settings.token = ""
  }
  saveMode()
  await saveServerSettings()
  renderSavedBaseUrls()
  closeSavedBaseUrlMenu()
  showToast("已删除保存的 URL")
}
function setModel(value, infer = true) {
  const next = String(value || "").trim()
  if (!next) {
    $("model").value = state.settings.model || ""
    $("settingsModel").value = state.settings.model || ""
    return
  }
  state.settings.model = next
  rememberModel(next)
  if (infer) applyProtocolForModel(state.settings.model)
  $("model").value = state.settings.model
  $("settingsModel").value = state.settings.model
  saveMode()
  saveServerSettings({
    model: state.settings.model,
    protocol: state.settings.protocol,
    models: state.settings.models,
  })
  renderModels()
  renderModelLabel()
}
function saveModelInput(inputId) {
  setModel($(inputId).value, true)
}
$("model").addEventListener("blur", () => saveModelInput("model"))
$("settingsModel").addEventListener("blur", () =>
  saveModelInput("settingsModel"),
)
for (const id of ["model", "settingsModel"]) {
  $(id).addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    $(id).blur()
  })
}
$("modelToggle").onclick = (e) => {
  e.stopPropagation()
  renderModelOptions("modelOptionsMenu")
  $("modelOptionsMenu").classList.toggle("hidden")
}
$("settingsModelToggle").onclick = (e) => {
  e.stopPropagation()
  renderModelOptions("settingsModelOptionsMenu")
  $("settingsModelOptionsMenu").classList.toggle("hidden")
}
$("modelOptionsMenu").onclick = (e) => e.stopPropagation()
$("settingsModelOptionsMenu").onclick = (e) => e.stopPropagation()
$("settingsProtocol").onchange = () => {
  state.settings.protocol = $("settingsProtocol").value
  $("protocol").value = state.settings.protocol
  saveMode()
  saveServerSettings({ protocol: state.settings.protocol })
  renderModelLabel()
}
async function logoutAccount() {
  if (isServerMode() && serverAuth?.token) {
    try {
      await RelayServerStorage.logout(serverAuth)
    } catch {}
  }
  saveServerAuth(null)
  serverReady = true
  state = loadLocal()
  hideGates()
  closeMenu()
  await requireLocalAccess()
  render()
  autoResizeInput()
}
async function openLogin() {
  closeMenu()
  renderAuthGate()
}
async function changePassword() {
  const values = await showFormModal({
    title: "修改密码",
    fields: [
      { name: "currentPassword", label: "当前密码", type: "password" },
      { name: "newPassword", label: "新密码", type: "password" },
      { name: "confirmPassword", label: "确认新密码", type: "password" },
    ],
    confirmText: "保存",
  })
  if (!values) return
  const currentPassword = values.currentPassword || ""
  const newPassword = values.newPassword || ""
  if (!currentPassword || !newPassword || !values.confirmPassword)
    return showAlert("请输入当前密码和两次新密码")
  if (newPassword !== values.confirmPassword)
    return showAlert("两次输入的新密码不一致")
  await RelayServerStorage.changePassword(serverAuth, handleTokenExpired, {
    currentPassword,
    newPassword,
  })
  await showAlert("密码已修改")
}
async function resetPassword() {
  const values = await showFormModal({
    title: "重置用户密码",
    fields: [
      { name: "username", label: "用户名", autocomplete: "username" },
      { name: "newPassword", label: "新密码", type: "password" },
      { name: "confirmPassword", label: "确认新密码", type: "password" },
    ],
    confirmText: "重置",
  })
  if (!values) return
  const username = (values.username || "").trim()
  const newPassword = values.newPassword || ""
  if (!username || !newPassword || !values.confirmPassword)
    return showAlert("请输入用户名和两次新密码")
  if (newPassword !== values.confirmPassword)
    return showAlert("两次输入的新密码不一致")
  await RelayServerStorage.changePassword(serverAuth, handleTokenExpired, {
    username,
    newPassword,
  })
  await showAlert("密码已重置")
}
$("openLogin").onclick = openLogin
$("logoutAccount").onclick = logoutAccount
$("changePassword").onclick = () =>
  changePassword().catch((e) => showAlert("修改密码失败：" + e.message))
$("resetPassword").onclick = () =>
  resetPassword().catch((e) => showAlert("重置密码失败：" + e.message))
$("cancelLogin").onclick = () => {
  requireLocalAccess().then((ok) => {
    if (ok) hideGates()
  })
}
$("loginButton").onclick = () =>
  authenticate("/api/login").catch((e) => showAlert("登录失败：" + e.message))
$("registerButton").onclick = renderRegisterView
$("backToLoginButton").onclick = renderLoginView
$("submitRegisterButton").onclick = () =>
  registerAccount().catch((e) => showAlert("注册失败：" + e.message))
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
$("messages").addEventListener("wheel", markUserScrollIntent, {
  passive: true,
})
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
  if (!$("appMenu").classList.contains("hidden")) syncSettingsToUI()
  $("appMenu").classList.add("hidden")
}
function openSidebar() {
  document.body.classList.add("sidebar-open")
}
function closeSidebar() {
  document.body.classList.remove("sidebar-open")
}
function toggleMenu() {
  const willOpen = $("appMenu").classList.contains("hidden")
  if (willOpen) syncSettingsToUI()
  $("appMenu").classList.toggle("hidden")
  $("modelMenu").classList.add("hidden")
  closeModelOptionsMenus()
}
function closeModelMenu() {
  $("modelMenu").classList.add("hidden")
  closeModelOptionsMenus()
}
function toggleModelMenu() {
  $("modelMenu").classList.toggle("hidden")
  $("appMenu").classList.add("hidden")
  closeModelOptionsMenus()
}
function isPopoverTarget(target) {
  return !!target.closest(
    "#appMenu, #modelMenu, #savedBaseUrlMenu, #modelOptionsMenu, #settingsModelOptionsMenu, .session-menu",
  )
}
function closePopovers(e) {
  if (popoverPointerStartedInside) {
    popoverPointerStartedInside = false
    return
  }
  if (e?.target && isPopoverTarget(e.target)) return
  closeMenu()
  closeModelMenu()
  closeSessionMenus()
  closeSavedBaseUrlMenu()
  closeModelOptionsMenus()
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
$("sidebarToggle").onclick = (e) => {
  e.stopPropagation()
  openSidebar()
}
$("sidebarClose").onclick = closeSidebar
$("sidebarOverlay").onclick = closeSidebar
document.addEventListener(
  "pointerdown",
  (e) => {
    popoverPointerStartedInside = isPopoverTarget(e.target)
  },
  true,
)
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
  saveMode()
  saveServerSettings({ protocol: state.settings.protocol })
  renderModelLabel()
})
for (const id of [
  "theme",
  "thinking",
  "maxTokens",
  "systemPrompt",
])
  $(id).addEventListener("change", () => {
    syncBrowserSettingsFromUI()
    renderModelLabel()
  })
$("historyCount").addEventListener("change", () => {
  state.settings.historyCount = $("historyCount").value
  saveBrowser()
})
const colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)")
if (colorSchemeQuery.addEventListener)
  colorSchemeQuery.addEventListener("change", applyTheme)
else colorSchemeQuery.addListener(applyTheme)
applyTheme()
async function boot() {
  if (isServerMode() && serverAuth?.token) await loadServerHome()
  else {
    await requireLocalAccess()
    render()
  }
  autoResizeInput()
}
boot().catch((e) => showAlert("启动失败：" + e.message))
