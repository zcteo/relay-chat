const RelayAuth = (() => {
  const SERVER_AUTH_KEY = "relaychat-server-auth-v1";

  function loadServerAuth() {
    try {
      const data = JSON.parse(localStorage.getItem(SERVER_AUTH_KEY) || "{}");
      if (data.token) return data;
    } catch {}
    return null;
  }

  function saveServerAuth(auth) {
    if (auth) localStorage.setItem(SERVER_AUTH_KEY, JSON.stringify(auth));
    else localStorage.removeItem(SERVER_AUTH_KEY);
  }

  return {
    loadServerAuth,
    saveServerAuth,
  };
})();
