import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadPlaudSsoInject({
  hostname = "web.plaud.ai",
  pakeConfig = {},
  runTimers = false,
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5)",
  withBlankDocument = false,
} = {}) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts/inject/plaud-sso.js"),
    "utf-8",
  );

  const storage = new Map();
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
      remove() {
        if (this.id) elementsById.delete(this.id);
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
  const document = withBlankDocument
    ? {
        body,
        createElement,
        execCommand: vi.fn(),
        getElementById: (id) => elementsById.get(id) || null,
      }
    : undefined;
  const window = {
    location: {
      href: `https://${hostname}/login`,
      hostname,
      origin: `https://${hostname}`,
      pathname: "/login",
    },
    navigator: { userAgent },
    pakeConfig,
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
    setTimeout: (callback) => {
      if (runTimers) callback();
      return 1;
    },
  };
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
    const window = loadPlaudSsoInject();
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
