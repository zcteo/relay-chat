const RelayAuth = (() => {
  const SERVER_AUTH_KEY = "relaychat-server-auth-v1"
  const ACCESS_CODE_KEY = "relaychat-access-code-v1"

  function loadServerAuth() {
    try {
      const data = JSON.parse(localStorage.getItem(SERVER_AUTH_KEY) || "{}")
      if (data.token) return data
    } catch {}
    return null
  }

  function saveServerAuth(auth) {
    if (auth) localStorage.setItem(SERVER_AUTH_KEY, JSON.stringify(auth))
    else localStorage.removeItem(SERVER_AUTH_KEY)
  }

  function loadAccessCode() {
    return localStorage.getItem(ACCESS_CODE_KEY) || ""
  }

  function saveAccessCode(code) {
    const next = String(code || "").trim()
    if (next) localStorage.setItem(ACCESS_CODE_KEY, next)
    else localStorage.removeItem(ACCESS_CODE_KEY)
  }

  function clearAccessCode() {
    localStorage.removeItem(ACCESS_CODE_KEY)
  }

  return {
    loadServerAuth,
    saveServerAuth,
    loadAccessCode,
    saveAccessCode,
    clearAccessCode,
  }
})()
