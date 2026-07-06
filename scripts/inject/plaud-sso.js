(() => {
  const hostname = window.location?.hostname;
  const userAgent = window.navigator?.userAgent || "";
  const appUrl = window.pakeConfig?.url || "";
  const isPlaudWeb = hostname === "web.plaud.ai";
  const isPlaudConfiguredApp = /^https:\/\/web\.plaud\.ai\/?/i.test(appUrl);
  const isMac = /macintosh|mac os x/i.test(userAgent);
  const isPake = Boolean(window.pakeConfig || window.__TAURI__);

  if (!(isPlaudWeb || isPlaudConfiguredApp) || !isMac || !isPake) {
    return;
  }

  const DIAG_STORAGE_KEY = "__pake_plaud_diag_v1";
  const RECOVERY_STORAGE_KEY = "__pake_plaud_blank_recovery_v1";
  const MAX_DIAG_ENTRIES = 80;

  function getTauriInvoke() {
    return window.__TAURI__?.core?.invoke;
  }

  function recordNativeDiag(entry) {
    try {
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        invoke("record_plaud_diag", { entry }).catch(() => {});
      }
    } catch (_) {}
  }

  function exportNativeDiag() {
    try {
      const invoke = getTauriInvoke();
      if (typeof invoke === "function") {
        return invoke("export_plaud_diag");
      }
    } catch (_) {}
    return Promise.resolve("");
  }

  function getSafeLocationParts(url = window.location?.href) {
    try {
      const parsedUrl = new URL(url, window.location?.href);
      return {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
        searchKeys: [...parsedUrl.searchParams.keys()].sort(),
      };
    } catch (_) {
      return {
        host: window.location?.hostname || "",
        path: window.location?.pathname || "",
        searchKeys: [],
      };
    }
  }

  function getTokenPresence() {
    try {
      return Boolean(window.localStorage?.getItem("pld_tokenstr"));
    } catch (_) {
      return false;
    }
  }

  function sanitizeDiagDetails(details = {}) {
    const safe = {};
    for (const [key, value] of Object.entries(details || {})) {
      if (/credential|token|password|secret|code/i.test(key)) {
        safe[key] = Boolean(value);
      } else if (value instanceof Error) {
        safe[key] = value.name || "Error";
      } else if (typeof value === "string") {
        safe[key] = value.slice(0, 200);
      } else if (
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        safe[key] = value;
      } else if (Array.isArray(value)) {
        safe[key] = value.slice(0, 20).map((item) => String(item).slice(0, 80));
      } else if (value && typeof value === "object") {
        safe[key] = sanitizeDiagDetails(value);
      }
    }
    return safe;
  }

  function readDiagEntries() {
    try {
      const raw = window.localStorage?.getItem(DIAG_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeDiagEntries(entries) {
    try {
      window.localStorage?.setItem(
        DIAG_STORAGE_KEY,
        JSON.stringify(entries.slice(-MAX_DIAG_ENTRIES)),
      );
    } catch (_) {}
  }

  function recordDiag(eventOrEntry, details = {}) {
    const event =
      typeof eventOrEntry === "string"
        ? eventOrEntry
        : eventOrEntry?.event || "event";
    const entryDetails =
      typeof eventOrEntry === "string" ? details : eventOrEntry?.details || {};
    const entry = {
      event,
      source:
        typeof eventOrEntry === "string"
          ? "plaud-sso.js"
          : eventOrEntry?.source || "event.js",
      timestamp: new Date().toISOString(),
      page: getSafeLocationParts(),
      tokenPresent: getTokenPresence(),
      details: sanitizeDiagDetails(entryDetails),
    };
    const entries = readDiagEntries();
    entries.push(entry);
    writeDiagEntries(entries);
    recordNativeDiag(entry);
    return entry;
  }

  const pendingDiagEntries = Array.isArray(window.__PAKE_PLAUD_DIAG_LOG)
    ? window.__PAKE_PLAUD_DIAG_LOG
    : [];
  window.__PAKE_PLAUD_DIAG_LOG = recordDiag;
  pendingDiagEntries.forEach((entry) => recordDiag(entry));

  function exportDiag() {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        page: getSafeLocationParts(),
        tokenPresent: getTokenPresence(),
        entries: readDiagEntries(),
      },
      null,
      2,
    );
  }

  window.__PAKE_PLAUD_EXPORT_DIAG__ = exportDiag;
  window.__PAKE_PLAUD_EXPORT_NATIVE_DIAG__ = exportNativeDiag;

  function showDiagOverlay(reason) {
    const doc = window.document;
    if (!doc?.body || doc.getElementById("pake-plaud-diag")) {
      return;
    }

    const panel = doc.createElement("div");
    panel.id = "pake-plaud-diag";
    panel.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(520px,calc(100vw - 32px));max-height:70vh;padding:12px;background:#111;color:#fff;border:1px solid #555;border-radius:8px;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.35);";

    const title = doc.createElement("div");
    title.textContent = `PLAUD Pake diagnostic: ${reason}`;
    title.style.cssText = "font-weight:600;margin-bottom:8px;";

    const textarea = doc.createElement("textarea");
    textarea.value = exportDiag();
    textarea.readOnly = true;
    textarea.style.cssText =
      "width:100%;height:180px;box-sizing:border-box;background:#000;color:#d6f5d6;border:1px solid #444;border-radius:6px;padding:8px;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;";

    const actions = doc.createElement("div");
    actions.style.cssText =
      "display:flex;gap:8px;justify-content:flex-end;margin-top:8px;";

    const copyButton = doc.createElement("button");
    copyButton.textContent = "Copy diagnostics";
    copyButton.style.cssText =
      "border:1px solid #777;border-radius:6px;background:#fff;color:#111;padding:6px 10px;cursor:pointer;";
    copyButton.onclick = () => {
      textarea.value = exportDiag();
      textarea.select();
      if (window.navigator?.clipboard?.writeText) {
        window.navigator.clipboard.writeText(textarea.value).catch(() => {});
      } else {
        doc.execCommand?.("copy");
      }
    };

    const closeButton = doc.createElement("button");
    closeButton.textContent = "Close";
    closeButton.style.cssText =
      "border:1px solid #777;border-radius:6px;background:#222;color:#fff;padding:6px 10px;cursor:pointer;";
    closeButton.onclick = () => panel.remove();

    actions.appendChild(copyButton);
    actions.appendChild(closeButton);
    panel.appendChild(title);
    panel.appendChild(textarea);
    panel.appendChild(actions);
    doc.body.appendChild(panel);
  }

  function isLikelyBlankScreen() {
    const doc = window.document;
    if (!doc?.body || doc.getElementById("pake-plaud-diag")) {
      return false;
    }

    const app = doc.getElementById("app");
    const bodyText = (doc.body.innerText || doc.body.textContent || "").trim();
    const interactiveCount = doc.body.querySelectorAll
      ? doc.body.querySelectorAll(
          "a,button,input,textarea,select,[role='button'],canvas,img,svg,video",
        ).length
      : 0;
    const appChildCount = app?.children?.length || 0;

    return bodyText.length < 20 && interactiveCount < 2 && appChildCount === 0;
  }

  function hasAttemptedBlankRecovery() {
    try {
      return window.sessionStorage?.getItem(RECOVERY_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function markBlankRecoveryAttempted() {
    try {
      window.sessionStorage?.setItem(RECOVERY_STORAGE_KEY, "1");
    } catch (_) {}
  }

  function replaceLocation(url) {
    try {
      if (typeof window.location?.replace === "function") {
        window.location.replace(url);
      } else {
        window.location.href = url;
      }
    } catch (_) {
      window.location.href = url;
    }
  }

  function tryRecoverBlankScreen(reason) {
    if (
      !isPlaudWeb ||
      hasAttemptedBlankRecovery() ||
      !getTokenPresence() ||
      !isLikelyBlankScreen()
    ) {
      return false;
    }

    markBlankRecoveryAttempted();
    recordDiag("blank_recovery_reload", {
      reason,
      target: { host: "web.plaud.ai", path: "/" },
    });
    replaceLocation("https://web.plaud.ai/");
    return true;
  }

  function scheduleBlankScreenCheck(reason, delay = 3500) {
    const schedule = window.setTimeout || globalThis.setTimeout;
    if (typeof schedule !== "function") {
      return;
    }

    schedule(() => {
      if (isLikelyBlankScreen()) {
        recordDiag("blank_screen_detected", { reason });
        if (tryRecoverBlankScreen(reason)) {
          return;
        }
        showDiagOverlay(reason);
      }
    }, delay);
  }

  function installNavigationDiagnostics() {
    recordDiag("shim_loaded", {
      isPlaudWeb,
      isPlaudConfiguredApp,
      newWindow: window.pakeConfig?.new_window === true,
    });

    const history = window.history;
    if (history?.pushState && !history.__pakePlaudDiagPatched) {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
      history.pushState = function pushStateWithPlaudDiag(...args) {
        const result = originalPushState.apply(this, args);
        recordDiag("route_push_state", { page: getSafeLocationParts() });
        scheduleBlankScreenCheck("route_push_state");
        return result;
      };
      history.replaceState = function replaceStateWithPlaudDiag(...args) {
        const result = originalReplaceState.apply(this, args);
        recordDiag("route_replace_state", { page: getSafeLocationParts() });
        scheduleBlankScreenCheck("route_replace_state");
        return result;
      };
      history.__pakePlaudDiagPatched = true;
    }

    window.addEventListener?.("popstate", () => {
      recordDiag("route_pop_state", { page: getSafeLocationParts() });
      scheduleBlankScreenCheck("route_pop_state");
    });
    window.addEventListener?.("hashchange", () => {
      recordDiag("route_hash_change", { page: getSafeLocationParts() });
      scheduleBlankScreenCheck("route_hash_change");
    });
    window.addEventListener?.("error", (event) => {
      recordDiag("window_error", {
        message: event?.message || "",
        filename: getSafeLocationParts(event?.filename || ""),
      });
      scheduleBlankScreenCheck("window_error", 1000);
    });
    window.addEventListener?.("unhandledrejection", (event) => {
      recordDiag("unhandled_rejection", {
        reason: event?.reason?.message || String(event?.reason || ""),
      });
      scheduleBlankScreenCheck("unhandled_rejection", 1000);
    });
  }

  function getRequestInfo(input, init = {}) {
    const rawUrl =
      typeof input === "string" ? input : input?.url || String(input || "");
    const parsed = getSafeLocationParts(rawUrl);
    const method = init.method || input?.method || "GET";
    return {
      ...parsed,
      method: String(method).toUpperCase(),
      isSsoCallback: parsed.path.includes("/auth/sso-callback"),
    };
  }

  function installNetworkDiagnostics() {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function" && !originalFetch.__pakePlaudDiag) {
      window.fetch = function fetchWithPlaudDiag(input, init) {
        const info = getRequestInfo(input, init);
        if (info.isSsoCallback) {
          recordDiag("sso_callback_fetch_start", info);
        }

        return originalFetch.apply(this, arguments).then(
          (response) => {
            if (info.isSsoCallback) {
              recordDiag("sso_callback_fetch_finish", {
                ...info,
                status: response?.status || 0,
                ok: response?.ok === true,
              });
              scheduleBlankScreenCheck("sso_callback_fetch_finish");
            }
            return response;
          },
          (error) => {
            if (info.isSsoCallback) {
              recordDiag("sso_callback_fetch_error", {
                ...info,
                error,
              });
              scheduleBlankScreenCheck("sso_callback_fetch_error", 1000);
            }
            throw error;
          },
        );
      };
      window.fetch.__pakePlaudDiag = true;
    }

    const xhrPrototype = window.XMLHttpRequest?.prototype;
    if (xhrPrototype?.open && !xhrPrototype.__pakePlaudDiagPatched) {
      const originalOpen = xhrPrototype.open;
      const originalSend = xhrPrototype.send;
      xhrPrototype.open = function openWithPlaudDiag(method, url, ...rest) {
        this.__pakePlaudRequestInfo = getRequestInfo(url, { method });
        return originalOpen.call(this, method, url, ...rest);
      };
      xhrPrototype.send = function sendWithPlaudDiag(...args) {
        const info = this.__pakePlaudRequestInfo;
        if (info?.isSsoCallback) {
          recordDiag("sso_callback_xhr_start", info);
          this.addEventListener?.("loadend", () => {
            recordDiag("sso_callback_xhr_finish", {
              ...info,
              status: this.status || 0,
            });
            scheduleBlankScreenCheck("sso_callback_xhr_finish");
          });
          this.addEventListener?.("error", () => {
            recordDiag("sso_callback_xhr_error", info);
            scheduleBlankScreenCheck("sso_callback_xhr_error", 1000);
          });
        }
        return originalSend.apply(this, args);
      };
      xhrPrototype.__pakePlaudDiagPatched = true;
    }
  }

  function installStorageDiagnostics() {
    const storage = window.localStorage;
    if (!storage?.setItem || storage.__pakePlaudDiagPatched) {
      return;
    }

    const originalSetItem = storage.setItem;
    try {
      storage.setItem = function setItemWithPlaudDiag(key, value) {
        const result = originalSetItem.apply(this, arguments);
        if (key === "pld_tokenstr") {
          recordDiag("token_storage_updated", {
            tokenPresent: Boolean(value),
          });
          scheduleBlankScreenCheck("token_storage_updated", 1000);
        }
        return result;
      };
      storage.__pakePlaudDiagPatched = true;
    } catch (_) {}
  }

  installNavigationDiagnostics();
  installNetworkDiagnostics();
  installStorageDiagnostics();
  scheduleBlankScreenCheck("initial_load", 5000);

  if (!isPlaudWeb) {
    recordDiag("non_plaud_host_in_plaud_app", {
      page: getSafeLocationParts(),
    });
    scheduleBlankScreenCheck("non_plaud_host_in_plaud_app", 1500);
    return;
  }

  // event.js uses this as a narrow allow-list for PLAUD's Google Identity
  // Services button popup. The shim below preserves PLAUD's callback-based
  // ux_mode:"popup" flow while disabling the GIS options that were associated
  // with macOS WebKit's SOAuthorization popup crash path.
  window.__PAKE_PLAUD_GOOGLE_GIS_POPUP_SAFE__ = true;

  const GIS_CLICK_PROXY_ID = "pake-plaud-google-gis-click-proxy";
  const GIS_BUTTON_IFRAME_SELECTOR =
    'iframe[src*="accounts.google.com/gsi/button"]';
  const GIS_SELECT_IFRAME_SELECTOR =
    'iframe[src*="accounts.google.com/gsi/iframe/select"],iframe[src*="oauth2_auth_url="]';

  const hookedGoogleObjects = new WeakSet();
  const hookedAccountObjects = new WeakSet();
  const patchedIdObjects = new WeakSet();

  function getElementSrc(element) {
    return (
      element?.src ||
      (typeof element?.getAttribute === "function"
        ? element.getAttribute("src")
        : "") ||
      ""
    );
  }

  function isSafePlaudGisOauthUrl(oauthUrl, iframeUrl) {
    try {
      const source = new URL(iframeUrl, window.location.href);
      const target = new URL(oauthUrl, source.href);
      const redirectUri = target.searchParams.get("redirect_uri") || "";
      const sourceOrigin = source.searchParams.get("origin") || "";
      const path = target.pathname.toLowerCase();

      return (
        source.hostname === "accounts.google.com" &&
        source.pathname.startsWith("/gsi/iframe/select") &&
        sourceOrigin === "https://web.plaud.ai" &&
        target.hostname === "accounts.google.com" &&
        (path.startsWith("/o/oauth2/") ||
          path.startsWith("/v3/signin/") ||
          path.startsWith("/signin/") ||
          redirectUri === "gis_transform" ||
          redirectUri === "https://accounts.google.com/gsi/transform" ||
          redirectUri.endsWith("/gsi/transform"))
      );
    } catch (_) {
      return false;
    }
  }

  function findPlaudGisOauthUrl() {
    const doc = window.document;
    if (!doc || typeof doc.querySelectorAll !== "function") {
      return "";
    }

    const frames = doc.querySelectorAll(GIS_SELECT_IFRAME_SELECTOR);
    for (const frame of frames) {
      const frameSrc = getElementSrc(frame);
      try {
        const frameUrl = new URL(frameSrc, window.location.href);
        const oauthUrl = frameUrl.searchParams.get("oauth2_auth_url") || "";
        if (oauthUrl && isSafePlaudGisOauthUrl(oauthUrl, frameUrl.href)) {
          return new URL(oauthUrl, frameUrl.href).href;
        }
      } catch (_) {}
    }

    return "";
  }

  function openPlaudGisPopup(oauthUrl) {
    let popup = null;
    try {
      popup = window.open(
        "about:blank",
        "signin",
        "width=1200,height=800,scrollbars=yes,resizable=yes",
      );
    } catch (error) {
      recordDiag("gis_click_proxy_popup_error", { error });
      return false;
    }

    if (!popup) {
      recordDiag("gis_click_proxy_popup_blocked");
      return false;
    }

    try {
      if (typeof popup.location?.replace === "function") {
        popup.location.replace(oauthUrl);
      } else if (popup.location) {
        popup.location.href = oauthUrl;
      } else {
        popup.location = oauthUrl;
      }
      popup.focus?.();
      recordDiag("gis_click_proxy_popup_opened", {
        target: getSafeLocationParts(oauthUrl),
      });
      return true;
    } catch (error) {
      recordDiag("gis_click_proxy_location_error", { error });
      return false;
    }
  }

  function installPlaudGisButtonProxy() {
    const doc = window.document;
    if (
      !doc ||
      typeof doc.querySelector !== "function" ||
      typeof doc.createElement !== "function"
    ) {
      return;
    }

    let overlay = doc.getElementById?.(GIS_CLICK_PROXY_ID) || null;
    let observerInstalled = false;

    const removeOverlay = () => {
      overlay?.remove?.();
      overlay = null;
    };

    const handleProxyClick = (event) => {
      const oauthUrl = findPlaudGisOauthUrl();
      if (!oauthUrl) {
        recordDiag("gis_click_proxy_missing_oauth_url");
        removeOverlay();
        return;
      }

      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      openPlaudGisPopup(oauthUrl);
    };

    const ensureOverlay = () => {
      if (!doc.body) {
        return false;
      }

      if (!observerInstalled) {
        observerInstalled = true;
        try {
          const observer = new MutationObserver(ensureOverlay);
          observer.observe(doc.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["src", "style", "class"],
          });
        } catch (_) {}
      }

      const buttonFrame = doc.querySelector(GIS_BUTTON_IFRAME_SELECTOR);
      if (
        !buttonFrame ||
        buttonFrame.isConnected === false ||
        typeof buttonFrame.getBoundingClientRect !== "function" ||
        !findPlaudGisOauthUrl()
      ) {
        removeOverlay();
        return false;
      }

      const rect = buttonFrame.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        removeOverlay();
        return false;
      }

      if (!overlay) {
        overlay = doc.createElement("button");
        overlay.id = GIS_CLICK_PROXY_ID;
        overlay.type = "button";
        overlay.setAttribute?.("aria-label", "Sign in with Google");
        overlay.onclick = handleProxyClick;
        doc.body.appendChild(overlay);
        recordDiag("gis_click_proxy_installed");
      }

      overlay.style.cssText = [
        "position:fixed",
        `left:${Math.max(0, rect.left)}px`,
        `top:${Math.max(0, rect.top)}px`,
        `width:${Math.max(0, rect.width)}px`,
        `height:${Math.max(0, rect.height)}px`,
        "z-index:2147483647",
        "margin:0",
        "padding:0",
        "border:0",
        "background:transparent",
        "color:transparent",
        "font-size:0",
        "cursor:pointer",
      ].join(";");
      return true;
    };

    let attempts = 0;
    const schedule = () => {
      attempts += 1;
      ensureOverlay();
      if (attempts < 40) {
        window.setTimeout?.(schedule, 250);
      }
    };

    schedule();
    window.addEventListener?.("resize", ensureOverlay, true);
    window.addEventListener?.("scroll", ensureOverlay, true);
    doc.addEventListener?.("DOMContentLoaded", ensureOverlay, true);
  }

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
          recordDiag("google_initialize", {
            autoSelect: config.auto_select === true,
            hasCallback: typeof config.callback === "function",
            uxMode: config.ux_mode || "popup",
            itpSupport: config.itp_support === true,
          });

          const patchedConfig = { ...config };
          if (typeof config.callback === "function") {
            patchedConfig.callback = function pakePlaudGoogleCallback(
              response,
            ) {
              recordDiag("google_callback_invoked", {
                hasCredential: Boolean(response?.credential),
                selectBy: response?.select_by || "",
              });
              try {
                const result = config.callback.apply(this, arguments);
                if (result && typeof result.then === "function") {
                  return result.then(
                    (value) => {
                      recordDiag("google_callback_resolved");
                      scheduleBlankScreenCheck("google_callback_resolved");
                      return value;
                    },
                    (error) => {
                      recordDiag("google_callback_rejected", { error });
                      scheduleBlankScreenCheck(
                        "google_callback_rejected",
                        1000,
                      );
                      throw error;
                    },
                  );
                }

                recordDiag("google_callback_returned");
                scheduleBlankScreenCheck("google_callback_returned");
                return result;
              } catch (error) {
                recordDiag("google_callback_error", { error });
                scheduleBlankScreenCheck("google_callback_error", 1000);
                throw error;
              }
            };
          }

          return originalInitialize.call(this, {
            ...patchedConfig,
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
          recordDiag("google_prompt_suppressed");
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
  installPlaudGisButtonProxy();
})();
