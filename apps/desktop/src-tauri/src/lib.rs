mod backend;
mod settings;

use backend::{spawn_api, spawn_web, stop_child, wait_for_ok, API_ORIGIN, WEB_ORIGIN};
use settings::{save_settings as store_settings, snapshot, SettingsInput};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

struct DesktopState {
    data_dir: PathBuf,
    backend: Mutex<Option<Child>>,
    web: Mutex<Option<Child>>,
    snapshot: Mutex<settings::ServiceSnapshot>,
    start: tokio::sync::Mutex<()>,
}

fn publish(app: &AppHandle, next: settings::ServiceSnapshot) {
    if let Some(state) = app.try_state::<DesktopState>() {
        *state
            .snapshot
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = next.clone();
    }
    let _ = app.emit("captionlab:status", &next);
}

fn stop_backend(state: &DesktopState) {
    if let Some(mut child) = state
        .backend
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
    {
        stop_child(&mut child);
    }
}

fn stop_web(state: &DesktopState) {
    if let Some(mut child) = state
        .web
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take()
    {
        stop_child(&mut child);
    }
}

async fn ensure_web(app: &AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Ok(());
    }
    let state = app.state::<DesktopState>();
    let already_running = state
        .web
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .is_some();
    if already_running {
        return Ok(());
    }
    let resource_dir = app.path().resource_dir().map_err(|error| error.to_string())?;
    let child = spawn_web(&state.data_dir, &resource_dir)?;
    *state
        .web
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(child);
    if !wait_for_ok(WEB_ORIGIN, Duration::from_secs(90)).await {
        stop_web(&state);
        return Err(
            "The local UI did not start. See the web log in the CaptionLab data folder.".into(),
        );
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(url) = WEB_ORIGIN.parse() {
            let _ = window.navigate(url);
        }
    }
    Ok(())
}

async fn restart_backend(app: AppHandle) -> Result<settings::ServiceSnapshot, String> {
    let state = app.state::<DesktopState>();
    let _guard = state.start.lock().await;
    let data_dir = state.data_dir.clone();
    publish(&app, snapshot(&data_dir, "starting", None));
    stop_backend(&state);
    let resource_dir = app.path().resource_dir().ok();
    let child = match spawn_api(&data_dir, resource_dir.as_deref()) {
        Ok(child) => child,
        Err(error) => {
            let next = snapshot(&data_dir, "error", Some(error));
            publish(&app, next.clone());
            return Ok(next);
        }
    };
    *state
        .backend
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = Some(child);
    let health = format!("{API_ORIGIN}/health");
    if wait_for_ok(&health, Duration::from_secs(90)).await {
        let next = snapshot(&data_dir, "ready", None);
        publish(&app, next.clone());
        return Ok(next);
    }
    stop_backend(&state);
    let next = snapshot(
        &data_dir,
        "error",
        Some(
            "The local API did not become ready. See the backend log in the CaptionLab data folder."
                .into(),
        ),
    );
    publish(&app, next.clone());
    Ok(next)
}

#[tauri::command]
fn get_settings(state: State<DesktopState>) -> settings::ServiceSnapshot {
    state
        .snapshot
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone()
}

#[tauri::command]
async fn save_settings(
    app: AppHandle,
    settings: SettingsInput,
) -> Result<settings::ServiceSnapshot, String> {
    let data_dir = app.state::<DesktopState>().data_dir.clone();
    store_settings(&data_dir, settings)?;
    restart_backend(app).await
}

#[tauri::command]
async fn download_export(
    app: AppHandle,
    source_url: String,
    suggested_name: Option<String>,
) -> Result<bool, String> {
    let allowed = source_url.starts_with(&format!("{API_ORIGIN}/"));
    if !allowed {
        return Err("Only local CaptionLab downloads are supported.".into());
    }
    let suggested = suggested_name.unwrap_or_else(|| "captions.webm".into());
    let file_name = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("captions.webm")
        .chars()
        .filter(|character| !matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        .take(120)
        .collect::<String>();
    let file_name = if file_name.is_empty() {
        "captions.webm".to_string()
    } else {
        file_name
    };
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("WebM video", &["webm"])
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|error| error.to_string())? else {
        return Ok(false);
    };
    let destination = path.into_path().map_err(|error| error.to_string())?;
    let response = reqwest::Client::new()
        .get(&source_url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Download failed with HTTP {}.",
            response.status()
        ));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    std::fs::write(destination, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let initial = snapshot(&data_dir, "needs-setup", None);
            app.manage(DesktopState {
                data_dir,
                backend: Mutex::new(None),
                web: Mutex::new(None),
                snapshot: Mutex::new(initial),
                start: tokio::sync::Mutex::new(()),
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = ensure_web(&handle).await {
                    let data_dir = handle.state::<DesktopState>().data_dir.clone();
                    publish(&handle, snapshot(&data_dir, "error", Some(error.clone())));
                    handle
                        .dialog()
                        .message(error)
                        .title("CaptionLab could not start")
                        .blocking_show();
                    return;
                }
                if settings::read_groq_key().is_some() {
                    let _ = restart_backend(handle).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                if let Some(state) = window.app_handle().try_state::<DesktopState>() {
                    stop_backend(&state);
                    stop_web(&state);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            download_export
        ])
        .build(tauri::generate_context!())
        .expect("error while building CaptionLab")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<DesktopState>() {
                    stop_backend(&state);
                    stop_web(&state);
                }
            }
        });
}
