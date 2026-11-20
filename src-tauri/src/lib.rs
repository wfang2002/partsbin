mod niimbot;

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};
use tauri::Manager;

const KEYCHAIN_SERVICE: &str = "PartsBin";

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>PartsBin</title>\
<body style=\"font-family:system-ui;text-align:center;padding-top:20vh\">\
<h2>PartsBin is connected</h2><p>You can close this tab and return to the app.</p>";

/// Answer one browser request and return its path and query, if it is the
/// sign-in redirect.
fn handle_redirect(stream: TcpStream) -> Option<String> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).ok()?;
    // "GET /oauth2redirect?code=...&state=... HTTP/1.1"
    let target = request_line.split_whitespace().nth(1)?.to_string();
    let is_redirect = target.starts_with("/oauth2redirect");
    let (status, body) = if is_redirect {
        ("200 OK", DONE_PAGE)
    } else {
        ("404 Not Found", "")
    };
    let mut stream = stream;
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
    is_redirect.then_some(target)
}

fn is_box_return(url: &tauri::Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("app.box.com")
        && url
            .query_pairs()
            .any(|(key, _)| key == "code" || key == "error")
}

/// Open the Box sign-in page and return the redirect URL once Box sends the browser to
/// https://app.box.com with a code or an error.
#[tauri::command]
async fn oauth_browse(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let start = tauri::Url::parse(&url).map_err(|e| e.to_string())?;
    if let Some(existing) = app.get_webview_window("box-oauth") {
        let _ = existing.destroy();
    }
    let (tx, rx) = std::sync::mpsc::channel::<Result<String, String>>();
    let nav_tx = std::sync::Mutex::new(Some(tx.clone()));
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        "box-oauth",
        tauri::WebviewUrl::External(start),
    )
    .title("Sign in to Box")
    .inner_size(480.0, 760.0)
    .on_navigation(move |nav| {
        if !is_box_return(nav) {
            return true;
        }
        if let Ok(mut slot) = nav_tx.lock() {
            if let Some(sender) = slot.take() {
                let _ = sender.send(Ok(nav.as_str().to_string()));
            }
        }
        false
    })
    .build()
    .map_err(|e| e.to_string())?;
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = tx.send(Err("Sign-in was cancelled.".to_string()));
        }
    });
    let result = tauri::async_runtime::spawn_blocking(move || {
        rx.recv()
            .unwrap_or_else(|_| Err("Sign-in was cancelled.".to_string()))
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Some(open) = app.get_webview_window("box-oauth") {
        let _ = open.destroy();
    }
    result
}

/// Wait on localhost for the browser to come back from a cloud sign-in page.
/// Returns the path and query of the redirect, e.g. "/oauth2redirect?code=...".
#[tauri::command]
async fn oauth_listen(port: u16, timeout_secs: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Browsers may resolve "localhost" to either address family.
        let mut listeners = Vec::new();
        for addr in [format!("127.0.0.1:{port}"), format!("[::1]:{port}")] {
            if let Ok(listener) = TcpListener::bind(&addr) {
                listener.set_nonblocking(true).map_err(|e| e.to_string())?;
                listeners.push(listener);
            }
        }
        if listeners.is_empty() {
            return Err(format!(
                "Port {port} is in use, so the sign-in page cannot return to PartsBin."
            ));
        }
        let deadline = Instant::now() + Duration::from_secs(timeout_secs);
        while Instant::now() < deadline {
            for listener in &listeners {
                if let Ok((stream, _)) = listener.accept() {
                    stream.set_nonblocking(false).map_err(|e| e.to_string())?;
                    if let Some(target) = handle_redirect(stream) {
                        return Ok(target);
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Timed out waiting for the sign-in to finish.".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            secret_get,
            secret_set,
            secret_delete,
            oauth_listen,
            oauth_browse,
            niimbot::niimbot_scan,
            niimbot::niimbot_connect,
            niimbot::niimbot_write,
            niimbot::niimbot_read,
            niimbot::niimbot_disconnect
        ])
        .run(tauri::generate_context!())
        .expect("error while running PartsBin");
}
