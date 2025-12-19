#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{path::PathBuf, sync::Arc};
use tauri::api::process::{Command, CommandChild, CommandEvent};
use tauri::{
    async_runtime::Mutex, CustomMenuItem, Manager, State, SystemTray, SystemTrayEvent,
    SystemTrayMenu, SystemTrayMenuItem,
};

#[derive(Default)]
struct ServerState(Arc<Mutex<Option<CommandChild>>>);

#[derive(Clone, Serialize)]
struct LogPayload {
    message: String,
    level: String,
}

#[tauri::command]
async fn start_mqtt_server(
    app: tauri::AppHandle,
    state: State<'_, ServerState>,
) -> Result<(), String> {
    let mut child_guard = state.0.lock().await;
    if child_guard.is_some() {
        return Ok(());
    }

    let resource_dir = resolve_resource_dir(&app)?;
    let server_path = resource_dir.join("src").join("index.js");

    if !server_path.exists() {
        return Err(format!(
            "Server entry not found at {}",
            server_path.display()
        ));
    }

    let (mut rx, child) = Command::new("node")
        .args([server_path.to_string_lossy().to_string()])
        .current_dir(resource_dir.clone())
        .spawn()
        .map_err(|error| error.to_string())?;
    let app_handle = app.clone();
    let server_state = state.0.clone();

    *child_guard = Some(child);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let _ = app_handle.emit_all(
                        "server-log",
                        LogPayload {
                            message: line,
                            level: "info".into(),
                        },
                    );
                }
                CommandEvent::Stderr(line) => {
                    let _ = app_handle.emit_all(
                        "server-log",
                        LogPayload {
                            message: line,
                            level: "error".into(),
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    let exit = payload.code.unwrap_or_default();
                    let _ = app_handle.emit_all(
                        "server-log",
                        LogPayload {
                            message: format!("MQTT server stopped with code {}", exit),
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

    Ok(())
}

#[tauri::command]
async fn get_enabled_modules(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let resource_dir = resolve_resource_dir(&app)?;
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
    app.path_resolver()
        .resource_dir()
        .or_else(|| app.path_resolver().app_data_dir())
        .or_else(|| std::env::current_dir().ok())
        .ok_or_else(|| "Unable to resolve resource directory".to_string())
}

fn build_tray() -> SystemTray {
    let quit = CustomMenuItem::new("quit", "Quit");
    let show = CustomMenuItem::new("show", "Show App");
    let menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);
    // Icon is loaded from tauri.conf.json systemTray.iconPath
    SystemTray::new().with_menu(menu)
}

fn handle_tray_event(app: &tauri::AppHandle, event: SystemTrayEvent) {
    match event {
        SystemTrayEvent::LeftClick { .. } => {
            if let Some(window) = app.get_window("main") {
                let is_visible = window.is_visible().unwrap_or(false);
                if is_visible {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        }
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
            "quit" => app.exit(0),
            "show" => {
                if let Some(window) = app.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {}
        },
        _ => {}
    }
}

fn main() {
    tauri::Builder::default()
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![
            start_mqtt_server,
            get_enabled_modules
        ])
        .system_tray(build_tray())
        .on_system_tray_event(|app, event| handle_tray_event(app, event))
        .setup(|app| {
            if let Some(window) = app.get_window("main") {
                window.hide().ok();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
