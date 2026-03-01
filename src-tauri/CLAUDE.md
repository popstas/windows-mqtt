# Tauri Rust Backend

## Build & Check

```bash
source "$HOME/.cargo/env"
cd src-tauri && cargo check
```

## Architecture

Rust owns the MQTT connection via `mqtt_bridge.rs` (rumqttc). It communicates with the Node.js child process through **JSON-lines IPC** over stdin/stdout.

```
MQTT Broker  <-->  Rust (rumqttc)  <--stdin/stdout JSON lines-->  Node.js modules
```

The Node child is spawned with `TAURI_BRIDGE=1` env var. In this mode:
- Node's stdout sends IPC messages (subscribe/publish) to Rust
- Node's stdin receives IPC messages (message/connected/disconnected/action) from Rust
- All console output is redirected to stderr (captured as `server-log` events)

## IPC Protocol

### JS → Rust (stdout)

| type | fields |
|------|--------|
| `subscribe` | `topics: string[]` |
| `unsubscribe` | `topics: string[]` |
| `publish` | `topic, payload, options?: {retain, qos}` |

### Rust → JS (stdin)

| type | fields |
|------|--------|
| `message` | `topic, payload` |
| `connected` | — |
| `disconnected` | `reason` |
| `action` | `action` (tray menu commands) |

## Key Structs

- **`MqttBridge`** (`mqtt_bridge.rs`): Wraps rumqttc `AsyncClient`, tracks subscriptions in `HashSet`, replays them on reconnect.
- **`MqttConfig`**: host, port, username, password, client_id
- **`MqttEvent`**: Message/Connected/Disconnected — sent from event loop to main via `mpsc`
- **`IpcFromJs`** / **`IpcToJs`** (`main.rs`): Serde-tagged enums for the JSON-lines protocol

## Adding a New IPC Message Type

1. Add variant to `IpcFromJs` (JS→Rust) or `IpcToJs` (Rust→JS) in `main.rs`
2. Handle the new variant in the stdout dispatch match (for `IpcFromJs`) or construct it in `spawn_bridge_to_js_writer` (for `IpcToJs`)
3. Add corresponding handling in `src/mqtt-bridge.js` on the JS side

## Tauri v2 Patterns Used

- Managed state: `ServerState`, `BridgeState`, `AutoplaceTimer`, `HotkeyMenuItems`, etc.
- Tray icon with `TrayIconBuilder`, `on_menu_event`, `on_tray_icon_event`
- Shell plugin: `app.shell().command("node")` with `.env()` for bridge mode
- Global shortcuts via `tauri-plugin-global-shortcut`

## Reconnect Behavior

"Reconnect MQTT" tray action disconnects the Rust MQTT client. rumqttc auto-reconnects, and `MqttBridge` replays all tracked subscriptions on `ConnAck`. No Node restart needed.
