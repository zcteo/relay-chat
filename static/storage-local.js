const RelayLocalStorage = (() => {
  const LOCAL_STATE_KEY = "relaychat-local-state-v1"

  function load(defaultModeState) {
    try {
      const loaded = {
        ...structuredClone(defaultModeState),
        ...(JSON.parse(localStorage.getItem(LOCAL_STATE_KEY)) || {}),
      }
      loaded.settings = {
        ...structuredClone(defaultModeState.settings),
        ...(loaded.settings || {}),
      }
      loaded.settings.apiCredentials = {
        ...(loaded.settings.apiCredentials || {}),
      }
      return loaded
    } catch {
      return structuredClone(defaultModeState)
    }
  }

  function save(state) {
    localStorage.setItem(LOCAL_STATE_KEY, JSON.stringify(state))
  }

  function hasData() {
    try {
      const data = JSON.parse(localStorage.getItem(LOCAL_STATE_KEY) || "{}")
      return (
        !!data.settings?.baseUrl ||
        !!data.settings?.token ||
        !!Object.keys(data.settings?.apiCredentials || {}).length ||
        !!data.settings?.model ||
        !!(data.sessions || []).length
      )
    } catch {
      return false
    }
  }

  function clear() {
    localStorage.removeItem(LOCAL_STATE_KEY)
  }

  return {
    load,
    save,
    hasData,
    clear,
  }
})()
