use crate::app::config::PakeConfig;
use crate::util::{
    check_file_or_append, get_data_dir, get_download_message_with_lang, sanitize_download_filename,
    show_toast, MessageType,
};
use std::{
    path::PathBuf,
    str::FromStr,
    sync::atomic::{AtomicU32, Ordering},
};
use tauri::{
    webview::{DownloadEvent, NewWindowFeatures, NewWindowResponse},
    AppHandle, Config, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use tauri::Theme;

#[cfg(target_os = "macos")]
use tauri::TitleBarStyle;

#[cfg(target_os = "windows")]
fn build_proxy_browser_arg(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    let scheme = url.scheme();
    let port = url.port().or_else(|| match scheme {
        "http" => Some(80),
        "socks5" => Some(1080),
        _ => None,
    })?;

    match scheme {
        "http" | "socks5" => Some(format!("--proxy-server={scheme}://{host}:{port}")),
        _ => None,
    }
}

pub struct MultiWindowState {
    pub pake_config: PakeConfig,
    pub tauri_config: Config,
    next_window_index: AtomicU32,
}

impl MultiWindowState {
    pub fn new(pake_config: PakeConfig, tauri_config: Config) -> Self {
        Self {
            pake_config,
            tauri_config,
            next_window_index: AtomicU32::new(0),
        }
    }

    fn next_window_label(&self) -> String {
        let index = self.next_window_index.fetch_add(1, Ordering::Relaxed) + 1;
        format!("pake-{index}")
    }
}

pub fn set_window(
    app: &AppHandle,
    config: &PakeConfig,
    tauri_config: &Config,
) -> tauri::Result<WebviewWindow> {
    build_window_with_label(app, config, tauri_config, "pake")
}

pub fn open_additional_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let state = app.state::<MultiWindowState>();
    let label = state.next_window_label();
    build_window_with_label(app, &state.pake_config, &state.tauri_config, &label)
}

struct WindowBuildOptions<'a> {
    label: &'a str,
    url: WebviewUrl,
    visible: bool,
    new_window_features: Option<NewWindowFeatures>,
}

const DOWNLOAD_FILENAME_QUERY_PARAMS: &[&str] =
    &["filename", "fileName", "file_name", "fn", "name"];

const DOWNLOAD_DISPOSITION_QUERY_PARAMS: &[&str] = &[
    "cd",
    "content-disposition",
    "content_disposition",
    "response-content-disposition",
    "response_content_disposition",
    "disposition",
];

const DOWNLOADABLE_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "markdown", "mdx", "rtf",
    "odt", "ods", "odp", "pages", "numbers", "key", "epub", "mobi", "zip", "rar", "7z", "tar",
    "gz", "gzip", "bz2", "xz", "lzma", "deb", "rpm", "pkg", "msi", "exe", "dmg", "apk", "ipa",
    "json", "xml", "csv", "sql", "db", "sqlite", "yaml", "yml", "toml", "ini", "cfg", "conf",
    "log", "js", "ts", "jsx", "tsx", "css", "scss", "sass", "less", "sh", "bat", "ps1", "ttf",
    "otf", "woff", "woff2", "eot", "ai", "psd", "sketch", "fig", "xd", "iso", "img", "bin",
    "torrent", "jar", "war", "indd", "fla", "swf", "raw",
];

const PREVIEWABLE_MEDIA_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff", "tif", "avif", "heic", "heif",
    "mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv", "mp3", "wav", "ogg", "flac", "aac", "m4a",
];

fn filename_from_path_value(value: &str) -> Option<String> {
    let candidate = value
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .trim();

    if candidate.contains('.') && !candidate.starts_with('.') && !candidate.ends_with('.') {
        Some(candidate.to_string())
    } else {
        None
    }
}

fn filename_from_content_disposition(value: &str) -> Option<String> {
    value.split(';').find_map(|part| {
        let (key, raw_value) = part.split_once('=')?;
        let key = key.trim().trim_end_matches('*');
        if key.eq_ignore_ascii_case("filename") {
            filename_from_path_value(raw_value)
        } else {
            None
        }
    })
}

fn explicit_filename_from_url(url: &Url) -> Option<String> {
    if let Some(filename) = filename_from_path_value(url.path()) {
        return Some(filename);
    }

    for (key, value) in url.query_pairs() {
        if DOWNLOAD_FILENAME_QUERY_PARAMS
            .iter()
            .any(|param| key.eq_ignore_ascii_case(param))
        {
            if let Some(filename) = filename_from_path_value(&value) {
                return Some(filename);
            }
        }

        if DOWNLOAD_DISPOSITION_QUERY_PARAMS
            .iter()
            .any(|param| key.eq_ignore_ascii_case(param))
        {
            if let Some(filename) = filename_from_content_disposition(&value) {
                return Some(filename);
            }
        }
    }

    None
}

fn extension_from_filename(filename: &str) -> Option<String> {
    filename
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn has_attachment_disposition(url: &Url) -> bool {
    url.query_pairs().any(|(key, value)| {
        DOWNLOAD_DISPOSITION_QUERY_PARAMS
            .iter()
            .any(|param| key.eq_ignore_ascii_case(param))
            && value.to_ascii_lowercase().contains("attachment")
    })
}

fn download_filename_for_navigation(url: &Url) -> Option<String> {
    let filename = explicit_filename_from_url(url)?;
    let extension = extension_from_filename(&filename)?;

    if PREVIEWABLE_MEDIA_EXTENSIONS.contains(&extension.as_str()) {
        return None;
    }

    if DOWNLOADABLE_EXTENSIONS.contains(&extension.as_str())
        || has_attachment_disposition(url)
        || url.query_pairs().any(|(key, _)| {
            key.eq_ignore_ascii_case("download") || key.eq_ignore_ascii_case("attachment")
        })
    {
        Some(filename)
    } else {
        None
    }
}

fn build_page_download_script(url: &Url, filename: &str) -> Option<String> {
    let url_json = serde_json::to_string(url.as_str()).ok()?;
    let filename_json = serde_json::to_string(filename).ok()?;

    Some(format!(
        "(() => {{
  const url = {url_json};
  const filename = {filename_json};
  if (typeof window.__PAKE_DOWNLOAD_URL === 'function') {{
    window.__PAKE_DOWNLOAD_URL(url, filename);
  }} else {{
    window.__PAKE_PENDING_DOWNLOADS = window.__PAKE_PENDING_DOWNLOADS || [];
    window.__PAKE_PENDING_DOWNLOADS.push({{ url, filename }});
  }}
}})();"
    ))
}

fn open_requested_window(
    app: &AppHandle,
    config: &PakeConfig,
    tauri_config: &Config,
    target_url: Url,
    features: NewWindowFeatures,
) -> tauri::Result<WebviewWindow> {
    let state = app.state::<MultiWindowState>();
    let label = state.next_window_label();
    let window = build_window(
        app,
        config,
        tauri_config,
        WindowBuildOptions {
            label: &label,
            url: WebviewUrl::External(target_url.clone()),
            visible: true,
            new_window_features: Some(features),
        },
    )?;

    let title = target_url.host_str().unwrap_or(target_url.as_str());
    let _ = window.set_title(title);
    let _ = window.set_focus();

    Ok(window)
}

pub fn open_additional_window_safe(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            if let Ok(window) = open_additional_window(&app_handle) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(window) = open_additional_window(app) {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

fn build_window_with_label(
    app: &AppHandle,
    config: &PakeConfig,
    tauri_config: &Config,
    label: &str,
) -> tauri::Result<WebviewWindow> {
    let window_config = config.windows.first().ok_or_else(|| {
        tauri::Error::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "pake.json must define at least one window configuration",
        ))
    })?;
    let url = match window_config.url_type.as_str() {
        "web" => {
            let parsed = window_config.url.parse().map_err(|err| {
                tauri::Error::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!(
                        "Invalid 'web' url '{}' in pake.json: {err}",
                        window_config.url
                    ),
                ))
            })?;
            WebviewUrl::App(parsed)
        }
        "local" => WebviewUrl::App(PathBuf::from(&window_config.url)),
        other => {
            return Err(tauri::Error::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("url_type must be 'web' or 'local', got '{other}'"),
            )));
        }
    };

    build_window(
        app,
        config,
        tauri_config,
        WindowBuildOptions {
            label,
            url,
            visible: false,
            new_window_features: None,
        },
    )
}

fn build_window(
    app: &AppHandle,
    config: &PakeConfig,
    tauri_config: &Config,
    opts: WindowBuildOptions,
) -> tauri::Result<WebviewWindow> {
    let WindowBuildOptions {
        label,
        url,
        visible,
        new_window_features,
    } = opts;
    let package_name = tauri_config
        .product_name
        .clone()
        .unwrap_or_else(|| "pake".to_string());
    let _data_dir = get_data_dir(app, package_name).map_err(tauri::Error::Io)?;

    let window_config = config.windows.first().ok_or_else(|| {
        tauri::Error::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "pake.json must define at least one window configuration",
        ))
    })?;

    let user_agent = config.user_agent.get();

    let config_script = format!(
        "window.pakeConfig = {}",
        serde_json::to_string(&window_config).unwrap_or_else(|_| "{}".to_string())
    );

    // Platform-specific title: macOS prefers empty, others fallback to product name
    let effective_title = window_config.title.as_deref().unwrap_or_else(|| {
        if cfg!(target_os = "macos") {
            ""
        } else {
            tauri_config.product_name.as_deref().unwrap_or("")
        }
    });

    let mut window_builder = WebviewWindowBuilder::new(app, label, url)
        .title(effective_title)
        .visible(visible)
        .user_agent(user_agent)
        .resizable(window_config.resizable)
        .maximized(window_config.maximize);

    #[cfg(target_os = "windows")]
    {
        let scale_factor = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| m.scale_factor())
            .unwrap_or(1.0);
        let logical_width = window_config.width / scale_factor;
        let logical_height = window_config.height / scale_factor;
        window_builder = window_builder.inner_size(logical_width, logical_height);
    }

    #[cfg(not(target_os = "windows"))]
    {
        window_builder = window_builder.inner_size(window_config.width, window_config.height);
    }

    window_builder = window_builder
        .always_on_top(window_config.always_on_top)
        .incognito(window_config.incognito);

    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        window_builder = window_builder.fullscreen(window_config.fullscreen);
    }

    if window_config.min_width > 0.0 || window_config.min_height > 0.0 {
        let min_w = if window_config.min_width > 0.0 {
            window_config.min_width
        } else {
            window_config.width
        };
        let min_h = if window_config.min_height > 0.0 {
            window_config.min_height
        } else {
            window_config.height
        };
        window_builder = window_builder.min_inner_size(min_w, min_h);
    }

    if !window_config.enable_drag_drop {
        window_builder = window_builder.disable_drag_drop_handler();
    }

    if window_config.new_window {
        let app_handle = app.clone();
        let popup_config = config.clone();
        let popup_tauri_config = tauri_config.clone();
        window_builder = window_builder.on_new_window(move |target_url, features| {
            match open_requested_window(
                &app_handle,
                &popup_config,
                &popup_tauri_config,
                target_url,
                features,
            ) {
                Ok(window) => NewWindowResponse::Create { window },
                Err(error) => {
                    eprintln!("[Pake] Failed to open requested window: {error}");
                    NewWindowResponse::Deny
                }
            }
        });
    }

    // Add initialization scripts. Order matters: pakeConfig must land before
    // any script that reads it (e.g. fullscreen polyfill checks for an opt-out
    // flag), and toast must register `window.pakeToast` before Rust code
    // calls show_toast().
    window_builder = window_builder.initialization_script(&config_script);

    // find.js is opt-in via --enable-find and no-ops at runtime when disabled,
    // so only inject its ~700 lines when the feature is on. Avoids parsing the
    // find UI on every page load in the common (find-off) case. Matches the
    // enable_find gating already applied to the Find menu item.
    if window_config.enable_find {
        window_builder = window_builder.initialization_script(include_str!("../inject/find.js"));
    }

    window_builder = window_builder
        .initialization_script(include_str!("../inject/toast.js"))
        .initialization_script(include_str!("../inject/fullscreen.js"))
        .initialization_script(include_str!("../inject/event.js"))
        .initialization_script(include_str!("../inject/style.js"))
        .initialization_script(include_str!("../inject/theme_refresh.js"))
        .initialization_script(include_str!("../inject/auth.js"))
        .initialization_script(include_str!("../inject/custom.js"));

    #[cfg(target_os = "windows")]
    let mut windows_browser_args = String::from("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disable-blink-features=AutomationControlled");

    #[cfg(target_os = "linux")]
    let mut linux_browser_args = String::from("--disable-blink-features=AutomationControlled");

    if window_config.ignore_certificate_errors {
        #[cfg(target_os = "windows")]
        {
            windows_browser_args.push_str(" --ignore-certificate-errors");
        }

        #[cfg(target_os = "linux")]
        {
            linux_browser_args.push_str(" --ignore-certificate-errors");
        }

        #[cfg(target_os = "macos")]
        {
            window_builder = window_builder.additional_browser_args("--ignore-certificate-errors");
        }
    }

    if window_config.enable_wasm {
        #[cfg(target_os = "windows")]
        {
            windows_browser_args.push_str(" --enable-features=SharedArrayBuffer");
            windows_browser_args.push_str(" --enable-unsafe-webgpu");
        }

        #[cfg(target_os = "linux")]
        {
            linux_browser_args.push_str(" --enable-features=SharedArrayBuffer");
            linux_browser_args.push_str(" --enable-unsafe-webgpu");
        }

        #[cfg(target_os = "macos")]
        {
            window_builder = window_builder
                .additional_browser_args("--enable-features=SharedArrayBuffer")
                .additional_browser_args("--enable-unsafe-webgpu");
        }
    }

    let mut parsed_proxy_url: Option<Url> = None;

    // Default to following the system theme (None), only force dark when explicitly set.
    // Computed once; the matching platform block below is the sole consumer.
    let theme = if window_config.dark_mode {
        Some(Theme::Dark)
    } else {
        None // Follow system theme
    };

    // Platform-specific configuration must be set before proxy on Windows/Linux
    #[cfg(target_os = "macos")]
    {
        let title_bar_style = if window_config.hide_title_bar {
            TitleBarStyle::Overlay
        } else {
            TitleBarStyle::Visible
        };
        window_builder = window_builder.title_bar_style(title_bar_style);
        window_builder = window_builder.theme(theme);
    }

    // Windows and Linux: set data_directory before proxy_url
    #[cfg(not(target_os = "macos"))]
    {
        window_builder = window_builder.data_directory(_data_dir).theme(theme);

        if !config.proxy_url.is_empty() {
            if let Ok(proxy_url) = Url::from_str(&config.proxy_url) {
                parsed_proxy_url = Some(proxy_url.clone());
                #[cfg(target_os = "windows")]
                {
                    if let Some(arg) = build_proxy_browser_arg(&proxy_url) {
                        windows_browser_args.push(' ');
                        windows_browser_args.push_str(&arg);
                    }
                }
            }
        }

        #[cfg(target_os = "windows")]
        {
            window_builder = window_builder.additional_browser_args(&windows_browser_args);
        }

        #[cfg(target_os = "linux")]
        {
            window_builder = window_builder.additional_browser_args(&linux_browser_args);
        }
    }

    // Set proxy after platform-specific configs (required for Windows/Linux)
    if parsed_proxy_url.is_none() && !config.proxy_url.is_empty() {
        if let Ok(proxy_url) = Url::from_str(&config.proxy_url) {
            parsed_proxy_url = Some(proxy_url);
        }
    }

    if let Some(proxy_url) = parsed_proxy_url {
        window_builder = window_builder.proxy_url(proxy_url);
        #[cfg(debug_assertions)]
        println!("Proxy configured: {}", config.proxy_url);
    }

    if let Some(features) = new_window_features {
        // Reuse only opener-provided position/size on macOS; sharing the opener
        // WKWebViewConfiguration triggers duplicate WKScriptMessageHandler
        // registrations on macOS 26+ and crashes the app (issue #1194).
        #[cfg(target_os = "macos")]
        {
            if let Some(position) = features.position() {
                window_builder = window_builder.position(position.x, position.y);
            }

            if let Some(size) = features.size() {
                window_builder = window_builder.inner_size(size.width, size.height);
            }

            window_builder = window_builder.focused(true);
        }

        #[cfg(not(target_os = "macos"))]
        {
            window_builder = window_builder.window_features(features).focused(true);
        }
    }

    // Capture webview-initiated downloads (blob:, data:, Content-Disposition,
    // etc.) and write them to the OS Downloads folder. This is essential for
    // sites with a strict Content-Security-Policy (e.g. Gemini): their
    // `connect-src` blocks Tauri's IPC origin, so downloads cannot be routed
    // through the JS bridge, and downloads triggered from a sandboxed iframe
    // can't reach the IPC either. Letting the browser download natively and
    // catching it here is independent of the page CSP and the IPC channel.
    {
        let download_handle = app.clone();
        window_builder = window_builder.on_download(move |_webview, event| match event {
            DownloadEvent::Requested { url, destination } => {
                match download_handle.path().download_dir() {
                    Ok(download_dir) => {
                        let filename = destination
                            .file_name()
                            .map(|name| name.to_string_lossy().to_string())
                            .filter(|name| !name.is_empty())
                            .or_else(|| {
                                url.path_segments()
                                    .and_then(|mut segments| segments.next_back())
                                    .map(|segment| segment.to_string())
                                    .filter(|segment| !segment.is_empty())
                            })
                            .unwrap_or_else(|| "download".to_string());

                        let target = download_dir.join(sanitize_download_filename(&filename));
                        if let Some(path_str) = target.to_str() {
                            *destination = PathBuf::from(check_file_or_append(path_str));
                        }
                    }
                    Err(error) => {
                        eprintln!("[Pake] Failed to resolve download dir: {error}");
                    }
                }
                true
            }
            DownloadEvent::Finished {
                url: _,
                path: _,
                success,
            } => {
                if let Some(window) = download_handle.get_webview_window("pake") {
                    let message_type = if success {
                        MessageType::Success
                    } else {
                        MessageType::Failure
                    };
                    show_toast(&window, &get_download_message_with_lang(message_type, None));
                }
                true
            }
            _ => true,
        });
    }

    {
        let navigation_handle = app.clone();
        let navigation_window_label = label.to_string();
        window_builder = window_builder.on_navigation(move |url| {
            let Some(filename) = download_filename_for_navigation(&url) else {
                return true;
            };

            if let Some(window) = navigation_handle.get_webview_window(&navigation_window_label) {
                if let Some(script) = build_page_download_script(&url, &filename) {
                    if let Err(error) = window.eval(&script) {
                        eprintln!("[Pake] Failed to dispatch download navigation: {error}");
                    }
                }
            }

            false
        });
    }

    window_builder.build()
}

#[cfg(all(test, target_os = "windows"))]
mod proxy_arg_tests {
    use super::*;

    fn parse(url: &str) -> Url {
        Url::from_str(url).unwrap()
    }

    #[test]
    fn http_url_with_explicit_port() {
        let arg = build_proxy_browser_arg(&parse("http://127.0.0.1:7890")).unwrap();
        assert_eq!(arg, "--proxy-server=http://127.0.0.1:7890");
    }

    #[test]
    fn http_url_uses_default_port_when_missing() {
        let arg = build_proxy_browser_arg(&parse("http://proxy.local")).unwrap();
        assert_eq!(arg, "--proxy-server=http://proxy.local:80");
    }

    #[test]
    fn socks5_url_uses_default_port_when_missing() {
        let arg = build_proxy_browser_arg(&parse("socks5://proxy.local")).unwrap();
        assert_eq!(arg, "--proxy-server=socks5://proxy.local:1080");
    }

    #[test]
    fn https_scheme_is_not_supported_yet() {
        // https proxies fall back to platform proxy_url; we only emit a CLI arg
        // for http/socks5 today.
        assert!(build_proxy_browser_arg(&parse("https://proxy.local:8443")).is_none());
    }
}
