# AGENTS Instructions

This repo contains a Node.js project for controlling a PC via MQTT, wrapped in a **Tauri v2** desktop app.

## Environment

Run `source "$HOME/.cargo/env"` before any cargo/rust commands.

## Tauri Architecture

- **Tauri v2** (not v1, not Electron). Config schema: `https://schema.tauri.app/config/2`
- Rust backend in `src-tauri/src/main.rs` — spawns a Node.js server as a child process via `tauri-plugin-shell`
- Permissions defined in `src-tauri/capabilities/default.json` (replaces v1 `allowlist`)
- Tray icon built inside `.setup()` using `TrayIconBuilder`, with `on_menu_event` and `on_tray_icon_event` closures
- Shell commands use `app.shell().command()` (from `ShellExt` trait), NOT `tauri::api::process::Command`
- `CommandEvent::Stdout/Stderr` returns `Vec<u8>`, convert with `String::from_utf8_lossy`
- Build check: `cd src-tauri && cargo check`
- Dev run: `cargo tauri dev`

### Tauri v2 Gotchas
- `devUrl` must be a proper URL (e.g. `http://localhost:1420`), not a relative path
- Resource globs: use `"../src/*"` + `"../src/**/*"` instead of `"../src/**"` (v2 is stricter)
- `emit_all()` → `emit()`, `get_window()` → `get_webview_window()`, `path_resolver()` → `path()`
- `on_window_event` closure signature is `|window, event|` (not `|event|`)

# Pull request naming
Create name using angular commit message format.
`feat:` and `fix:` are using in CHANGELOG.md. It's a release notes for developers. Name your PRs in a way that it's easy to understand what was changed. Forbidden to use `feat:` and `fix:` prefixes for chore tasks that don't add new features or fix bugs.
Include module name in (module-name) if it's a module-related change.

Name examples:
- feat: Add 480p small preset option
- fix(compare-source): Switch to static-ffmpeg for bundled ffprobe
Look at the commit history to get more examples.

## Overview of the Code
- `src/server.js` starts the MQTT client, loads modules and subscribes to topics.
- `src/index.js` launches the server headless. Tauri spawns this as a child process from `src-tauri/src/main.rs`.
- Modules live in `src/modules`. Each module exports an async function that sets up MQTT topic subscriptions and returns `{subscriptions, ...}`.
- Configuration is loaded from `config.yml` using `src/config.js`.
- Scripts in `scripts/` install or remove the project as a Windows service.
- `index.html` and assets provide the web UI rendered in the Tauri webview.
- Example custom commands are in `commands.example.yml`.

## Getting Started
1. Run `npm install` to install dependencies.
2. Copy a `config.yml` and run `npm start` for headless mode or `npm run start-electron` for the tray UI.
3. Explore `src/modules` to learn how features are implemented. Use `src/modules/_module.js` as a template for new modules.

## Commit Style
Use short commit messages following the Angular style (e.g. `feat(module): description`, `fix: description`). Recent history shows examples like:
```
feat(windows): reload configs
fix: set electron window icon, hide menu
```

## Further Tips
- Read `README.md` for details on each module and available MQTT topics.
- Review `package.json` for useful scripts such as `start-electron` and Windows service helpers.

## Module Structure
Modules are kept in `src/modules`. Each module exports an async function with
the signature `(mqtt, config, log)`. Inside it you usually build MQTT topic
names using `config.base`, start any watchers or timers and return an object
containing:

```js
{
  subscriptions: [
    { topics: [config.base + '/status'], handler: onStatus }
  ],
  onStart,      // optional
  onStop        // optional
}
```

Handlers receive `(topic, message)` and can publish or perform actions.

## Creating a New Module
1. Copy `src/modules/_module.js` to `src/modules/yourModule.js`.
2. Add configuration for `modules.yourModule` in `config.yml` so it loads on
   start.
3. Implement your subscriptions and callbacks. Refer to the `Extend` section in
   `README.md` for a minimal example.

