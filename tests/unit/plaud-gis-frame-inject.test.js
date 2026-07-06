import fs from "fs";
import path from "path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function loadPlaudGisFrameInject({
  href = "https://accounts.google.com/gsi/button?client_id=plaud",
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_5)",
  windowOpen,
} = {}) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src-tauri/src/inject/plaud_gis_frame.js"),
    "utf-8",
  );
  const parsedHref = new URL(href);
  const postedMessages = [];
  const window = {
    location: {
      href: parsedHref.href,
      hostname: parsedHref.hostname,
      origin: parsedHref.origin,
      pathname: parsedHref.pathname,
    },
    navigator: { userAgent },
    open: windowOpen || vi.fn(() => null),
    parent: {
      postMessage: vi.fn((data, targetOrigin) => {
        postedMessages.push({ data, targetOrigin });
      }),
    },
  };
  window.top = {};

  runInNewContext(source, { URL, window });
  return { window, postedMessages };
}

describe("PLAUD GIS frame inject", () => {
  it("opens Google GIS OAuth from the accounts.google.com button frame through about:blank", () => {
    const oauthUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=plaud&redirect_uri=https%3A%2F%2Faccounts.google.com%2Fgsi%2Ftransform&response_type=id_token";
    const popup = {
      focus: vi.fn(),
      location: {
        replace: vi.fn(),
      },
    };
    const windowOpen = vi.fn(() => popup);
    const { window, postedMessages } = loadPlaudGisFrameInject({ windowOpen });

    const result = window.open(oauthUrl, "signin", "width=1200,height=800");

    expect(windowOpen).toHaveBeenCalledWith(
      "about:blank",
      "signin",
      "width=1200,height=800",
    );
    expect(popup.location.replace).toHaveBeenCalledWith(oauthUrl);
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(result).toBe(popup);
    expect(postedMessages).toContainEqual(
      expect.objectContaining({
        targetOrigin: "https://web.plaud.ai",
        data: expect.objectContaining({
          __PAKE_PLAUD_GIS_FRAME_DIAG__: true,
          event: "gis_frame_popup_location_assigned",
        }),
      }),
    );
    expect(JSON.stringify(postedMessages)).not.toContain("client_id=plaud");
  });

  it("preserves opener for direct Google sign-in URLs opened from the GIS frame", () => {
    const signinUrl =
      "https://accounts.google.com/v3/signin/accountchooser?gsiwebsdk=gis_attributes";
    const popup = {
      location: {
        replace: vi.fn(),
      },
    };
    const windowOpen = vi.fn(() => popup);
    const { window } = loadPlaudGisFrameInject({ windowOpen });

    expect(window.open(signinUrl, "signin", "popup")).toBe(popup);
    expect(windowOpen).toHaveBeenCalledWith("about:blank", "signin", "popup");
    expect(popup.location.replace).toHaveBeenCalledWith(signinUrl);
  });

  it("does not intercept broad Google OAuth URLs that are not GIS transform flows", () => {
    const unsafeOAuthUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=plaud&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback";
    const passthrough = {};
    const windowOpen = vi.fn(() => passthrough);
    const { window } = loadPlaudGisFrameInject({ windowOpen });

    expect(window.open(unsafeOAuthUrl, "signin", "popup")).toBe(passthrough);
    expect(windowOpen).toHaveBeenCalledWith(unsafeOAuthUrl, "signin", "popup");
  });

  it("does not install outside Google GIS frames or outside macOS", () => {
    const macWindowOpen = vi.fn();
    const { window: plaudTopWindow } = loadPlaudGisFrameInject({
      href: "https://web.plaud.ai/login",
      windowOpen: macWindowOpen,
    });
    expect(
      plaudTopWindow.__PAKE_PLAUD_GIS_FRAME_OPEN_PATCHED__,
    ).toBeUndefined();

    const nonMacWindowOpen = vi.fn();
    const { window: nonMacFrameWindow } = loadPlaudGisFrameInject({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      windowOpen: nonMacWindowOpen,
    });
    expect(
      nonMacFrameWindow.__PAKE_PLAUD_GIS_FRAME_OPEN_PATCHED__,
    ).toBeUndefined();
  });

  it("does not navigate the frame or main page when the blank popup is blocked", () => {
    const oauthUrl =
      "https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=gis_transform";
    const windowOpen = vi.fn(() => null);
    const { window } = loadPlaudGisFrameInject({ windowOpen });

    const result = window.open(oauthUrl, "signin", "popup");

    expect(result).toBeNull();
    expect(windowOpen).toHaveBeenCalledWith("about:blank", "signin", "popup");
    expect(window.location.href).toBe(
      "https://accounts.google.com/gsi/button?client_id=plaud",
    );
  });
});
