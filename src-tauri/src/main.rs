#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{path::PathBuf, sync::Arc};
use tauri::{
    async_runtime::Mutex,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State, WindowEvent,
};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(Default)]
struct ServerState(Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>);

#[derive(Clone, Serialize)]
struct LogPayload {
    message: String,
    level: String,
}

fn spawn_node_server(
    app: &tauri::AppHandle,
    server_state: Arc<Mutex<Option<tauri_plugin_shell::process::CommandChild>>>,
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
        .current_dir(resource_dir)
        .spawn()
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(buf) => {
                    let line = String::from_utf8_lossy(&buf).to_string();
                    let _ = app_handle.emit(
                        "server-log",
                        LogPayload {
                            message: line,
                            level: "info".into(),
                        },
                    );
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

    Ok(child)
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

    let child = spawn_node_server(&app, state.0.clone())?;
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

fn build_tray_menu(app: &tauri::AppHandle, modules: &[String]) -> Result<Menu<tauri::Wry>, String> {
    let menu = Menu::new(app).map_err(|e| e.to_string())?;

    let show = MenuItem::with_id(app, "show", "Show App", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    menu.append(&show).map_err(|e| e.to_string())?;

    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    menu.append(&sep).map_err(|e| e.to_string())?;

    for module_name in modules {
        let item = MenuItem::with_id(
            app,
            format!("mod_{}", module_name),
            module_name.as_str(),
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        menu.append(&item).map_err(|e| e.to_string())?;
    }

    let sep2 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    menu.append(&sep2).map_err(|e| e.to_string())?;

    let reconnect = MenuItem::with_id(app, "reconnect", "Reconnect MQTT", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    menu.append(&reconnect).map_err(|e| e.to_string())?;

    let sep3 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    menu.append(&sep3).map_err(|e| e.to_string())?;

    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    menu.append(&quit).map_err(|e| e.to_string())?;

    Ok(menu)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ServerState::default())
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

            // Build tray menu with enabled modules
            let app_handle = app.handle().clone();
            let modules = resolve_resource_dir(&app_handle)
                .and_then(|dir| read_enabled_modules(&dir))
                .unwrap_or_default();

            let menu = build_tray_menu(&app_handle, &modules)
                .expect("failed to build tray menu");

            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("windows-mqtt")
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    tauri::image::Image::new(&[], 0, 0)
                }))
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "quit" => app.exit(0),
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "reconnect" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = app_handle.state::<ServerState>();
                                let mut guard = state.0.lock().await;
                                if let Some(child) = guard.take() {
                                    let _ = child.kill();
                                }
                                drop(guard);

                                match spawn_node_server(&app_handle, state.0.clone()) {
                                    Ok(child) => {
                                        let mut guard = state.0.lock().await;
                                        *guard = Some(child);
                                    }
                                    Err(err) => {
                                        let _ = app_handle.emit(
                                            "server-log",
                                            LogPayload {
                                                message: format!(
                                                    "Failed to restart server: {}",
                                                    err
                                                ),
                                                level: "error".into(),
                                            },
                                        );
                                    }
                                }
                            });
                        }
                        _ => {}
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
