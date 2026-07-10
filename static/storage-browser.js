const RelayBrowserSettings = (() => {
  const BROWSER_SETTINGS_KEY = "relaychat-browser-settings-v1";

  function load(defaultSettings) {
    try {
      return {
        ...structuredClone(defaultSettings),
        ...(JSON.parse(localStorage.getItem(BROWSER_SETTINGS_KEY)) || {}),
      };
    } catch {
      return structuredClone(defaultSettings);
    }
  }

  function save(settings) {
    localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(settings));
  }

  return {
    load,
    save,
  };
})();
