use serde_json::{json, Map, Value};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, Url};

const DIAG_FILE_NAME: &str = "plaud-pake-diagnostics.json";
const MAX_ENTRIES: usize = 200;
const MAX_STRING_CHARS: usize = 240;
const MAX_ARRAY_ITEMS: usize = 20;
const MAX_OBJECT_KEYS: usize = 60;

pub fn is_plaud_app_url(url: &str) -> bool {
    Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host == "web.plaud.ai")
}

pub fn should_record_navigation(url: &Url) -> bool {
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };

    host == "web.plaud.ai" || (host == "accounts.google.com" && url.path().starts_with("/gsi/"))
}

pub fn should_allow_native_gis_popup(app_url: &str, target_url: &Url) -> bool {
    if !is_plaud_app_url(app_url) {
        return false;
    }

    if target_url.scheme() == "about" && target_url.path() == "blank" {
        return true;
    }

    let Some(host) = target_url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };

    host == "accounts.google.com" && is_google_gis_flow_path(target_url.path())
}

pub fn record_js_entry(app: &AppHandle, entry: Value) -> Result<(), String> {
    append_entry(app, normalize_entry("js", entry))
}

pub fn record_native_event(app: &AppHandle, event: &str, details: Value) {
    let entry = json!({
        "event": event,
        "source": "native",
        "timestampMs": now_millis(),
        "details": details,
    });

    if let Err(error) = append_entry(app, normalize_entry("native", entry)) {
        eprintln!("[Pake] Failed to record PLAUD diagnostic: {error}");
    }
}

pub fn record_navigation(app: &AppHandle, label: &str, url: &Url) {
    record_native_event(
        app,
        "native_navigation",
        json!({
            "label": label,
            "target": safe_url_parts(url),
        }),
    );
}

pub fn export_to_downloads(app: &AppHandle) -> Result<PathBuf, String> {
    let entries = read_entries(app)?;
    let export = json!({
        "generatedAtMs": now_millis(),
        "entries": entries,
    });
    let download_dir = app
        .path()
        .download_dir()
        .map_err(|error| format!("Failed to resolve Downloads directory: {error}"))?;
    let path = download_dir.join(DIAG_FILE_NAME);
    let data = serde_json::to_vec_pretty(&export)
        .map_err(|error| format!("Failed to encode PLAUD diagnostics: {error}"))?;
    fs::write(&path, data)
        .map_err(|error| format!("Failed to write PLAUD diagnostics: {error}"))?;
    Ok(path)
}

fn normalize_entry(default_source: &str, entry: Value) -> Value {
    let mut entry = match sanitize_value(None, entry) {
        Value::Object(map) => map,
        other => {
            let mut map = Map::new();
            map.insert("event".to_string(), Value::String("event".to_string()));
            map.insert("details".to_string(), other);
            map
        }
    };

    entry
        .entry("source")
        .or_insert_with(|| Value::String(default_source.to_string()));
    entry
        .entry("receivedAtMs")
        .or_insert_with(|| Value::Number(now_millis().into()));
    Value::Object(entry)
}

fn append_entry(app: &AppHandle, entry: Value) -> Result<(), String> {
    let path = diag_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create diagnostics directory: {error}"))?;
    }

    let mut entries = read_entries_from_path(&path);
    entries.push(entry);
    if entries.len() > MAX_ENTRIES {
        entries = entries.split_off(entries.len() - MAX_ENTRIES);
    }

    let data = serde_json::to_vec_pretty(&entries)
        .map_err(|error| format!("Failed to encode PLAUD diagnostics: {error}"))?;
    fs::write(path, data).map_err(|error| format!("Failed to write diagnostics: {error}"))
}

fn read_entries(app: &AppHandle) -> Result<Vec<Value>, String> {
    Ok(read_entries_from_path(&diag_path(app)?))
}

fn read_entries_from_path(path: &PathBuf) -> Vec<Value> {
    fs::read(path)
        .ok()
        .and_then(|data| serde_json::from_slice::<Value>(&data).ok())
        .and_then(|value| match value {
            Value::Array(entries) => Some(entries),
            Value::Object(mut object) => object.remove("entries").and_then(|entries| {
                if let Value::Array(entries) = entries {
                    Some(entries)
                } else {
                    None
                }
            }),
            _ => None,
        })
        .unwrap_or_default()
}

fn diag_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(DIAG_FILE_NAME))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn safe_url_parts(url: &Url) -> Value {
    let search_keys = url
        .query_pairs()
        .map(|(key, _)| Value::String(key.to_string()))
        .collect::<Vec<_>>();

    json!({
        "host": url.host_str().unwrap_or(""),
        "path": url.path(),
        "searchKeys": search_keys,
    })
}

pub fn safe_url_parts_for_diag(url: &Url) -> Value {
    safe_url_parts(url)
}

fn is_google_gis_flow_path(path: &str) -> bool {
    path.starts_with("/gsi/")
        || path.starts_with("/v3/signin/")
        || path.starts_with("/signin/oauth/")
}

fn sanitize_value(key: Option<&str>, value: Value) -> Value {
    if key.is_some_and(is_sensitive_key) {
        return Value::Bool(value_present(&value));
    }

    match value {
        Value::String(value) => Value::String(value.chars().take(MAX_STRING_CHARS).collect()),
        Value::Array(values) => Value::Array(
            values
                .into_iter()
                .take(MAX_ARRAY_ITEMS)
                .map(|value| sanitize_value(None, value))
                .collect(),
        ),
        Value::Object(object) => {
            let mut sanitized = Map::new();
            for (key, value) in object.into_iter().take(MAX_OBJECT_KEYS) {
                sanitized.insert(key.clone(), sanitize_value(Some(&key), value));
            }
            Value::Object(sanitized)
        }
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    ["credential", "token", "password", "secret", "code"]
        .iter()
        .any(|keyword| key.contains(keyword))
}

fn value_present(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(value) => !value.is_empty(),
        Value::Array(value) => !value.is_empty(),
        Value::Object(value) => !value.is_empty(),
        Value::Number(_) => true,
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn masks_sensitive_values() {
        let entry = normalize_entry(
            "js",
            json!({
                "event": "google_callback_invoked",
                "details": {
                    "credential": "header.payload.signature",
                    "tokenPresent": true,
                    "message": "ok"
                }
            }),
        );

        let encoded = serde_json::to_string(&entry).unwrap();
        assert!(encoded.contains("\"credential\":true"));
        assert!(encoded.contains("\"tokenPresent\":true"));
        assert!(encoded.contains("\"message\":\"ok\""));
        assert!(!encoded.contains("header.payload.signature"));
    }

    #[test]
    fn recognizes_plaud_app_and_google_gsi_navigation() {
        assert!(is_plaud_app_url("https://web.plaud.ai/"));
        assert!(!is_plaud_app_url("https://accounts.google.com/"));

        assert!(should_record_navigation(
            &Url::parse("https://web.plaud.ai/login?code=secret").unwrap()
        ));
        assert!(should_record_navigation(
            &Url::parse("https://accounts.google.com/gsi/select?client_id=123").unwrap()
        ));
        assert!(!should_record_navigation(
            &Url::parse("https://accounts.google.com/o/oauth2/auth").unwrap()
        ));
    }

    #[test]
    fn allows_only_plaud_google_gis_popups_to_use_native_opener_flow() {
        let plaud_url = "https://web.plaud.ai/";

        assert!(should_allow_native_gis_popup(
            plaud_url,
            &Url::parse("about:blank").unwrap()
        ));
        assert!(should_allow_native_gis_popup(
            plaud_url,
            &Url::parse("https://accounts.google.com/gsi/select").unwrap()
        ));
        assert!(should_allow_native_gis_popup(
            plaud_url,
            &Url::parse("https://accounts.google.com/v3/signin/accountchooser").unwrap()
        ));
        assert!(should_allow_native_gis_popup(
            plaud_url,
            &Url::parse("https://accounts.google.com/signin/oauth/consent").unwrap()
        ));
        assert!(!should_allow_native_gis_popup(
            plaud_url,
            &Url::parse("https://accounts.google.com/o/oauth2/auth").unwrap()
        ));
        assert!(!should_allow_native_gis_popup(
            "https://example.com/",
            &Url::parse("about:blank").unwrap()
        ));
    }
}
