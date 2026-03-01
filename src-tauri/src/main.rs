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
    Action { action: String },
}

// --- App state ---

#[derive(Default)]
struct ServerState(Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>);

struct BridgeState(Arc<MqttBridge>);

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
    let state = app.state::<ServerState>();
    let mut guard = state.0.lock().await;
    if let Some(ref mut child) = *guard {
        let msg = IpcToJs::Action {
            action: action.to_string(),
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

// --- Read MQTT config from config.yml ---

fn read_mqtt_config(resource_dir: &PathBuf) -> Result<MqttConfig, String> {
    let config_path = resource_dir.join("config.yml");

    let content = std::fs::read_to_string(&config_path)
        .or_else(|_| std::fs::read_to_string(resource_dir.join("config.example.yml")))
        .map_err(|e| format!("Failed to read config: {}", e))?;

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
    let resource_dir = resolve_resource_dir(app)?;
    let server_path = resource_dir.join("src").join("index.js");

    if !server_path.exists() {
        return Err(format!(
            "Server entry not found at {}",
            server_path.display()
        ));
    }

    let (mut rx, child) = app
        .shell()
        .command("node")
        .args([server_path.to_string_lossy().to_string()])
        .env("TAURI_BRIDGE", "1")
        .current_dir(resource_dir)
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
                    let line = String::from_utf8_lossy(&buf).to_string();
                    let _ = app_handle.emit(
                        "server-log",
                        LogPayload {
                            message: line,
                            level: "error".into(),
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let exit = payload.code.unwrap_or_default();
                    let _ = app_handle.emit(
                        "server-log",
                        LogPayload {
                            message: format!("Node server stopped with code {}", exit),
                            level: "warn".into(),
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
) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            let ipc = match event {
                MqttEvent::Message { topic, payload } => IpcToJs::Message { topic, payload },
                MqttEvent::Connected => {
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
    let child = spawn_node_server(&app, state.0.clone(), bridge.0.clone())?;
    *child_guard = Some(child);

    Ok(())
}

#[tauri::command]
async fn get_enabled_modules(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let resource_dir = resolve_resource_dir(&app)?;
    read_enabled_modules(&resource_dir)
}

fn read_enabled_modules(resource_dir: &PathBuf) -> Result<Vec<String>, String> {
    let config_path = resource_dir.join("config.yml");

    let content = std::fs::read_to_string(&config_path)
        .or_else(|_| std::fs::read_to_string(resource_dir.join("config.example.yml")))
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

fn resolve_resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .ok()
        .or_else(|| app.path().app_data_dir().ok())
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Unable to resolve resource directory".to_string())
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

    menu.append(&autoplace).map_err(m)?;
    menu.append(&store).map_err(m)?;
    menu.append(&restore).map_err(m)?;
    menu.append(&clear).map_err(m)?;
    menu.append(&open_default).map_err(m)?;
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
    if shortcut_str.is_empty() {
        return Ok(());
    }
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut_str, move |_app, _shortcut, _event| {
            let app_handle = app_clone.clone();
            tauri::async_runtime::spawn(async move {
                send_command(&app_handle, "windows/autoplace").await;
            });
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
            get_enabled_modules
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            // Hide main window on startup
            if let Some(window) = app.get_webview_window("main") {
                window.hide().ok();
            }

            let app_handle = app.handle().clone();

            // Read MQTT config and create bridge
            let resource_dir = resolve_resource_dir(&app_handle)
                .expect("failed to resolve resource directory");
            let mqtt_config =
                read_mqtt_config(&resource_dir).expect("failed to read MQTT config");

            let (bridge, event_rx) = MqttBridge::new(&mqtt_config);
            let bridge = Arc::new(bridge);
            app.manage(BridgeState(bridge.clone()));

            // Forward MQTT events to JS child
            spawn_bridge_to_js_writer(app_handle.clone(), event_rx);

            let (menu, hotkey_items, interval_items) =
                build_tray_menu(&app_handle).expect("failed to build tray menu");

            // Store menu items for later toggling
            app.manage(HotkeyMenuItems(hotkey_items));
            app.manage(IntervalMenuItems(interval_items));

            // Register default hotkey
            if let Err(e) = register_shortcut(&app_handle, "ctrl+alt+shift+p") {
                eprintln!("Failed to register default hotkey: {}", e);
            }

            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("windows-mqtt")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .unwrap_or_else(|| tauri::image::Image::new(&[], 0, 0)),
                )
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref().to_string();

                    // Window action commands
                    let action = match id.as_str() {
                        "win_autoplace" => Some("windows/autoplace"),
                        "win_store" => Some("windows/store"),
                        "win_restore" => Some("windows/restore"),
                        "win_clear" => Some("windows/clear"),
                        "win_open_default" => Some("windows/open_default"),
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
                        "quit" => app.exit(0),
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
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
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
