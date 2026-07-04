const RelayLocalStorage = (() => {
  const LOCAL_STATE_KEY = "relaychat-state-v1"

  function load(defaultState) {
    try {
      const loaded = {
        ...structuredClone(defaultState),
        ...(JSON.parse(localStorage.getItem(LOCAL_STATE_KEY)) || {}),
      }
      loaded.settings = {
        ...structuredClone(defaultState.settings),
        ...(loaded.settings || {}),
      }
      loaded.settings.apiCredentials = {
        ...(loaded.settings.apiCredentials || {}),
      }
      return loaded
    } catch {
      return structuredClone(defaultState)
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
