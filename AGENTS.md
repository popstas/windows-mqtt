# AGENTS Instructions

This repo contains a Node.js project for controlling a PC via MQTT, wrapped in a **Tauri v2** desktop app.

## Environment

Run `source "$HOME/.cargo/env"` before any cargo/rust commands.

## Tauri Architecture

- **Tauri v2** (not v1, not Electron). Config schema: `https://schema.tauri.app/config/2`
- Rust backend in `src-tauri/src/main.rs` — resolves an "app root" (dev: project root; bundled: `resource_dir/_up_`) via `resolve_app_root`, spawns the Node.js server from `setup()` as a child process via `tauri-plugin-shell`, and kills it gracefully on Quit (sends `app/shutdown` IPC action, then hard-kills after 800ms)
- Permissions defined in `src-tauri/capabilities/default.json` (replaces v1 `allowlist`)
- Tray icon built inside `.setup()` using `TrayIconBuilder`, with `on_menu_event` and `on_tray_icon_event` closures
- Shell commands use `app.shell().command()` (from `ShellExt` trait), NOT `tauri::api::process::Command`
- `CommandEvent::Stdout/Stderr` returns `Vec<u8>`, convert with `String::from_utf8_lossy`
- Build check: `cd src-tauri && cargo check`
- JS tests: `npm test` (`node --test test/**/*.test.js`). Pure logic only — never spawn Windows/native binaries in tests. Modules with native addons are covered by `test/native-modules.test.js`, which auto-skips where those addons aren't installed (e.g. Linux).
- JS/Rust config-path coupling: `resolveAppFile`/`resolveConfigPath` in `src/paths.js` must stay in sync with `config_candidates`/`resolve_config_path` in `src-tauri/src/main.rs` (same search order, same `config.example.yml` fallback).
- Dev run: `npm run start-tauri` or `cargo tauri dev`. The npm scripts use `scripts/tauri-wrapper.js` to ensure MSVC linker is available when running from Git Bash (vcvars64.bat is invoked before Tauri). If you see `LNK1181: cannot open input file 'kernel32.lib'`, ensure the "Desktop development with C++" workload includes the Windows 10/11 SDK.

## Deployment

`npm run deploy-local` does the whole cycle below (build installer → kill →
silent install → relaunch). The individual steps:

1. **Build** the installer: `npm run build-installer` (`npm run build` with
   `--bundles nsis`; plain `npm run build` also builds every other bundle type).
   Either also builds the `audio-watcher` sidecar and produces the NSIS
   installer at
   `src-tauri/target/release/bundle/nsis/windows-mqtt_0.0.1_x64-setup.exe`.
2. **Stop the running app together with its Node child** — the installer can't
   replace files that are in use, and killing only the parent can leave an
   orphan `node.exe`. Kill the whole tree:
   `taskkill /IM windows-mqtt.exe /T /F` (the Node child runs
   `...\windows-mqtt\_up_\src\index.js`).
3. **Run the installer silently**: `<...>_x64-setup.exe /S` (NSIS `/S` flag).
4. **Launch**: start `C:\Users\popstas\AppData\Local\windows-mqtt\windows-mqtt.exe`.

Steps 2-4 are what `npm run install-local` (`scripts/install-local.js`)
automates against the newest `*-setup.exe` in the nsis bundle dir.

For a quick module-only test without rebuilding, the installed bundle can be
hot-patched: copy the changed file into `...\windows-mqtt\_up_\src\...` (and
`bin\audio-watcher.exe` into `...\_up_\bin\`), then restart the app. An official
rebuild+install overwrites such patches.

### Tauri v2 Gotchas
- `devUrl` must be a proper URL (e.g. `http://localhost:1420`), not a relative path
- Resource globs: use `"../src/*"` + `"../src/**/*"` instead of `"../src/**"` (v2 is stricter)
- The full `bundle.resources` list (Node source + `node_modules`) lives in the base
  `tauri.conf.json`, so a plain `npx tauri build` (without `scripts/tauri-wrapper.js`)
  still produces a complete bundle. `dev` runs overlay `tauri.dev.conf.json` whose
  empty `resources` array REPLACES the base list (Tauri v2 merges configs per JSON
  Merge Patch / RFC 7396 — arrays are replaced, not appended), keeping dev out of the
  slow `node_modules`/`windows11-manager` junction walk. `scripts/tauri-wrapper.js`
  injects `--config src-tauri/tauri.dev.conf.json` only for `dev`.
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
2. Copy a `config.yml` and run `npm start` for headless mode or `npm run start-tauri` for the Tauri dev UI.
3. Explore `src/modules` to learn how features are implemented. Use `src/modules/_module.js` as a template for new modules.

## Commit Style
Use short commit messages following the Angular style (e.g. `feat(module): description`, `fix: description`). Recent history shows examples like:
```
feat(windows): reload configs
feat(tauri): add tray menu actions and hotkeys
```

## Further Tips
- Read `README.md` for details on each module and available MQTT topics.
- Review `package.json` for useful scripts such as `start-tauri` and Windows service helpers.

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

