import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadPlaudSsoInject({
  documentElements = [],
  hostname = "web.plaud.ai",
  localStorageEntries = {},
  nativeInvoke,
  windowOpen,
  pakeConfig = {},
  runTimers = false,
  sessionStorageEntries = {},
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5)",
  withBlankDocument = false,
} = {}) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts/inject/plaud-sso.js"),
    "utf-8",
  );

  const storage = new Map();
  Object.entries(localStorageEntries).forEach(([key, value]) => {
    storage.set(key, String(value));
  });
  const sessionStorage = new Map();
  Object.entries(sessionStorageEntries).forEach(([key, value]) => {
    sessionStorage.set(key, String(value));
  });
  const elementsById = new Map();
  const createElement = (tagName = "div") => {
    const element = {
      tagName: tagName.toUpperCase(),
      style: {},
      children: [],
      readOnly: false,
      value: "",
      textContent: "",
      appendChild(child) {
        this.children.push(child);
        if (child.id) elementsById.set(child.id, child);
      },
      contains(child) {
        return this.children.includes(child);
      },
      getAttribute(name) {
        return this[name] || "";
      },
      remove() {
        if (this.id) elementsById.delete(this.id);
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      select: vi.fn(),
      set id(value) {
        this._id = value;
        elementsById.set(value, this);
      },
      get id() {
        return this._id;
      },
    };
    return element;
  };
  const body = createElement("body");
  body.innerText = "";
  body.querySelectorAll = () => [];
  const hasDocument = withBlankDocument || documentElements.length > 0;
  const document = hasDocument
    ? {
        body,
        createElement,
        execCommand: vi.fn(),
        getElementById: (id) => elementsById.get(id) || null,
        querySelector: (selector) =>
          documentElements.find((element) => element.matches?.(selector)) ||
          null,
        querySelectorAll: (selector) =>
          documentElements.filter((element) => element.matches?.(selector)),
      }
    : undefined;
  const replace = vi.fn((url) => {
    window.location.href = url;
  });
  const window = {
    location: {
      href: `https://${hostname}/login`,
      hostname,
      origin: `https://${hostname}`,
      pathname: "/login",
      replace,
    },
    navigator: { userAgent },
    pakeConfig,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    sessionStorage: {
      getItem: (key) => sessionStorage.get(key) || null,
      setItem: (key, value) => sessionStorage.set(key, String(value)),
    },
    addEventListener: vi.fn(),
    open: windowOpen,
    setTimeout: (callback) => {
      if (runTimers) callback();
      return 1;
    },
  };
  if (nativeInvoke) {
    window.__TAURI__ = { core: { invoke: nativeInvoke } };
  }
  if (document) {
    window.document = document;
  }

  runInNewContext(source, { URL, window });
  return window;
}

describe("PLAUD SSO inject", () => {
  it("preserves the PLAUD Google callback while disabling popup-risk options", () => {
    const window = loadPlaudSsoInject();
    const callback = vi.fn();
    const initializeCalls = [];

    expect(window.__PAKE_PLAUD_GOOGLE_GIS_POPUP_SAFE__).toBe(true);

    window.google = {
      accounts: {
        id: {
          initialize(config) {
            initializeCalls.push({ config, receiver: this });
          },
        },
      },
    };

    window.google.accounts.id.initialize({
      auto_select: false,
      callback,
      client_id: "346186524912-do22m9emadd66g4imjhsvoi3bdqk4pvp",
      itp_support: true,
      ux_mode: "popup",
    });

    expect(initializeCalls).toHaveLength(1);
    expect(initializeCalls[0].receiver).toBe(window.google.accounts.id);
    expect(initializeCalls[0].config).toMatchObject({
      auto_select: false,
      client_id: "346186524912-do22m9emadd66g4imjhsvoi3bdqk4pvp",
      itp_support: false,
      use_fedcm_for_button: false,
      use_fedcm_for_prompt: false,
      ux_mode: "popup",
    });
    expect(typeof initializeCalls[0].config.callback).toBe("function");
    initializeCalls[0].config.callback({ credential: "credential" });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("records Google callback diagnostics without storing the credential value", () => {
    const nativeInvoke = vi.fn(() => Promise.resolve());
    const window = loadPlaudSsoInject({ nativeInvoke });
    const callback = vi.fn();
    const initializeCalls = [];

    window.google = {
      accounts: {
        id: {
          initialize(config) {
            initializeCalls.push(config);
          },
        },
      },
    };

    window.google.accounts.id.initialize({
      callback,
      ux_mode: "popup",
    });

    initializeCalls[0].callback({
      credential: "header.payload.signature",
      select_by: "btn",
    });

    expect(callback).toHaveBeenCalledOnce();
    const diagnostics = window.__PAKE_PLAUD_EXPORT_DIAG__();
    expect(diagnostics).toContain("google_callback_invoked");
    expect(diagnostics).toContain('"hasCredential": true');
    expect(diagnostics).not.toContain("header.payload.signature");

    const nativePayload = JSON.stringify(nativeInvoke.mock.calls);
    expect(nativePayload).toContain("google_callback_invoked");
    expect(nativePayload).toContain('"hasCredential":true');
    expect(nativePayload).not.toContain("header.payload.signature");
  });

  it("suppresses Google One Tap prompt without calling the original prompt", () => {
    const window = loadPlaudSsoInject();
    const originalPrompt = vi.fn();
    const promptCallback = vi.fn();

    window.google = {};
    window.google.accounts = {};
    window.google.accounts.id = {
      prompt: originalPrompt,
    };

    window.google.accounts.id.prompt(promptCallback);

    expect(originalPrompt).not.toHaveBeenCalled();
    expect(promptCallback).toHaveBeenCalledOnce();
    const notification = promptCallback.mock.calls[0][0];
    expect(notification.isSkippedMoment()).toBe(true);
    expect(notification.getSkippedReason()).toBe("suppressed_by_pake");
  });

  it("installs diagnostics but not the GIS popup marker on a non-PLAUD host inside the PLAUD app", () => {
    const window = loadPlaudSsoInject({
      hostname: "accounts.google.com",
      pakeConfig: { url: "https://web.plaud.ai/" },
    });

    expect(window.__PAKE_PLAUD_GOOGLE_GIS_POPUP_SAFE__).toBeUndefined();
    expect(window.__PAKE_PLAUD_EXPORT_DIAG__()).toContain(
      "non_plaud_host_in_plaud_app",
    );
  });

  it("shows a diagnostic overlay when a blank PLAUD page is detected", () => {
    const window = loadPlaudSsoInject({
      runTimers: true,
      withBlankDocument: true,
    });

    expect(window.document.getElementById("pake-plaud-diag")).toBeTruthy();
    expect(window.__PAKE_PLAUD_EXPORT_DIAG__()).toContain(
      "blank_screen_detected",
    );
  });

  it("reloads the PLAUD home page once when a token exists on a blank screen", () => {
    const window = loadPlaudSsoInject({
      localStorageEntries: { pld_tokenstr: "token-value" },
      runTimers: true,
      withBlankDocument: true,
    });

    expect(window.location.replace).toHaveBeenCalledWith(
      "https://web.plaud.ai/",
    );
    expect(window.document.getElementById("pake-plaud-diag")).toBeNull();
    expect(window.__PAKE_PLAUD_EXPORT_DIAG__()).toContain(
      "blank_recovery_reload",
    );
    expect(window.__PAKE_PLAUD_EXPORT_DIAG__()).not.toContain("token-value");
  });

  it("proxies the PLAUD GIS button click through an about:blank popup", () => {
    const oauthUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=346186524912-do22m9emadd66g4imjhsvoi3bdqk4pvp.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Faccounts.google.com%2Fgsi%2Ftransform&response_type=id_token";
    const popup = {
      focus: vi.fn(),
      location: {
        replace: vi.fn(),
      },
    };
    const windowOpen = vi.fn(() => popup);
    const buttonFrame = {
      isConnected: true,
      src: "https://accounts.google.com/gsi/button?client_id=346186524912-do22m9emadd66g4imjhsvoi3bdqk4pvp.apps.googleusercontent.com",
      getBoundingClientRect: () => ({
        height: 42,
        left: 120,
        top: 96,
        width: 328,
      }),
      matches: (selector) => selector.includes("/gsi/button"),
    };
    const selectFrame = {
      isConnected: true,
      src: `https://accounts.google.com/gsi/iframe/select?origin=${encodeURIComponent(
        "https://web.plaud.ai",
      )}&oauth2_auth_url=${encodeURIComponent(oauthUrl)}`,
      matches: (selector) =>
        selector.includes("/gsi/iframe/select") ||
        selector.includes("oauth2_auth_url="),
    };

    const window = loadPlaudSsoInject({
      documentElements: [buttonFrame, selectFrame],
      runTimers: true,
      windowOpen,
    });
    const overlay = window.document.getElementById(
      "pake-plaud-google-gis-click-proxy",
    );
    const event = {
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      stopPropagation: vi.fn(),
    };

    expect(overlay).toBeTruthy();
    overlay.onclick(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(windowOpen).toHaveBeenCalledWith(
      "about:blank",
      "signin",
      "width=1200,height=800,scrollbars=yes,resizable=yes",
    );
    expect(popup.location.replace).toHaveBeenCalledWith(oauthUrl);
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(window.__PAKE_PLAUD_EXPORT_DIAG__()).toContain(
      "gis_click_proxy_popup_opened",
    );
  });

  it("does not reload repeatedly after the blank recovery was attempted", () => {
    const window = loadPlaudSsoInject({
      localStorageEntries: { pld_tokenstr: "token-value" },
      runTimers: true,
      sessionStorageEntries: { __pake_plaud_blank_recovery_v1: "1" },
      withBlankDocument: true,
    });

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.document.getElementById("pake-plaud-diag")).toBeTruthy();
  });

  it("does not patch outside the PLAUD web host", () => {
    const window = loadPlaudSsoInject({ hostname: "example.com" });
    const initialize = vi.fn();

    expect(window.__PAKE_PLAUD_GOOGLE_GIS_POPUP_SAFE__).toBeUndefined();

    window.google = {
      accounts: {
        id: { initialize },
      },
    };

    const config = { callback: () => {}, itp_support: true };
    window.google.accounts.id.initialize(config);

    expect(initialize).toHaveBeenCalledWith(config);
  });
});
