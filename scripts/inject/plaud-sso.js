(() => {
  const hostname = window.location?.hostname;
  const userAgent = window.navigator?.userAgent || "";
  const isPlaudWeb = hostname === "web.plaud.ai";
  const isMac = /macintosh|mac os x/i.test(userAgent);
  const isPake = Boolean(window.pakeConfig || window.__TAURI__);

  if (!isPlaudWeb || !isMac || !isPake) {
    return;
  }

  // event.js uses this as a narrow allow-list for PLAUD's Google Identity
  // Services button popup. The shim below preserves PLAUD's callback-based
  // ux_mode:"popup" flow while disabling the GIS options that were associated
  // with macOS WebKit's SOAuthorization popup crash path.
  window.__PAKE_PLAUD_GOOGLE_GIS_POPUP_SAFE__ = true;

  const hookedGoogleObjects = new WeakSet();
  const hookedAccountObjects = new WeakSet();
  const patchedIdObjects = new WeakSet();

  function watchProperty(target, property, onValue) {
    if (
      !target ||
      (typeof target !== "object" && typeof target !== "function")
    ) {
      return;
    }

    const descriptor = Object.getOwnPropertyDescriptor(target, property);
    if (descriptor?.configurable === false) {
      onValue(target[property]);
      return;
    }

    let value =
      descriptor && "value" in descriptor ? descriptor.value : undefined;
    const originalGet = descriptor?.get;
    const originalSet = descriptor?.set;

    try {
      Object.defineProperty(target, property, {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get() {
          return originalGet ? originalGet.call(target) : value;
        },
        set(nextValue) {
          if (originalSet) {
            originalSet.call(target, nextValue);
          } else {
            value = nextValue;
          }

          onValue(nextValue);
        },
      });
    } catch (_) {
      onValue(target[property]);
      return;
    }

    onValue(originalGet ? originalGet.call(target) : value);
  }

  function getSuppressedPromptNotification() {
    return {
      getDismissedReason: () => "",
      getMomentType: () => "skipped",
      getNotDisplayedReason: () => "suppressed_by_pake",
      getSkippedReason: () => "suppressed_by_pake",
      isDismissedMoment: () => false,
      isDisplayMoment: () => false,
      isDisplayed: () => false,
      isNotDisplayed: () => true,
      isSkippedMoment: () => true,
    };
  }

  function patchGoogleId(id) {
    if (!id || (typeof id !== "object" && typeof id !== "function")) {
      return;
    }

    if (patchedIdObjects.has(id)) {
      return;
    }
    patchedIdObjects.add(id);

    const originalInitialize = id.initialize;
    if (typeof originalInitialize === "function") {
      try {
        id.initialize = function initializeWithPakePlaudOptions(config = {}) {
          return originalInitialize.call(this, {
            ...config,
            itp_support: false,
            use_fedcm_for_button: false,
            use_fedcm_for_prompt: false,
          });
        };
      } catch (_) {}
    }

    const originalPrompt = id.prompt;
    if (typeof originalPrompt === "function") {
      try {
        id.prompt = function suppressPakePlaudOneTap(callback) {
          if (typeof callback === "function") {
            callback(getSuppressedPromptNotification());
          }
          return undefined;
        };
      } catch (_) {}
    }
  }

  function patchGoogleAccounts(accounts) {
    if (
      !accounts ||
      (typeof accounts !== "object" && typeof accounts !== "function")
    ) {
      return;
    }

    if (!hookedAccountObjects.has(accounts)) {
      hookedAccountObjects.add(accounts);
      watchProperty(accounts, "id", patchGoogleId);
    }

    patchGoogleId(accounts.id);
  }

  function patchGoogle(google) {
    if (
      !google ||
      (typeof google !== "object" && typeof google !== "function")
    ) {
      return;
    }

    if (!hookedGoogleObjects.has(google)) {
      hookedGoogleObjects.add(google);
      watchProperty(google, "accounts", patchGoogleAccounts);
    }

    patchGoogleAccounts(google.accounts);
  }

  watchProperty(window, "google", patchGoogle);
  patchGoogle(window.google);
})();
