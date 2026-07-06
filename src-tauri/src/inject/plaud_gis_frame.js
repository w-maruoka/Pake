(() => {
  const DIAG_MESSAGE_KEY = "__PAKE_PLAUD_GIS_FRAME_DIAG__";
  const userAgent = window.navigator?.userAgent || "";
  const location = window.location;
  const host = location?.hostname?.toLowerCase() || "";
  const path = location?.pathname?.toLowerCase() || "";

  if (!/macintosh|mac os x/i.test(userAgent)) {
    return;
  }

  try {
    if (window.top === window) {
      return;
    }
  } catch (_) {}

  if (host !== "accounts.google.com" || !path.startsWith("/gsi/")) {
    return;
  }

  if (window.__PAKE_PLAUD_GIS_FRAME_OPEN_PATCHED__ === true) {
    return;
  }

  const originalWindowOpen = window.open;
  if (typeof originalWindowOpen !== "function") {
    return;
  }

  function getSafeUrlParts(url) {
    try {
      const parsedUrl = new URL(url, location?.href);
      return {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
        searchKeys: [...parsedUrl.searchParams.keys()].sort(),
      };
    } catch (_) {
      return {
        host: "",
        path: "",
        searchKeys: [],
      };
    }
  }

  function recordDiag(event, details = {}) {
    try {
      window.parent?.postMessage(
        {
          [DIAG_MESSAGE_KEY]: true,
          event,
          details,
        },
        "https://web.plaud.ai",
      );
    } catch (_) {}
  }

  function isGisTransformRedirect(redirectUri) {
    if (!redirectUri) {
      return false;
    }

    if (redirectUri === "gis_transform") {
      return true;
    }

    try {
      const parsedRedirect = new URL(
        redirectUri,
        "https://accounts.google.com",
      );
      return (
        parsedRedirect.hostname === "accounts.google.com" &&
        parsedRedirect.pathname === "/gsi/transform"
      );
    } catch (_) {
      return false;
    }
  }

  function isSafePlaudGisPopupUrl(url) {
    try {
      const parsedUrl = new URL(url, location?.href);
      const targetHost = parsedUrl.hostname.toLowerCase();
      const targetPath = parsedUrl.pathname.toLowerCase();

      if (targetHost !== "accounts.google.com") {
        return false;
      }

      if (
        targetPath.startsWith("/gsi/") ||
        targetPath.startsWith("/v3/signin/") ||
        targetPath.startsWith("/signin/oauth/")
      ) {
        return true;
      }

      if (!targetPath.startsWith("/o/oauth2/")) {
        return false;
      }

      return isGisTransformRedirect(
        parsedUrl.searchParams.get("redirect_uri") || "",
      );
    } catch (_) {
      return false;
    }
  }

  function assignPopupLocation(popup, url) {
    try {
      if (typeof popup.location?.replace === "function") {
        popup.location.replace(url);
      } else if (popup.location) {
        popup.location.href = url;
      } else {
        popup.location = url;
      }
      recordDiag("gis_frame_popup_location_assigned", {
        target: getSafeUrlParts(url),
      });
    } catch (error) {
      recordDiag("gis_frame_popup_location_failed", {
        error: error?.name || "Error",
        target: getSafeUrlParts(url),
      });
    }
  }

  function openGisPopupViaBlankWindow(url, name, specs) {
    const absoluteUrl = new URL(url, location?.href).href;
    recordDiag("gis_frame_popup_open_attempt", {
      target: getSafeUrlParts(absoluteUrl),
    });

    const popup = originalWindowOpen.call(
      window,
      "about:blank",
      name || "_blank",
      specs,
    );

    if (!popup) {
      recordDiag("gis_frame_popup_open_blocked", {
        target: getSafeUrlParts(absoluteUrl),
      });
      return null;
    }

    assignPopupLocation(popup, absoluteUrl);

    try {
      popup.focus?.();
    } catch (_) {}

    return popup;
  }

  window.open = function openWithPakePlaudGisFrameGuard(url, name, specs) {
    const normalizedUrl = typeof url === "string" ? url.trim() : "";
    if (normalizedUrl && isSafePlaudGisPopupUrl(normalizedUrl)) {
      return openGisPopupViaBlankWindow(normalizedUrl, name, specs);
    }

    return originalWindowOpen.call(window, url, name, specs);
  };

  window.open.__pakePlaudGisFramePatched = true;
  window.__PAKE_PLAUD_GIS_FRAME_OPEN_PATCHED__ = true;
  recordDiag("gis_frame_open_patch_installed", {
    page: getSafeUrlParts(location?.href),
  });
})();
