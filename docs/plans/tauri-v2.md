# Migration Plan: windows-mqtt from Electron to Tauri v2

Reference project: [windows11-manager](../../) (Tauri v2 tray app with Rust MQTT, WS bridge, Node.js CLI)

## Current State

windows-mqtt already has a **hybrid Electron + Tauri v2** setup:
- `src/index-electron.js` — Electron entry (135 LOC)
- `src-tauri/src/main.rs` — Tauri v2 Rust backend (533 LOC)
- `index.html` — dual-runtime frontend (detects `window.__TAURI__` / `window.electronAPI`)
- `src/preload.js` — Electron IPC bridge
- `src/stdin-handler.js` — Tauri stdin-based command bridge

The Tauri side spawns Node.js as a child process and communicates via stdin/stdout. This works but has limitations: no native MQTT in Rust, no persistent settings UI, no proper lifecycle management.

## Target Architecture (reference: windows11-manager)

```
┌─────────────────────────────────────────────┐
│ Tauri v2 Rust Backend                       │
│  ├── MQTT client (rumqttc)                  │
│  ├── WebSocket server (tokio-tungstenite)   │
│  ├── System tray + menus                    │
│  ├── Global hotkeys                         │
│  ├── Settings (tauri-plugin-store)          │
│  ├── Logging (fern)                         │
│  └── Process management (plugin-shell)      │
├─────────────────────────────────────────────┤
│ Node.js Sidecar (business logic)            │
│  ├── Module system (18 modules)             │
│  ├── WS client ← receives MQTT commands     │
│  └── Native deps (robotjs, loudness, etc.)  │
├─────────────────────────────────────────────┤
│ Frontend (HTML/JS)                          │
│  ├── Settings window                        │
│  ├── Log viewer / dashboard                 │
│  └── Tauri invoke() for IPC                 │
└─────────────────────────────────────────────┘
```

Key change: move MQTT from Node.js to Rust, bridge commands to Node.js via WebSocket (same pattern as windows11-manager).

## Migration Phases

### Phase 1: Restructure Rust Backend (lib.rs pattern)

**Goal:** Refactor `main.rs` into modular Rust code following windows11-manager's structure.

**Files to create:**
```
src-tauri/src/
├── main.rs          # Minimal entry: calls app_lib::run()
├── lib.rs           # Core app logic, tray, setup
├── mqtt.rs          # MQTT client (rumqttc)
├── ws_server.rs     # WebSocket server bridge
└── logging.rs       # fern-based file+stdout logging
```

**Changes to `Cargo.toml`:**
```toml
[lib]
name = "app_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-global-shortcut = "2"
tauri-plugin-store = "2"          # NEW: persistent settings
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
rumqttc = "0.24"                  # NEW: native MQTT
tokio = { version = "1", features = ["rt-multi-thread", "sync", "net", "macros"] }
tokio-tungstenite = "0.24"        # NEW: WS bridge
futures-util = "0.3"              # NEW: WS streams
log = "0.4"                       # NEW: logging facade
fern = "0.7"                      # NEW: log dispatcher
chrono = "0.4"                    # NEW: timestamps
```

**Tasks:**
1. Extract current `main.rs` into `lib.rs` with `pub fn run()`
2. Create minimal `main.rs` (5 lines, like windows11-manager)
3. Add `[lib]` section to `Cargo.toml`
4. Copy and adapt `logging.rs` from windows11-manager
5. Copy and adapt `mqtt.rs` from windows11-manager (change client ID, topic structure)
6. Copy and adapt `ws_server.rs` from windows11-manager

### Phase 2: Native MQTT in Rust

**Goal:** Replace Node.js MQTT with Rust rumqttc, forward commands to Node.js via WebSocket.

**Current flow (stdin):**
```
Tauri → stdin JSON → Node.js server → module handler
```

**New flow (MQTT + WS, like windows11-manager):**
```
MQTT broker → Rust rumqttc → broadcast channel → WS server → Node.js WS client → module handler
```

**Tasks:**
1. Implement `mqtt.rs` with `MqttHandle` and `MqttStatus` enum
   - Subscribe to `{base}/#` (from config.yml `mqtt.base`)
   - Parse subtopic + payload into JSON `{command, payload}`
   - Broadcast via `tokio::sync::broadcast`
2. Implement `ws_server.rs` listening on localhost
   - Forward MQTT commands to connected WS clients
3. Create `src/ws-client.js` in Node.js side
   - Connect to Rust WS server
   - Receive command JSON, route to module handlers
   - Replace `stdin-handler.js` functionality
4. Add MQTT status polling in tray (2-second interval like windows11-manager)
5. Update tray menu: add MQTT status display item + toggle item

**Settings struct (Rust):**
```rust
pub struct Settings {
    pub mqtt_host: String,
    pub mqtt_port: u16,
    pub mqtt_user: String,
    pub mqtt_password: String,
    pub mqtt_base: String,
    pub ws_port: u16,              // default: 9722
    pub autoplace_interval: u32,
    pub autoplace_hotkey: String,  // default: "ctrl+alt+shift+p"
}
```

### Phase 3: Settings UI with tauri-plugin-store

**Goal:** Add persistent settings window, remove dependency on config.yml for connection settings.

**Tasks:**
1. Add `tauri-plugin-store` to dependencies and plugin chain
2. Implement `get_settings` / `save_settings` Tauri commands (copy pattern from windows11-manager)
3. Create `settings.html` + `settings.js` for settings form:
   - MQTT connection (host, port, user, password, base topic)
   - WebSocket bridge port
   - Autoplace hotkey selection
   - Autoplace interval
4. Implement `open_settings_window()` in Rust (dynamic window creation)
5. Add "Settings..." menu item to tray
6. Keep config.yml for module-specific settings (modules still loaded by Node.js)

**Settings hierarchy:**
- MQTT connection → Rust settings store (tauri-plugin-store)
- Module configs → config.yml (read by Node.js)

### Phase 4: Improve Tray Menu & State Management

**Goal:** Add dynamic state management and menu updates like windows11-manager.

**AppState struct:**
```rust
struct AppState {
    mqtt_running: bool,
    mqtt_handle: Option<mqtt::MqttHandle>,
    ws_handle: Option<ws_server::WsServerHandle>,
    node_child: Option<CommandChild>,
    autoplacer_running: bool,
    autoplacer_handle: Option<JoinHandle<()>>,
}
```

**Tray menu improvements:**
1. MQTT status label (updates every 2s): "MQTT: Off" / "MQTT: Connected" / "MQTT: Reconnecting"
2. Toggle MQTT button: "Start MQTT" / "Stop MQTT"
3. Dynamic autoplacer toggle
4. Module-enabled list from Node.js

**Tasks:**
1. Implement `AppState` with `Mutex` (replace current `ServerState`)
2. Add MQTT toggle (start/stop) to tray menu
3. Add MQTT status display to tray menu
4. Spawn background MQTT status poller
5. Implement `toggle_mqtt()` and `stop_mqtt_service()` following windows11-manager

### Phase 5: Graceful Lifecycle Management

**Goal:** Proper startup/shutdown sequence with cleanup.

**Startup sequence:**
1. Initialize logging
2. Load settings from store
3. Build tray menu
4. Auto-start MQTT if enabled
5. Start WS server
6. Spawn Node.js sidecar
7. Register global hotkeys

**Shutdown sequence (from windows11-manager):**
1. Force-exit watchdog (5-second timeout)
2. Kill Node.js child process
3. Stop WS server
4. Disconnect MQTT
5. Exit

**Tasks:**
1. Implement `ExitRequested` handler to prevent immediate exit
2. Add force-exit watchdog thread (5-second timeout)
3. Implement cleanup in "Exit" menu handler
4. Add system commands: Sleep, Restart, Shutdown (via shell plugin)

### Phase 6: Remove Electron Code

**Goal:** Remove all Electron-specific code and dependencies.

**Files to remove:**
- `src/index-electron.js`
- `src/preload.js`

**Files to modify:**
- `index.html` — remove `window.electronAPI` branch, keep only Tauri
- `package.json` — remove `electron`, `electron-builder`, `electron-log` deps
- `package.json` — remove `start-electron`, `build:dist` scripts
- `src/server.js` — remove `require('electron')` try/catch block
- `src/config.js` — remove electron-log integration
- `src/helpers.js` — remove electron EventLogger

**Files to keep:**
- `src/stdin-handler.js` — keep as fallback, but prefer WS client
- `src/index.js` — headless Node.js entry (still useful for Windows service mode)

**Tasks:**
1. Remove Electron detection from `index.html`
2. Remove Electron dependencies from `package.json`
3. Clean up `server.js` — remove Electron imports
4. Clean up `config.js` — remove electron-log path resolution
5. Clean up `helpers.js` — remove Windows EventLogger
6. Remove Electron build configuration from `package.json`
7. Update README.md

### Phase 7: Frontend Improvements

**Goal:** Better frontend matching windows11-manager's dashboard pattern.

**Tasks:**
1. Split `index.html` into:
   - `index.html` — log viewer (current main page, Tauri-only)
   - `settings.html` — settings form (new)
2. Add dashboard data: enabled modules list, MQTT status, connection info
3. Use `invoke()` instead of `listen()` where appropriate
4. Add CSP to tauri.conf.json

### Phase 8: Build & Distribution

**Goal:** Clean Tauri-only build pipeline.

**Tasks:**
1. Update `tauri.conf.json`:
   - Add NSIS bundle target (like windows11-manager)
   - Update `bundle.resources` to include Node.js sources
   - Add CSP security policy
2. Remove electron-builder config from `package.json`
3. Update `scripts/tauri-wrapper.js` if needed
4. Add version sync script (sync package.json → tauri.conf.json → Cargo.toml)
5. Test `npm run build:tauri` produces working installer

**Updated tauri.conf.json:**
```json
{
  "bundle": {
    "active": true,
    "targets": ["nsis"],
    "resources": [
      "../data/**",
      "../config.yml",
      "../config.example.yml",
      "../commands.example.yml",
      "../src/*",
      "../src/**/*",
      "../node_modules/**/*"
    ]
  },
  "app": {
    "withGlobalTauri": true,
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    }
  }
}
```

## Capabilities Update

```json
{
  "identifier": "default",
  "windows": ["main", "settings"],
  "permissions": [
    "core:default",
    "core:window:allow-create",
    "core:window:allow-close",
    "core:window:allow-show",
    "core:window:allow-hide",
    "core:window:allow-set-focus",
    "shell:allow-spawn",
    "shell:allow-execute",
    "shell:allow-kill",
    "shell:allow-stdin-write",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "store:default"
  ]
}
```

## Module Compatibility Notes

All 18 modules run in Node.js and don't need Rust ports. The WS bridge replaces stdin for command routing.

| Module | Native Deps | Migration Risk |
|--------|------------|----------------|
| audio | loudness | Low — pure npm |
| clipboard | clipboardy | Low — pure npm |
| commands | none | None |
| dirwatch | chokidar | None |
| exec | child_process | None |
| filewatch | chokidar | None |
| gpt | chatgpt | None |
| keys | robotjs | Medium — native rebuild |
| midi | native MIDI | Medium — native rebuild |
| mouse | robotjs | Medium — native rebuild |
| notify | node-notifier | Low |
| obs | obs-websocket-js | None |
| reaper | none | None |
| tabs | none | None |
| tts | external gtts-cli | None |
| vad | sherpa-onnx-node | High — large native dep |
| windows | windows11-manager | Medium — optional dep |

## Priority Order

1. **Phase 1** (Restructure Rust) — foundation for everything
2. **Phase 2** (Native MQTT) — core value: reliable MQTT without Node.js
3. **Phase 4** (State Management) — needed for MQTT toggle
4. **Phase 5** (Lifecycle) — needed for reliable operation
5. **Phase 6** (Remove Electron) — cleanup
6. **Phase 3** (Settings UI) — nice to have
7. **Phase 7** (Frontend) — nice to have
8. **Phase 8** (Build) — final step

Phases 1-2 and 4-5 can be done incrementally while keeping the current stdin bridge as fallback.

## Key Differences from windows11-manager

| Aspect | windows11-manager | windows-mqtt |
|--------|-------------------|--------------|
| Node.js role | CLI tool called per-action | Long-running server with module system |
| MQTT direction | External → Rust → WS → Node | External → Rust → WS → Node (same) |
| Config | tauri-plugin-store only | config.yml (modules) + store (connection) |
| Modules | None (single-purpose) | 18 modules with subscriptions |
| Process model | Short-lived node commands | Persistent node server process |
| Windows service | No | Yes (node-windows, headless mode) |

The persistent Node.js server is the main architectural difference. windows-mqtt needs a long-running Node.js process (for MQTT subscriptions, file watchers, MIDI listeners, etc.), not one-shot CLI calls.
