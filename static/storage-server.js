const RelayServerStorage = (() => {
  async function readJsonResponse(resp) {
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.detail || data.error || resp.statusText);
    return data;
  }

  async function request(auth, onExpired, url, options = {}) {
    const headers = {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${auth?.token || ""}`,
      ...(options.headers || {}),
    };
    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 401) {
      onExpired();
      throw new Error("登录已过期，请重新登录");
    }
    return resp;
  }

  function settingsPayload(state) {
    return {
      baseUrl: state.settings.baseUrl || "",
      token: state.settings.token || "",
      apiCredentials: state.settings.apiCredentials || {},
      model: state.settings.model || "",
      protocol: state.settings.protocol || "openai_responses",
      models: state.settings.models || [],
    };
  }

  function normalizeSession(session) {
    return {
      id: session.id,
      title: session.title || "新会话",
      titleSource: session.titleSource || "default",
      createdAt: session.createdAt || Date.now(),
      updatedAt: session.updatedAt || session.createdAt || Date.now(),
      messageCount: session.messageCount || 0,
      messages: session.messages || [],
      messagesLoaded: !!session.messages,
    };
  }

  function normalizeMessage(message) {
    return {
      id: message.id,
      role: message.role,
      content: message.content || "",
      thinking: message.thinking || "",
      createdAt: message.createdAt || Date.now(),
      sortOrder: message.sortOrder || 0,
    };
  }

  async function loadHome(auth, onExpired) {
    const [profileResp, sessionsResp] = await Promise.all([
      request(auth, onExpired, "/api/profile"),
      request(auth, onExpired, "/api/sessions"),
    ]);
    const profile = await readJsonResponse(profileResp);
    const sessionsData = await readJsonResponse(sessionsResp);
    return {
      profile,
      sessions: (sessionsData.sessions || []).map(normalizeSession),
    };
  }

  async function authenticate(path, username, password, extra = {}) {
    const resp = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, ...extra }),
    });
    return readJsonResponse(resp);
  }

  async function saveSettings(auth, onExpired, state, patch = null) {
    const resp = await request(auth, onExpired, "/api/settings", {
      method: patch ? "PATCH" : "PUT",
      body: JSON.stringify(patch || settingsPayload(state)),
    });
    return readJsonResponse(resp);
  }

  async function skipImport(auth, onExpired) {
    const resp = await request(auth, onExpired, "/api/import-local/skip", {
      method: "POST",
    });
    return readJsonResponse(resp);
  }

  async function importLocal(auth, onExpired, localState) {
    const resp = await request(auth, onExpired, "/api/import-local", {
      method: "POST",
      body: JSON.stringify({
        settings: {
          baseUrl: localState.settings.baseUrl || "",
          token: localState.settings.token || "",
          apiCredentials: localState.settings.apiCredentials || {},
          model: localState.settings.model || "",
          protocol: localState.settings.protocol || "openai_responses",
          models: localState.settings.models || [],
        },
        sessions: localState.sessions || [],
      }),
    });
    return readJsonResponse(resp);
  }

  async function loadMessages(auth, onExpired, sessionId) {
    const resp = await request(
      auth,
      onExpired,
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
    const data = await readJsonResponse(resp);
    return (data.messages || []).map(normalizeMessage);
  }

  async function createSession(auth, onExpired, title) {
    const resp = await request(auth, onExpired, "/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title, titleSource: "default" }),
    });
    const data = await readJsonResponse(resp);
    const session = normalizeSession({ ...data.session, messages: [] });
    session.messagesLoaded = true;
    return session;
  }

  async function updateSession(auth, onExpired, session) {
    const resp = await request(
      auth,
      onExpired,
      `/api/sessions/${encodeURIComponent(session.id)}`,
      {
        method: "PUT",
        body: JSON.stringify({
          title: session.title || "新会话",
          titleSource: session.titleSource || "default",
        }),
      },
    );
    return readJsonResponse(resp);
  }

  async function deleteSession(auth, onExpired, sessionId) {
    const resp = await request(
      auth,
      onExpired,
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
    return readJsonResponse(resp);
  }

  async function createMessage(auth, onExpired, session, message) {
    const resp = await request(
      auth,
      onExpired,
      `/api/sessions/${encodeURIComponent(session.id)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          role: message.role,
          content: message.content || "",
          thinking: message.thinking || "",
          sortOrder: session.messages.indexOf(message) + 1,
        }),
      },
    );
    const data = await readJsonResponse(resp);
    message.id = data.message?.id || message.id;
    return data.message;
  }

  async function changePassword(auth, onExpired, payload) {
    const resp = await request(auth, onExpired, "/api/password", {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    return readJsonResponse(resp);
  }

  async function logout(auth) {
    const resp = await fetch("/api/logout", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
    });
    if (resp.status === 401) return { ok: true };
    return readJsonResponse(resp);
  }

  return {
    loadHome,
    authenticate,
    saveSettings,
    skipImport,
    importLocal,
    loadMessages,
    createSession,
    updateSession,
    deleteSession,
    createMessage,
    changePassword,
    logout,
  };
})();
