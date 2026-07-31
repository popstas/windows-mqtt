#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mqtt_bridge;

use mqtt_bridge::{MqttBridge, MqttConfig, MqttEvent};
use rumqttc::QoS;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{
    async_runtime::Mutex,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

// --- IPC protocol types ---

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
enum IpcFromJs {
    Subscribe { topics: Vec<String> },
    Unsubscribe { topics: Vec<String> },
    Publish {
        topic: String,
        payload: String,
        #[serde(default)]
        options: PublishOptions,
    },
    Event {
        name: String,
        #[serde(default)]
        payload: serde_json::Value,
    },
}

#[derive(Deserialize, Debug, Default)]
struct PublishOptions {
    #[serde(default)]
    retain: bool,
    #[serde(default)]
    qos: u8,
}

#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
enum IpcToJs {
    Message { topic: String, payload: String },
    Connected,
    Disconnected { reason: String },
    Action {
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
    },
}

// --- App state ---

#[derive(Default)]
struct ServerState(Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>);

struct BridgeState(Arc<MqttBridge>);

struct MqttConnected(Arc<std::sync::atomic::AtomicBool>);

#[derive(Clone, Serialize)]
struct LogPayload {
    message: String,
    level: String,
}

struct AutoplaceTimer(Mutex<Option<tauri::async_runtime::JoinHandle<()>>>);

struct HotkeyMenuItems(Vec<CheckMenuItem<tauri::Wry>>);
struct IntervalMenuItems(Vec<CheckMenuItem<tauri::Wry>>);
struct CurrentShortcut(Mutex<Option<String>>);

// --- Send command to JS child via IPC ---

async fn send_command(app: &tauri::AppHandle, action: &str) {
    send_command_with(app, action, None).await;
}

async fn send_command_with(
    app: &tauri::AppHandle,
    action: &str,
    payload: Option<serde_json::Value>,
) {
    let state = app.state::<ServerState>();
    let mut guard = state.0.lock().await;
    if let Some(ref mut child) = *guard {
        let msg = IpcToJs::Action {
            action: action.to_string(),
            payload,
        };
        let line = match serde_json::to_string(&msg) {
            Ok(s) => s + "\n",
            Err(_) => return,
        };
        if let Err(e) = child.write(line.as_bytes()) {
            let _ = app.emit(
                "server-log",
                LogPayload {
                    message: format!("Failed to send command '{}': {}", action, e),
                    level: "error".into(),
                },
            );
        }
    }
}

/// Show the picker centred on the monitor the cursor is on.
///
/// The `center: true` window option centres on the primary monitor, which is
/// the wrong one whenever the user is working somewhere else, so the position
/// is computed at every show.
fn show_picker(app: &tauri::AppHandle) {
    let window = match app.get_webview_window("sessions") {
        Some(w) => w,
        None => return,
    };
    if let (Ok(cursor), Ok(size)) = (app.cursor_position(), window.outer_size()) {
        if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
            let mp = monitor.position();
            let ms = monitor.size();
            let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
            // A third of the way down reads as a palette; dead centre reads as a dialog.
            let y = mp.y + (ms.height as i32 - size.height as i32) / 3;
            let _ = window.set_position(tauri::PhysicalPosition { x, y });
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("picker-shown", ());
}

fn hide_picker_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("sessions") {
        let _ = window.hide();
        let _ = window.emit("picker-hidden", ());
    }
}

#[tauri::command]
async fn picker_send(
    app: tauri::AppHandle,
    action: String,
    payload: Option<serde_json::Value>,
) {
    allow_node_foreground(&app).await;
    send_command_with(&app, &action, payload).await;
}

#[tauri::command]
fn hide_picker(app: tauri::AppHandle) {
    hide_picker_window(&app);
}

/// Hand the foreground right to the Node child.
///
/// Windows only lets the process that owns the foreground window (that is us,
/// while the picker has focus) set it — or hand that right to another process
/// explicitly. Without this the Node child's bringToTop() flashes the taskbar
/// button instead of switching.
#[cfg(windows)]
async fn allow_node_foreground(app: &tauri::AppHandle) {
    use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
    let state = app.state::<ServerState>();
    let guard = state.0.lock().await;
    if let Some(ref child) = *guard {
        let pid = child.pid();
        let result = unsafe { AllowSetForegroundWindow(pid) };
        if let Err(e) = result {
            let _ = app.emit(
                "server-log",
                LogPayload {
                    message: format!(
                        "Failed to grant foreground rights to pid {}: {}",
                        pid, e
                    ),
                    level: "error".into(),
                },
            );
        }
    }
}

#[cfg(not(windows))]
async fn allow_node_foreground(_app: &tauri::AppHandle) {}

async fn shutdown_node(app: &tauri::AppHandle) {
    let state = app.state::<ServerState>();
    let child = state.0.lock().await.take();
    if let Some(mut child) = child {
        let msg = IpcToJs::Action {
            action: "app/shutdown".to_string(),
            payload: None,
        };
        if let Ok(line) = serde_json::to_string(&msg) {
            let _ = child.write((line + "\n").as_bytes());
        }
        // Give module onStop handlers a moment to close watchers/sockets,
        // then hard-kill in case the child didn't exit on its own.
        tokio::time::sleep(Duration::from_millis(800)).await;
        let _ = child.kill();
    }
}

// Windows reports a native crash as an NTSTATUS exit code, not a signal, and
// nothing in-process can catch it: an access violation in a native addon kills
// node outright (verified — Node's process.report writes nothing for it, and
// the `segfault-handler` that used to cover this was removed because its
// unfiltered vectored exception handler reported every benign
// DBG_PRINTEXCEPTION_C as a fake SIGSEGV). The child's exit code is therefore
// the only remaining signal that a native crash happened at all, so surface it
// as an error rather than a bland "stopped with code -1073741819".
fn native_crash_reason(status: u32) -> Option<&'static str> {
    match status {
        0xC0000005 => Some("access violation"),
        0xC000001D => Some("illegal instruction"),
        0xC0000025 => Some("noncontinuable exception"),
        0xC00000FD => Some("stack overflow"),
        0xC0000374 => Some("heap corruption"),
        0xC0000409 => Some("stack buffer overrun"),
        _ => None,
    }
}

fn describe_child_exit(code: i32) -> (&'static str, String) {
    // Exit codes arrive as i32; NTSTATUS values are conventionally written
    // unsigned (0xC0000005 == -1073741819i32), so compare in u32 space.
    let status = code as u32;
    if let Some(reason) = native_crash_reason(status) {
        return (
            "error",
            format!(
                "Node server crashed in native code: {} (0x{:08X})",
                reason, status
            ),
        );
    }
    if code == 0 {
        return ("info", "Node server stopped".to_string());
    }
    ("warn", format!("Node server stopped with code {}", code))
}

fn parse_stderr_log(line: &str) -> (&'static str, String) {
    for level in ["debug", "info", "warn", "error"] {
        let tag = format!("[{level}] ");
        if let Some(rest) = line.strip_prefix(&tag) {
            return (level, rest.to_string());
        }
    }
    ("info", line.to_string())
}

// --- Read MQTT config from config.yml ---

fn read_mqtt_config(config_path: &PathBuf) -> Result<MqttConfig, String> {
    let content = std::fs::read_to_string(config_path).map_err(|e| {
        format!(
            "Failed to read {} ({}). Create it (copy config.example.yml) in the app \
             data dir, %APPDATA%\\windows-mqtt\\config.yml, or ./data/config.yml.",
            config_path.display(),
            e
        )
    })?;

    let config: serde_yaml::Value =
        serde_yaml::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let mqtt = config
        .get("mqtt")
        .ok_or_else(|| "Config does not define mqtt section".to_string())?;

    let host = mqtt
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or("localhost")
        .to_string();
    let port = mqtt
        .get("port")
        .and_then(|v| v.as_u64())
        .unwrap_or(1883) as u16;
    let username = mqtt.get("user").and_then(|v| v.as_str()).map(String::from);
    let password = mqtt
        .get("password")
        .and_then(|v| v.as_str())
        .map(String::from);

    let client_id = format!(
        "windows-mqtt-{}",
        std::env::var("COMPUTERNAME")
            .or_else(|_| std::env::var("HOSTNAME"))
            .unwrap_or_else(|_| "unknown".into())
    );

    Ok(MqttConfig {
        host,
        port,
        username,
        password,
        client_id,
    })
}

// --- Spawn Node.js child with IPC bridge ---

fn spawn_node_server(
    app: &tauri::AppHandle,
    server_state: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
    bridge: Arc<MqttBridge>,
) -> Result<tauri_plugin_shell::process::CommandChild, String> {
    let app_root = resolve_app_root(app)?;
    let server_path = app_root.join("src").join("index.js");

    if !server_path.exists() {
        return Err(format!(
            "Server entry not found at {}",
            server_path.display()
        ));
    }

    // Resolve the config path here so the Node child reads exactly the same
    // file the Rust side does (single source of truth, no drift).
    let config_path = resolve_config_path(app, &app_root);

    let (mut rx, child) = app
        .shell()
        .command("node")
        .args([server_path.to_string_lossy().to_string()])
        .env("TAURI_BRIDGE", "1")
        .env("CONFIG", config_path.to_string_lossy().to_string())
        .current_dir(app_root)
        .spawn()
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();

    // Task: read stdout from JS, dispatch IPC messages or log
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(buf) => {
                    let line = String::from_utf8_lossy(&buf).to_string();
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    // Try to parse as IPC JSON
                    match serde_json::from_str::<IpcFromJs>(trimmed) {
                        Ok(ipc) => match ipc {
                            IpcFromJs::Subscribe { topics } => {
                                bridge.subscribe(&topics).await;
                            }
                            IpcFromJs::Unsubscribe { topics } => {
                                bridge.unsubscribe(&topics).await;
                            }
                            IpcFromJs::Publish {
                                topic,
                                payload,
                                options,
                            } => {
                                let qos = match options.qos {
                                    1 => QoS::AtLeastOnce,
                                    2 => QoS::ExactlyOnce,
                                    _ => QoS::AtMostOnce,
                                };
                                bridge
                                    .publish(&topic, &payload, options.retain, qos)
                                    .await;
                            }
                            IpcFromJs::Event { name, payload } => {
                                let _ = app_handle.emit_to("sessions", &name, payload);
                            }
                        },
                        Err(_) => {
                            // Not JSON — treat as log output
                            let _ = app_handle.emit(
                                "server-log",
                                LogPayload {
                                    message: line,
                                    level: "info".into(),
                                },
                            );
                        }
                    }
                }
                CommandEvent::Stderr(buf) => {
                    // In bridge mode the child redirects ALL console output to
                    // stderr with a "[level] " tag; untagged lines (crash
                    // traces, direct stderr writes) default to "info".
                    let line = String::from_utf8_lossy(&buf).to_string();
                    let (level, message) = parse_stderr_log(&line);
                    let _ = app_handle.emit(
                        "server-log",
                        LogPayload {
                            message,
                            level: level.into(),
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let (level, message) = match payload.code {
                        Some(code) => describe_child_exit(code),
                        None => ("warn", "Node server stopped (no exit code)".to_string()),
                    };
                    let _ = app_handle.emit(
                        "server-log",
                        LogPayload {
                            message,
                            level: level.into(),
                        },
                    );
                    let mut guard = server_state.lock().await;
                    *guard = None;
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

// --- Task: forward MQTT events from Rust bridge to JS child's stdin ---

fn spawn_bridge_to_js_writer(
    app: tauri::AppHandle,
    mut event_rx: tokio::sync::mpsc::Receiver<MqttEvent>,
    connected: Arc<std::sync::atomic::AtomicBool>,
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let ipc = match event {
                MqttEvent::Message { topic, payload } => IpcToJs::Message { topic, payload },
                MqttEvent::Connected => {
                    connected.store(true, std::sync::atomic::Ordering::Relaxed);
                    let _ = app.emit(
                        "server-log",
                        LogPayload {
                            message: "MQTT connected (Rust bridge)".into(),
                            level: "info".into(),
                        },
                    );
                    IpcToJs::Connected
                }
                MqttEvent::Disconnected(reason) => {
                    connected.store(false, std::sync::atomic::Ordering::Relaxed);
                    let _ = app.emit(
                        "server-log",
                        LogPayload {
                            message: format!("MQTT disconnected: {}", reason),
                            level: "warn".into(),
                        },
                    );
                    IpcToJs::Disconnected { reason }
                }
            };

            let line = match serde_json::to_string(&ipc) {
                Ok(s) => s + "\n",
                Err(_) => continue,
            };

            let state = app.state::<ServerState>();
            let mut guard = state.0.lock().await;
            if let Some(ref mut child) = *guard {
                let _ = child.write(line.as_bytes());
            }
        }
    });
}

// If MQTT connected before the child existed, the 'connected' IPC line was
// dropped by spawn_bridge_to_js_writer (no child to write to yet) — replay it
// to the freshly spawned child so its modules see the connected state.
fn replay_connected_if_needed(
    app: &tauri::AppHandle,
    child: &mut tauri_plugin_shell::process::CommandChild,
) {
    let connected = app
        .state::<MqttConnected>()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);
    if connected {
        let line = serde_json::to_string(&IpcToJs::Connected)
            .map(|s| s + "\n")
            .unwrap_or_default();
        let _ = child.write(line.as_bytes());
    }
}

// --- Tauri commands ---

#[tauri::command]
async fn start_mqtt_server(
    app: tauri::AppHandle,
    state: State<'_, ServerState>,
) -> Result<(), String> {
    let mut child_guard = state.0.lock().await;
    if child_guard.is_some() {
        return Ok(());
    }

    let bridge = app.state::<BridgeState>();
    let mut child = spawn_node_server(&app, state.0.clone(), bridge.0.clone())?;
    replay_connected_if_needed(&app, &mut child);
    *child_guard = Some(child);

    Ok(())
}

#[tauri::command]
async fn get_enabled_modules(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let app_root = resolve_app_root(&app)?;
    let config_path = resolve_config_path(&app, &app_root);
    read_enabled_modules(&config_path)
}

fn read_enabled_modules(config_path: &PathBuf) -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|error| format!("Failed to read config: {}", error))?;

    let config: serde_yaml::Value = serde_yaml::from_str(&content)
        .map_err(|error| format!("Failed to parse config: {}", error))?;

    let modules = config
        .get("modules")
        .and_then(|value| value.as_mapping())
        .ok_or_else(|| "Config does not define modules".to_string())?;

    let mut enabled = Vec::new();
    for (name, value) in modules.iter() {
        let module_name = name
            .as_str()
            .ok_or_else(|| "Module name must be a string".to_string())?;
        let is_enabled = value
            .as_mapping()
            .and_then(|opts| opts.get(&serde_yaml::Value::from("enabled")))
            .and_then(|flag| flag.as_bool())
            .unwrap_or(true);
        if is_enabled {
            enabled.push(module_name.to_string());
        }
    }

    Ok(enabled)
}

#[derive(Debug, Clone)]
struct PickerConfig {
    hotkey: String,
    tray_left_click_picker: bool,
}

const DEFAULT_PICKER_HOTKEY: &str = "Super+F10";

/// Parsed separately from reading the file so the parsing has tests.
fn parse_picker_config(content: &str) -> PickerConfig {
    let value: serde_yaml::Value = match serde_yaml::from_str(content) {
        Ok(v) => v,
        Err(_) => serde_yaml::Value::Null,
    };
    let hotkey = value
        .get("picker")
        .and_then(|p| p.get("hotkey"))
        .and_then(|h| h.as_str())
        .unwrap_or(DEFAULT_PICKER_HOTKEY)
        .to_string();
    let tray_left_click_picker = value
        .get("tray")
        .and_then(|t| t.get("leftClick"))
        .and_then(|v| v.as_str())
        .map(|s| s == "picker")
        .unwrap_or(false);
    PickerConfig {
        hotkey,
        tray_left_click_picker,
    }
}

fn read_picker_config(config_path: &PathBuf) -> PickerConfig {
    match std::fs::read_to_string(config_path) {
        Ok(content) => parse_picker_config(&content),
        Err(_) => parse_picker_config(""),
    }
}

fn find_app_root(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|c| c.join("src").join("index.js").exists())
        .cloned()
}

fn resolve_app_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    // Dev: `tauri dev` runs the exe with cwd = src-tauri, so the project
    // root (live src/, config.yml, node_modules) is the parent dir.
    // Dev builds only: an installed exe can be launched from an arbitrary
    // cwd (e.g. inside another Node project), which must not win over the
    // bundled resources.
    if cfg!(debug_assertions) {
        if let Ok(cwd) = std::env::current_dir() {
            if let Some(parent) = cwd.parent() {
                candidates.push(parent.to_path_buf());
            }
            candidates.push(cwd);
        }
    }
    // Bundled: Tauri v2 flattens `../` resources into `_up_/`.
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("_up_"));
        candidates.push(resource_dir);
    }
    find_app_root(&candidates)
        .map(|root| strip_verbatim_prefix(&root))
        .ok_or_else(|| format!("Cannot find app root (src/index.js) in {:?}", candidates))
}

// Tauri's `resource_dir()` returns a Windows verbatim path (`\\?\C:\...`).
// Node.js's main-module resolver mishandles that prefix and dies with
// `EISDIR: illegal operation on a directory, lstat 'C:'`, so normalize the
// app root before deriving the script/config paths handed to the Node child.
fn strip_verbatim_prefix(path: &PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{}", rest))
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.clone()
    }
}

// Config search priority (must stay in sync with resolveConfigPath in
// src/config.js). First existing candidate wins; the legacy root path is the
// fallback so error messages point somewhere sensible.
fn config_candidates(app: &tauri::AppHandle, app_root: &PathBuf) -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(env_path) = std::env::var("CONFIG") {
        if !env_path.is_empty() {
            candidates.push(PathBuf::from(env_path));
        }
    }
    candidates.push(app_root.join("data").join("config.yml"));
    // Tauri v2 config_dir: %APPDATA% (Windows), ~/Library/Application Support
    // (macOS), $XDG_CONFIG_HOME or ~/.config (Linux).
    if let Ok(config_dir) = app.path().config_dir() {
        candidates.push(config_dir.join("windows-mqtt").join("config.yml"));
    }
    candidates.push(app_root.join("config.yml"));
    // Bundled example config: last resort so a fresh install (no user config.yml)
    // still yields a readable config instead of erroring. Keeps the Rust side in
    // sync with the JS config-loader fallback (src/config-loader.js).
    candidates.push(app_root.join("config.example.yml"));
    candidates
}

fn resolve_config_path(app: &tauri::AppHandle, app_root: &PathBuf) -> PathBuf {
    let candidates = config_candidates(app, app_root);
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .unwrap_or_else(|| {
            candidates
                .last()
                .cloned()
                .unwrap_or_else(|| app_root.join("config.yml"))
        })
}

// --- Tray menu ---

const HOTKEY_OPTIONS: &[(&str, &str)] = &[
    ("Ctrl+Alt+Shift+P", "ctrl+alt+shift+p"),
    ("Ctrl+Shift+P", "ctrl+shift+p"),
    ("Ctrl+Alt+P", "ctrl+alt+p"),
    ("None", ""),
];

const INTERVAL_OPTIONS: &[(&str, u64)] = &[
    ("Off", 0),
    ("30s", 30),
    ("60s", 60),
    ("120s", 120),
    ("300s", 300),
];

fn build_tray_menu(
    app: &tauri::AppHandle,
) -> Result<
    (
        Menu<tauri::Wry>,
        Vec<CheckMenuItem<tauri::Wry>>,
        Vec<CheckMenuItem<tauri::Wry>>,
    ),
    String,
> {
    let m = |e: tauri::Error| e.to_string();
    let menu = Menu::new(app).map_err(m)?;

    // Show App
    let show = MenuItem::with_id(app, "show", "Show App", true, None::<&str>).map_err(m)?;
    menu.append(&show).map_err(m)?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(m)?)
        .map_err(m)?;

    // Windows actions
    let autoplace = MenuItem::with_id(
        app,
        "win_autoplace",
        "Place windows",
        true,
        Some("Ctrl+Alt+Shift+P"),
    )
    .map_err(m)?;
    let store =
        MenuItem::with_id(app, "win_store", "Store windows", true, None::<&str>).map_err(m)?;
    let restore =
        MenuItem::with_id(app, "win_restore", "Restore windows", true, None::<&str>).map_err(m)?;
    let clear = MenuItem::with_id(app, "win_clear", "Clear stored windows", true, None::<&str>)
        .map_err(m)?;
    let open_default =
        MenuItem::with_id(app, "win_open_default", "Open default apps", true, None::<&str>)
            .map_err(m)?;
    let claude_restore = MenuItem::with_id(
        app,
        "win_claude_restore",
        "Restore claude terminals",
        true,
        None::<&str>,
    )
    .map_err(m)?;
    let claude_picker = MenuItem::with_id(
        app,
        "win_claude_picker",
        "Claude sessions…",
        true,
        None::<&str>,
    )
    .map_err(m)?;

    menu.append(&autoplace).map_err(m)?;
    menu.append(&store).map_err(m)?;
    menu.append(&restore).map_err(m)?;
    menu.append(&clear).map_err(m)?;
    menu.append(&open_default).map_err(m)?;
    menu.append(&claude_restore).map_err(m)?;
    menu.append(&claude_picker).map_err(m)?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(m)?)
        .map_err(m)?;

    // System actions
    let restart_restore = MenuItem::with_id(
        app,
        "win_restart_restore",
        "Restart with restore",
        true,
        None::<&str>,
    )
    .map_err(m)?;
    let sleep = MenuItem::with_id(app, "win_sleep", "Sleep", true, None::<&str>).map_err(m)?;
    let restart =
        MenuItem::with_id(app, "win_restart", "Restart", true, None::<&str>).map_err(m)?;
    let shutdown =
        MenuItem::with_id(app, "win_shutdown", "Shutdown", true, None::<&str>).map_err(m)?;

    menu.append(&restart_restore).map_err(m)?;
    menu.append(&sleep).map_err(m)?;
    menu.append(&restart).map_err(m)?;
    menu.append(&shutdown).map_err(m)?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(m)?)
        .map_err(m)?;

    // Config actions
    let reload =
        MenuItem::with_id(app, "win_reload", "Reload configs", true, None::<&str>).map_err(m)?;
    let reconnect =
        MenuItem::with_id(app, "reconnect", "Reconnect MQTT", true, None::<&str>).map_err(m)?;

    menu.append(&reload).map_err(m)?;
    menu.append(&reconnect).map_err(m)?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(m)?)
        .map_err(m)?;

    // Settings submenu — Hotkey
    let mut hotkey_items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
    for (i, (label, _shortcut_str)) in HOTKEY_OPTIONS.iter().enumerate() {
        let checked = i == 0;
        let item = CheckMenuItem::with_id(
            app,
            format!("hotkey_{}", i),
            *label,
            true,
            checked,
            None::<&str>,
        )
        .map_err(m)?;
        hotkey_items.push(item);
    }

    let hotkey_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = hotkey_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let hotkey_submenu = Submenu::with_id_and_items(
        app,
        "hotkey_submenu",
        "Autoplace hotkey",
        true,
        &hotkey_refs,
    )
    .map_err(m)?;

    // Settings submenu — Interval
    let mut interval_items: Vec<CheckMenuItem<tauri::Wry>> = Vec::new();
    for (i, (label, _secs)) in INTERVAL_OPTIONS.iter().enumerate() {
        let checked = i == 0;
        let item = CheckMenuItem::with_id(
            app,
            format!("interval_{}", i),
            *label,
            true,
            checked,
            None::<&str>,
        )
        .map_err(m)?;
        interval_items.push(item);
    }

    let interval_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = interval_items
        .iter()
        .map(|i| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let interval_submenu = Submenu::with_id_and_items(
        app,
        "interval_submenu",
        "Autoplace interval",
        true,
        &interval_refs,
    )
    .map_err(m)?;

    let settings_submenu = Submenu::with_id_and_items(
        app,
        "settings",
        "Settings",
        true,
        &[
            &hotkey_submenu as &dyn tauri::menu::IsMenuItem<tauri::Wry>,
            &interval_submenu as &dyn tauri::menu::IsMenuItem<tauri::Wry>,
        ],
    )
    .map_err(m)?;

    menu.append(&settings_submenu).map_err(m)?;
    menu.append(&PredefinedMenuItem::separator(app).map_err(m)?)
        .map_err(m)?;

    // Quit
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).map_err(m)?;
    menu.append(&quit).map_err(m)?;

    Ok((menu, hotkey_items, interval_items))
}

fn register_shortcut(app: &tauri::AppHandle, shortcut_str: &str) -> Result<(), String> {
    register_shortcut_action(app, shortcut_str, ShortcutAction::Autoplace)
}

#[derive(Clone, Copy)]
enum ShortcutAction {
    Autoplace,
    ShowPicker,
}

fn register_shortcut_action(
    app: &tauri::AppHandle,
    shortcut_str: &str,
    what: ShortcutAction,
) -> Result<(), String> {
    if shortcut_str.is_empty() {
        return Ok(());
    }
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut_str, move |_app, _shortcut, _event| {
            let app_handle = app_clone.clone();
            match what {
                ShortcutAction::Autoplace => {
                    tauri::async_runtime::spawn(async move {
                        send_command(&app_handle, "windows/autoplace").await;
                    });
                }
                ShortcutAction::ShowPicker => show_picker(&app_handle),
            }
        })
        .map_err(|e| e.to_string())
}

fn unregister_shortcut(app: &tauri::AppHandle, shortcut_str: &str) {
    if shortcut_str.is_empty() {
        return;
    }
    let _ = app.global_shortcut().unregister(shortcut_str);
}

// --- Main ---

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(ServerState::default())
        .manage(AutoplaceTimer(Mutex::new(None)))
        .manage(CurrentShortcut(Mutex::new(Some(
            "ctrl+alt+shift+p".to_string(),
        ))))
        .invoke_handler(tauri::generate_handler![
            start_mqtt_server,
            get_enabled_modules,
            picker_send,
            hide_picker
        ])
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            // The palette is modal by habit: clicking elsewhere dismisses it.
            WindowEvent::Focused(false) if window.label() == "sessions" => {
                let _ = window.hide();
                let _ = window.emit("picker-hidden", ());
            }
            _ => {}
        })
        .setup(|app| {
            // Hide main window on startup
            if let Some(window) = app.get_webview_window("main") {
                window.hide().ok();
            }

            let app_handle = app.handle().clone();

            // Read MQTT config and create bridge
            let mqtt_config = resolve_app_root(&app_handle)
                .and_then(|root| {
                    let config_path = resolve_config_path(&app_handle, &root);
                    read_mqtt_config(&config_path)
                })
                .unwrap_or_else(|e| {
                    eprintln!("MQTT config error: {e}");
                    let _ = app_handle.emit(
                        "server-log",
                        LogPayload {
                            message: format!("MQTT config error: {e}"),
                            level: "error".into(),
                        },
                    );
                    MqttConfig {
                        host: "localhost".into(),
                        port: 1883,
                        username: None,
                        password: None,
                        client_id: "windows-mqtt-unconfigured".into(),
                    }
                });

            let (bridge, event_rx) = MqttBridge::new(&mqtt_config);
            let bridge = Arc::new(bridge);
            app.manage(BridgeState(bridge.clone()));

            // Forward MQTT events to JS child
            let connected = Arc::new(std::sync::atomic::AtomicBool::new(false));
            app.manage(MqttConnected(connected.clone()));
            spawn_bridge_to_js_writer(app_handle.clone(), event_rx, connected.clone());

            // Start the Node server immediately — do not depend on the hidden
            // webview invoking start_mqtt_server.
            let autostart_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let state = autostart_handle.state::<ServerState>();
                let mut guard = state.0.lock().await;
                if guard.is_none() {
                    let bridge = autostart_handle.state::<BridgeState>().0.clone();
                    match spawn_node_server(&autostart_handle, state.0.clone(), bridge) {
                        Ok(mut child) => {
                            replay_connected_if_needed(&autostart_handle, &mut child);
                            *guard = Some(child);
                        }
                        Err(e) => {
                            let _ = autostart_handle.emit(
                                "server-log",
                                LogPayload {
                                    message: format!("Failed to start Node server: {e}"),
                                    level: "error".into(),
                                },
                            );
                        }
                    }
                }
            });

            let app_root = resolve_app_root(&app.handle())?;
            let picker_cfg = read_picker_config(&resolve_config_path(&app.handle(), &app_root));
            if let Err(e) = register_shortcut_action(
                &app.handle(),
                &picker_cfg.hotkey,
                ShortcutAction::ShowPicker,
            ) {
                let _ = app.handle().emit(
                    "server-log",
                    LogPayload {
                        message: format!(
                            "Picker hotkey '{}' not registered: {}",
                            picker_cfg.hotkey, e
                        ),
                        level: "warn".into(),
                    },
                );
            }
            app.manage(picker_cfg);

            let (menu, hotkey_items, interval_items) =
                build_tray_menu(&app_handle).expect("failed to build tray menu");

            // Store menu items for later toggling
            app.manage(HotkeyMenuItems(hotkey_items));
            app.manage(IntervalMenuItems(interval_items));

            // Register default hotkey. On `tauri dev` hot-reload (and any relaunch
            // while a previous tray-resident instance is still tearing down) the old
            // process briefly still owns the global shortcut, so a single attempt
            // loses it for the whole session. Retry off-thread until the old owner
            // releases it, without blocking startup.
            let hotkey_handle = app_handle.clone();
            std::thread::spawn(move || {
                const SHORTCUT: &str = "ctrl+alt+shift+p";
                const ATTEMPTS: u32 = 10;
                for attempt in 1..=ATTEMPTS {
                    // Clear any stale registration owned by this process first.
                    unregister_shortcut(&hotkey_handle, SHORTCUT);
                    match register_shortcut(&hotkey_handle, SHORTCUT) {
                        Ok(()) => return,
                        Err(e) if attempt == ATTEMPTS => {
                            eprintln!(
                                "Failed to register default hotkey after {ATTEMPTS} attempts: {e}"
                            );
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(300)),
                    }
                }
            });

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                // Left click toggles the window (handled in on_tray_icon_event);
                // the context menu is reserved for right click.
                .show_menu_on_left_click(false)
                .tooltip("windows-mqtt");
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let tray = tray_builder
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref().to_string();

                    if id == "win_claude_picker" {
                        show_picker(app);
                        return;
                    }

                    // Window action commands
                    let action = match id.as_str() {
                        "win_autoplace" => Some("windows/autoplace"),
                        "win_store" => Some("windows/store"),
                        "win_restore" => Some("windows/restore"),
                        "win_clear" => Some("windows/clear"),
                        "win_open_default" => Some("windows/open_default"),
                        "win_claude_restore" => Some("windows/claude-restore"),
                        "win_restart_restore" => Some("windows/restart_restore"),
                        "win_sleep" => Some("windows/sleep"),
                        "win_restart" => Some("windows/restart"),
                        "win_shutdown" => Some("windows/shutdown"),
                        "win_reload" => Some("windows/reload"),
                        _ => None,
                    };

                    if let Some(action) = action {
                        let app_handle = app.clone();
                        let action = action.to_string();
                        tauri::async_runtime::spawn(async move {
                            send_command(&app_handle, &action).await;
                        });
                        return;
                    }

                    match id.as_str() {
                        "quit" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                shutdown_node(&app_handle).await;
                                app_handle.exit(0);
                            });
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "reconnect" => {
                            // Reconnect Rust MQTT bridge (no need to restart Node)
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let bridge_state = app_handle.state::<BridgeState>();
                                bridge_state.0.disconnect().await;
                                let _ = app_handle.emit(
                                    "server-log",
                                    LogPayload {
                                        message: "MQTT reconnecting (Rust bridge)...".into(),
                                        level: "info".into(),
                                    },
                                );
                                // rumqttc will auto-reconnect after disconnect
                            });
                        }
                        _ => {
                            // Hotkey selection
                            if let Some(idx_str) = id.strip_prefix("hotkey_") {
                                if let Ok(idx) = idx_str.parse::<usize>() {
                                    let hotkey_items = app.state::<HotkeyMenuItems>();
                                    for (i, item) in hotkey_items.0.iter().enumerate() {
                                        let _ = item.set_checked(i == idx);
                                    }
                                    let app_handle = app.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let current = app_handle.state::<CurrentShortcut>();
                                        let mut guard = current.0.lock().await;
                                        if let Some(ref old) = *guard {
                                            unregister_shortcut(&app_handle, old);
                                        }
                                        let new_shortcut = HOTKEY_OPTIONS[idx].1.to_string();
                                        if !new_shortcut.is_empty() {
                                            if let Err(e) =
                                                register_shortcut(&app_handle, &new_shortcut)
                                            {
                                                let _ = app_handle.emit(
                                                    "server-log",
                                                    LogPayload {
                                                        message: format!(
                                                            "Failed to register hotkey: {}",
                                                            e
                                                        ),
                                                        level: "error".into(),
                                                    },
                                                );
                                            }
                                        }
                                        *guard = Some(new_shortcut);
                                    });
                                }
                            }

                            // Interval selection
                            if let Some(idx_str) = id.strip_prefix("interval_") {
                                if let Ok(idx) = idx_str.parse::<usize>() {
                                    let interval_items = app.state::<IntervalMenuItems>();
                                    for (i, item) in interval_items.0.iter().enumerate() {
                                        let _ = item.set_checked(i == idx);
                                    }
                                    let secs = INTERVAL_OPTIONS[idx].1;
                                    let app_handle = app.clone();
                                    tauri::async_runtime::spawn(async move {
                                        let timer_state =
                                            app_handle.state::<AutoplaceTimer>();
                                        let mut guard = timer_state.0.lock().await;
                                        if let Some(handle) = guard.take() {
                                            handle.abort();
                                        }
                                        if secs > 0 {
                                            let app_for_timer = app_handle.clone();
                                            let duration = Duration::from_secs(secs);
                                            let handle =
                                                tauri::async_runtime::spawn(async move {
                                                    loop {
                                                        tokio::time::sleep(duration).await;
                                                        send_command(
                                                            &app_for_timer,
                                                            "windows/autoplace",
                                                        )
                                                        .await;
                                                    }
                                                });
                                            *guard = Some(handle);
                                        }
                                    });
                                }
                            }
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // A physical click emits `Click` twice (Down then Up); react to
                    // a single edge so the toggle doesn't fire twice and cancel out.
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let opens_picker = app
                            .try_state::<PickerConfig>()
                            .map(|cfg| cfg.tray_left_click_picker)
                            .unwrap_or(false);
                        if opens_picker {
                            let visible = app
                                .get_webview_window("sessions")
                                .and_then(|w| w.is_visible().ok())
                                .unwrap_or(false);
                            if visible {
                                hide_picker_window(app);
                            } else {
                                show_picker(app);
                            }
                        } else if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Keep tray alive by storing in managed state
            app.manage(tray);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{describe_child_exit, find_app_root};
    use super::parse_picker_config;

    #[test]
    fn picker_config_falls_back_to_defaults() {
        let cfg = parse_picker_config("modules:\n  windows:\n    claudeWt: true\n");
        assert_eq!(cfg.hotkey, "Super+F10");
        assert!(!cfg.tray_left_click_picker);
    }

    #[test]
    fn picker_config_reads_hotkey_and_tray_choice() {
        let cfg = parse_picker_config("picker:\n  hotkey: 'Ctrl+Alt+J'\ntray:\n  leftClick: picker\n");
        assert_eq!(cfg.hotkey, "Ctrl+Alt+J");
        assert!(cfg.tray_left_click_picker);
    }

    #[test]
    fn picker_config_treats_any_other_tray_choice_as_log() {
        let cfg = parse_picker_config("tray:\n  leftClick: log\n");
        assert!(!cfg.tray_left_click_picker);
    }

    #[test]
    fn picker_config_survives_broken_yaml() {
        let cfg = parse_picker_config("\t\tnot: [valid");
        assert_eq!(cfg.hotkey, "Super+F10");
    }

    #[test]
    fn reports_access_violation_as_a_native_crash_error() {
        // 0xC0000005 arrives as a negative i32 from the OS.
        let (level, message) = describe_child_exit(-1073741819);
        assert_eq!(level, "error");
        assert!(message.contains("crashed in native code"), "{}", message);
        assert!(message.contains("access violation"), "{}", message);
        assert!(message.contains("0xC0000005"), "{}", message);
    }

    #[test]
    fn reports_stack_overflow_and_heap_corruption_as_native_crashes() {
        for code in [0xC00000FDu32, 0xC0000374, 0xC0000409] {
            let (level, message) = describe_child_exit(code as i32);
            assert_eq!(level, "error", "{}", message);
            assert!(message.contains("crashed in native code"), "{}", message);
        }
    }

    #[test]
    fn clean_exit_is_info_not_a_crash() {
        let (level, message) = describe_child_exit(0);
        assert_eq!(level, "info");
        assert!(!message.contains("crashed"), "{}", message);
    }

    #[test]
    fn ordinary_nonzero_exit_stays_a_plain_warn() {
        let (level, message) = describe_child_exit(1);
        assert_eq!(level, "warn");
        assert_eq!(message, "Node server stopped with code 1");
    }

    #[test]
    fn finds_first_candidate_containing_src_index_js() {
        let base = std::env::temp_dir().join("wmqtt-approot-test");
        let src = base.join("src");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("index.js"), "").unwrap();
        let missing = std::env::temp_dir().join("wmqtt-approot-missing");

        let found = find_app_root(&[missing, base.clone()]);
        assert_eq!(found, Some(base.clone()));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn returns_none_when_no_candidate_matches() {
        let missing = std::env::temp_dir().join("wmqtt-approot-none");
        assert_eq!(find_app_root(&[missing]), None);
    }
}
