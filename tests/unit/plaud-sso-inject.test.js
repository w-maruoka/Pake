import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadPlaudSsoInject({
  hostname = "web.plaud.ai",
  pakeConfig = {},
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5)",
} = {}) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts/inject/plaud-sso.js"),
    "utf-8",
  );

  const window = {
    location: { hostname },
    navigator: { userAgent },
    pakeConfig,
  };

  runInNewContext(source, { window });
  return window;
}

describe("PLAUD SSO inject", () => {
  it("preserves the PLAUD Google callback while disabling popup-risk options", () => {
    const window = loadPlaudSsoInject();
    const callback = () => {};
    const initializeCalls = [];

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
      callback,
      client_id: "346186524912-do22m9emadd66g4imjhsvoi3bdqk4pvp",
      itp_support: false,
      use_fedcm_for_button: false,
      use_fedcm_for_prompt: false,
      ux_mode: "popup",
    });
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

  it("does not patch outside the PLAUD web host", () => {
    const window = loadPlaudSsoInject({ hostname: "example.com" });
    const initialize = vi.fn();

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
