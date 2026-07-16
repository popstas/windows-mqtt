# Tauri v2 Migration Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the windows-mqtt Tauri v2 desktop app start and work end-to-end (Rust MQTT bridge → Node modules → tray actions), restore the native deps removed for Node 24, and eliminate the process/memory-accumulation defects.

**Architecture:** Rust owns the MQTT connection (`rumqttc`) and spawns a Node.js child (`src/index.js`, env `TAURI_BRIDGE=1`) over JSON-lines stdin/stdout IPC. The app must resolve its "app root" (directory containing `config.yml` + `src/index.js`) differently in dev (live project root) vs bundled (`resource_dir/_up_` — Tauri v2 flattens `../` resources into `_up_/`). The Node module registry becomes lazy so one broken module can't kill the server.

**Tech Stack:** Tauri v2 (Rust), rumqttc 0.24, Node.js v24.12.0 (win32-x64), node:test (built-in, no new dev deps), @julusian/midi, @hurdlegroup/robotjs, usb@^2.

## Global Constraints

- Windows 11, Node v24.12.0, Git Bash available; cargo on PATH.
- Standalone mode (`npm start`, uses `src/mqtt.js`) MUST keep working unchanged.
- `usb` must stay `^2.18.0` — **never v3** (v3 removed `usb.on('attach')`/legacy API).
- No new npm dev-dependencies for testing — use built-in `node --test`.
- No packages requiring Visual Studio Build Tools (all three restored deps ship prebuilt win32-x64 binaries).
- Commit style: Angular (`fix(scope): ...`), per AGENTS.md. No `feat:`/`fix:` for chores.
- Rust build check: `cd src-tauri && cargo check`. Rust tests: `cd src-tauri && cargo test`.
- Out of scope (separate follow-up plan): production installer packaging (node_modules are not bundled — installed MSI cannot run the Node child; pending user decision on portable-vs-bundle strategy), README overhaul, dist//crash.log cleanup.

## Known-good facts from investigation (verified on this machine)

- Dev resources land in `src-tauri/target/debug/_up_/{config.yml, config.example.yml, commands.example.yml, src/}` — and `_up_/src` is a **stale build-time copy**; dev must use the real project root.
- `npm install @julusian/midi@^3.6.1 @hurdlegroup/robotjs@^0.12.3 usb@^2.18.0` completes in ~4s with prebuilt binaries; `@julusian/midi` enumerated real MIDI devices on this machine; all robotjs calls used by this repo (`keyTap`, `typeString`, `mouseClick`, `getMousePos`, `moveMouse`) exist in `@hurdlegroup/robotjs`.
- `src/modules/vad.js` was deleted (commit 247a969) but is still referenced by `src/modules/index.js`.
- Tray `stdinActions` names in `src/modules/windows.js` already exactly match the action strings Rust sends (`windows/autoplace` … `windows/reload`) — no changes needed there.

---

### Task 1: Lazy module registry + test infrastructure

The eager registry in `src/modules/index.js` crashes the whole Node server when any single module's `require` fails (missing native dep, deleted `vad.js`). Make it lazy; a broken module must only disable itself. Also heavy natives (sherpa-onnx via `tts.js`) must not load when the module is disabled.

**Files:**
- Create: `test/modules-registry.test.js`
- Modify: `src/modules/index.js` (full rewrite, 19 lines)
- Modify: `src/helpers.js:2` and `src/helpers.js:55-58`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `require('./src/modules')` returns `{ registry: Object<string,string>, load(name: string): Function }`. `load` throws `Error("Unknown module: <name>")` for unknown names and propagates the module's own require errors (caught by `initModules`).

- [ ] **Step 1: Add test script to package.json**

In `package.json` `"scripts"`, add:

```json
"test": "node --test test/",
```

- [ ] **Step 2: Write the failing test**

Create `test/modules-registry.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');

test('registry exposes load() and module names, without deleted vad', () => {
  const mods = require('../src/modules');
  assert.strictEqual(typeof mods.load, 'function');
  assert.ok(Object.keys(mods.registry).includes('audio'));
  assert.ok(!Object.keys(mods.registry).includes('vad'), 'vad.js was deleted, must not be referenced');
});

test('load() throws for unknown module name', () => {
  const { load } = require('../src/modules');
  assert.throws(() => load('nope'), /Unknown module/);
});

test('requiring the registry loads no module implementations (lazy)', () => {
  require('../src/modules');
  const loaded = Object.keys(require.cache).map(p => p.replace(/\\/g, '/'));
  assert.ok(!loaded.some(p => p.includes('src/modules/tts')), 'tts (sherpa-onnx) must not load eagerly');
  assert.ok(!loaded.some(p => p.includes('src/modules/midi')), 'midi must not load eagerly');
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: FAIL — `Cannot find module './vad'` thrown while requiring `../src/modules` (the eager registry blows up immediately, which is exactly the production bug).

- [ ] **Step 4: Rewrite src/modules/index.js**

Replace the entire file with:

```js
// Lazy module registry: a module's require() runs only when the module is
// enabled in config, so one broken/missing native dep can't kill the server.
const registry = {
  audio: './audio',
  clipboard: './clipboard',
  commands: './commands',
  dirwatch: './dirwatch',
  exec: './exec',
  filewatch: './filewatch',
  gpt: './gpt',
  keys: './keys',
  midi: './midi',
  mouse: './mouse',
  notify: './notify',
  obs: './obs',
  reaper: './reaper',
  tabs: './tabs',
  tts: './tts',
  windows: './windows',
};

function load(name) {
  const modulePath = registry[name];
  if (!modulePath) throw new Error(`Unknown module: ${name}`);
  return require(modulePath);
}

module.exports = { registry, load };
```

Note: `vad` is intentionally absent — `src/modules/vad.js` was deleted in commit 247a969.

- [ ] **Step 5: Update src/helpers.js to use lazy load**

Line 2, replace:

```js
const modulesRegistry = require('./modules');
```

with:

```js
const { load: loadModule } = require('./modules');
```

Lines 55-58, replace:

```js
      const mod = modulesRegistry[name];
      if (!mod) {
        throw new Error(`Unknown module: ${name}`);
      }
```

with:

```js
      const mod = loadModule(name);
```

(The surrounding `try/catch` in `initModules` already logs `Failed to load module <name>` — now it also catches require-time failures.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: PASS — 3 tests pass.

- [ ] **Step 7: Commit**

```bash
git add package.json test/modules-registry.test.js src/modules/index.js src/helpers.js
git commit -m "fix(modules): lazy module registry, drop deleted vad entry"
```

---

### Task 2: Restore native deps (midi/robotjs/usb) for Node 24

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/modules/keys.js:1`
- Modify: `src/modules/mouse.js:1`
- Modify: `src/modules/midi.js:1-4,38-66,288-314`
- Create: `test/native-modules.test.js`

**Interfaces:**
- Consumes: `load(name)` from Task 1.
- Produces: `load('keys')`, `load('mouse')`, `load('midi')` return the module factory functions without throwing on Node 24.

- [ ] **Step 1: Write the failing test**

Create `test/native-modules.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');

test('modules with native deps load on Node 24', () => {
  const { load } = require('../src/modules');
  assert.strictEqual(typeof load('keys'), 'function');
  assert.strictEqual(typeof load('mouse'), 'function');
  assert.strictEqual(typeof load('midi'), 'function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: new test FAILS with `Cannot find module 'robotjs'`.

- [ ] **Step 3: Install the replacement packages**

Run: `cd D:/projects/js/windows-mqtt && npm install @julusian/midi@^3.6.1 @hurdlegroup/robotjs@^0.12.3 usb@^2.18.0`
Expected: completes in seconds, no node-gyp compilation output. Verify prebuilds picked up:

Run: `node -e "require('@julusian/midi'); require('@hurdlegroup/robotjs'); require('usb'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: One-line require swaps in keys.js and mouse.js**

`src/modules/keys.js:1` and `src/modules/mouse.js:1`, replace:

```js
const robot = require('robotjs');
```

with:

```js
const robot = require('@hurdlegroup/robotjs');
```

All call sites (`robot.keyTap(key, mods)`, `robot.typeString(message)`, `robot.mouseClick(button)`, `robot.getMousePos()`, `robot.moveMouse(x, y)`) are API-identical in the fork — no other changes.

- [ ] **Step 5: Update midi.js requires and adapt USB detection**

`src/modules/midi.js` lines 1-4, replace:

```js
const midi = require('midi');
const usbDetect = require('usb-detection');
const debounce = require('lodash.debounce');
const robot = require('robotjs');
```

with:

```js
const midi = require('@julusian/midi');
const { usb } = require('usb');
const debounce = require('lodash.debounce');
const robot = require('@hurdlegroup/robotjs');
```

`@julusian/midi` is a drop-in for `midi` (`new midi.Input()`, `getPortCount`, `getPortName`, `openPort`, `closePort`, `isPortOpen`, `ignoreTypes`, `on('message')` all identical).

node-usb v2 has no `startMonitoring()`/`on('add:vid:pid')` — monitoring starts implicitly with the first `attach` listener, and vid/pid filtering happens in the handler via `device.deviceDescriptor.idVendor/idProduct` (numbers). Replace the whole `initDevice` function (lines 38-66) with:

```js
  function initDevice(device, input) {
    log(`midi: initDevice: ${JSON.stringify(device.portName)}`, 'debug');

    const isDeviceConfigured = device?.vid && device?.pid;

    // переподключение, когда найдено midi устройство
    if (isDeviceConfigured) {
      const vid = parseInt(device.vid, 10);
      const pid = parseInt(device.pid, 10);
      const usbListener = function (usbDevice) {
        const d = usbDevice.deviceDescriptor;
        if (d.idVendor !== vid || d.idProduct !== pid) return;
        console.log(`midi: add ${d.idVendor}:${d.idProduct}`);
        setTimeout(() => openMidi(input, device), 500);
      };
      usb.on('attach', usbListener);
      usbListeners.push({ event: 'attach', handler: usbListener });
      listenKeys(input, device);
    }
    else {
      console.log('! To find out vid, pid and portName, reconnect your midi device');
      // list all devices add
      const usbListener = function (usbDevice) {
        const d = usbDevice.deviceDescriptor;
        console.log(`add: vid ${d.idVendor}, pid ${d.idProduct}`);
        console.log('add to midi: {} section in config:');
        console.log(`vid: '${d.idVendor}',`);
        console.log(`pid: '${d.idProduct}',`);
        console.log(`portName: see "midi ports" debug log`);
      };
      usb.on('attach', usbListener);
      usbListeners.push({ event: 'attach', handler: usbListener });
    }
  }
```

In `closeMidi()` (lines 288-314), replace the USB cleanup block:

```js
    // Remove USB detection listeners
    for (const listener of usbListeners) {
      usbDetect.removeListener(listener.event, listener.handler);
    }
    usbListeners.length = 0;
    
    // Stop USB monitoring if no more listeners
    try {
      usbDetect.stopMonitoring();
    } catch (e) {
      // Ignore errors if monitoring wasn't started
    }
```

with:

```js
    // Remove USB detection listeners (node-usb stops hotplug monitoring
    // automatically when the last 'attach' listener is removed)
    for (const listener of usbListeners) {
      usb.removeListener(listener.event, listener.handler);
    }
    usbListeners.length = 0;
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: PASS — 4 tests (3 from Task 1 + 1 new).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json test/native-modules.test.js src/modules/keys.js src/modules/mouse.js src/modules/midi.js
git commit -m "fix(deps): restore midi/robotjs/usb via node24-compatible forks"
```

---

### Task 3: Rust app-root resolution (fix the startup panic)

`main.rs` joins `config.yml` / `src/index.js` directly onto `resource_dir()`, but Tauri v2 puts `../` resources under `_up_/`, and in dev the copied `_up_/src` is stale. Resolve an "app root" by probing candidates for the `src/index.js` marker: project root first (dev), then `_up_` (bundled). Also: no more silent fallback to `config.example.yml` (it silently connects to a placeholder broker), and no panic when config is missing.

**Files:**
- Modify: `src-tauri/src/main.rs:96-101` (read_mqtt_config), `:143-165` (spawn_node_server), `:312-358` (get_enabled_modules/read_enabled_modules/resolve_resource_dir), `:588-592` (setup)
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/main.rs`

**Interfaces:**
- Produces: `fn find_app_root(candidates: &[PathBuf]) -> Option<PathBuf>` (pure, tested); `fn resolve_app_root(app: &tauri::AppHandle) -> Result<PathBuf, String>` used by config reading and the Node spawn (Task 4 relies on it).

- [ ] **Step 1: Write the failing Rust test**

At the bottom of `src-tauri/src/main.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::find_app_root;

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
```

- [ ] **Step 2: Run test to verify it fails to compile**

Run: `cd D:/projects/js/windows-mqtt/src-tauri && cargo test`
Expected: compile error — `cannot find function find_app_root`.

- [ ] **Step 3: Implement find_app_root / resolve_app_root**

Replace `resolve_resource_dir` (main.rs:351-358) with:

```rust
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
    if let Ok(cwd) = std::env::current_dir() {
        if let Some(parent) = cwd.parent() {
            candidates.push(parent.to_path_buf());
        }
        candidates.push(cwd);
    }
    // Bundled: Tauri v2 flattens `../` resources into `_up_/`.
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("_up_"));
        candidates.push(resource_dir);
    }
    find_app_root(&candidates)
        .ok_or_else(|| format!("Cannot find app root (src/index.js) in {:?}", candidates))
}
```

- [ ] **Step 4: Route config reading through the app root, drop the example.yml fallback and the setup panic**

In `read_mqtt_config` (main.rs:96-101), replace:

```rust
fn read_mqtt_config(resource_dir: &PathBuf) -> Result<MqttConfig, String> {
    let config_path = resource_dir.join("config.yml");

    let content = std::fs::read_to_string(&config_path)
        .or_else(|_| std::fs::read_to_string(resource_dir.join("config.example.yml")))
        .map_err(|e| format!("Failed to read config: {}", e))?;
```

with:

```rust
fn read_mqtt_config(app_root: &PathBuf) -> Result<MqttConfig, String> {
    let config_path = app_root.join("config.yml");

    let content = std::fs::read_to_string(&config_path).map_err(|e| {
        format!(
            "Failed to read {} ({}). Copy config.example.yml to config.yml.",
            config_path.display(),
            e
        )
    })?;
```

In `read_enabled_modules` (main.rs:318-323), apply the same change (parameter rename `resource_dir` → `app_root`, remove the `.or_else(... config.example.yml ...)` fallback).

In `get_enabled_modules` (main.rs:313-316) and `spawn_node_server` (main.rs:148), replace `resolve_resource_dir(...)` calls with `resolve_app_root(...)` (spawn_node_server details in Task 4).

In `setup` (main.rs:588-592), replace:

```rust
            let resource_dir = resolve_resource_dir(&app_handle)
                .expect("failed to resolve resource directory");
            let mqtt_config =
                read_mqtt_config(&resource_dir).expect("failed to read MQTT config");
```

with (no panics — app must still open its window/tray to show the error):

```rust
            let mqtt_config = resolve_app_root(&app_handle)
                .and_then(|root| read_mqtt_config(&root))
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
```

- [ ] **Step 5: Run tests and check**

Run: `cd D:/projects/js/windows-mqtt/src-tauri && cargo test`
Expected: 2 tests pass.
Run: `cargo check`
Expected: clean (warnings about now-unused code are acceptable only if none; remove leftovers such as the old `resolve_resource_dir` if flagged).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "fix(tauri): resolve app root for dev and bundled resources"
```

---

### Task 4: Node child lifecycle — spawn in setup, no zombies, graceful shutdown

Today the Node server is spawned only when the hidden webview invokes `start_mqtt_server`, quitting leaves a zombie `node.exe` running forever (intervals, watchers, WS server — this is the main memory-accumulation mechanism across app restarts), the initial MQTT `connected` event is dropped (fires before the child exists), and module `onStop` cleanup (commit 5345a0c) never runs because Windows has no SIGTERM.

**Files:**
- Modify: `src-tauri/src/main.rs` (setup, spawn_node_server, ServerState area, quit handler, spawn_bridge_to_js_writer)
- Modify: `src/server.js:85-101` (register `app/shutdown` stdin action)
- Test: `test/stdin-handler.test.js` (new)

**Interfaces:**
- Consumes: `resolve_app_root(app)` from Task 3.
- Produces: IPC action string `"app/shutdown"` — Rust sends it on quit; JS handles it by running `cleanup()` then `process.exit(0)`. `struct MqttConnected(Arc<AtomicBool>)` managed state, kept current by the bridge writer task.

- [ ] **Step 1: Write the failing JS test for the shutdown action plumbing**

Create `test/stdin-handler.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

test('stdin-handler dispatches actions from bridge events', async () => {
  const stdinHandler = require('../src/stdin-handler');
  let called = false;
  stdinHandler.register({ 'test/action': () => { called = true; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/action');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(called, 'registered handler must run when bridge emits action');
});
```

- [ ] **Step 2: Run test to verify it passes (plumbing exists) — this pins behavior before Rust changes**

Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: PASS (this is a characterization test; it guards the contract Rust now depends on).

- [ ] **Step 3: Register the app/shutdown action in server.js**

In `src/server.js`, directly before `stdinHandler.init(isTauriBridge ? mqtt : undefined);` (line 102), add:

```js
    // Graceful shutdown requested by Tauri before it kills the child —
    // lets module onStop handlers close watchers/intervals/sockets.
    stdinHandler.register({
      'app/shutdown': async () => {
        await cleanup();
        process.exit(0);
      }
    });
```

- [ ] **Step 4: Rust — track MQTT connected state**

In `src-tauri/src/main.rs`, next to the other state structs (line ~66), add:

```rust
struct MqttConnected(Arc<std::sync::atomic::AtomicBool>);
```

In `spawn_bridge_to_js_writer`, change the signature and Connected/Disconnected arms to keep the flag current:

```rust
fn spawn_bridge_to_js_writer(
    app: tauri::AppHandle,
    mut event_rx: tokio::sync::mpsc::Receiver<MqttEvent>,
    connected: Arc<std::sync::atomic::AtomicBool>,
) {
```

Inside the match, in the `MqttEvent::Connected` arm add `connected.store(true, std::sync::atomic::Ordering::Relaxed);` as the first line, and in the `MqttEvent::Disconnected(reason)` arm add `connected.store(false, std::sync::atomic::Ordering::Relaxed);` as the first line.

- [ ] **Step 5: Rust — spawn the Node child from setup and replay connection state**

In `spawn_node_server` (main.rs:143-165), replace the resource-dir block:

```rust
    let resource_dir = resolve_resource_dir(app)?;
    let server_path = resource_dir.join("src").join("index.js");
```

with:

```rust
    let app_root = resolve_app_root(app)?;
    let server_path = app_root.join("src").join("index.js");
```

and `.current_dir(resource_dir)` with `.current_dir(app_root)`.

In `setup`, after `spawn_bridge_to_js_writer(...)` (now passing the flag), add managed state and the autostart:

```rust
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
                            // If MQTT connected before the child existed, the
                            // 'connected' IPC line was dropped — replay it.
                            let connected = autostart_handle
                                .state::<MqttConnected>()
                                .0
                                .load(std::sync::atomic::Ordering::Relaxed);
                            if connected {
                                let line = serde_json::to_string(&IpcToJs::Connected)
                                    .map(|s| s + "\n")
                                    .unwrap_or_default();
                                let _ = child.write(line.as_bytes());
                            }
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
```

(`start_mqtt_server` command stays as-is — it is already idempotent thanks to the `is_some()` guard, and remains as a manual retry hook for the UI.)

- [ ] **Step 6: Rust — graceful shutdown on quit (kill the zombie)**

Add next to `send_command`:

```rust
async fn shutdown_node(app: &tauri::AppHandle) {
    let state = app.state::<ServerState>();
    let child = state.0.lock().await.take();
    if let Some(mut child) = child {
        let msg = IpcToJs::Action {
            action: "app/shutdown".to_string(),
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
```

In the tray menu handler, replace `"quit" => app.exit(0),` with:

```rust
                        "quit" => {
                            let app_handle = app.clone();
                            tauri::async_runtime::spawn(async move {
                                shutdown_node(&app_handle).await;
                                app_handle.exit(0);
                            });
                        }
```

- [ ] **Step 7: Verify**

Run: `cd D:/projects/js/windows-mqtt/src-tauri && cargo check`
Expected: clean.
Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: all tests pass (5).

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/main.rs src/server.js test/stdin-handler.test.js
git commit -m "fix(tauri): spawn node server in setup, graceful child shutdown on quit"
```

---

### Task 5: Frontend + tauri.conf.json — global API, single tray, bounded log

**Files:**
- Modify: `src-tauri/tauri.conf.json:31-47` (app section)
- Modify: `index.html:7-44` (script block)
- Modify: `src-tauri/src/main.rs:613-620` (tray icon fallback)

**Interfaces:**
- Consumes: `start_mqtt_server` / `get_enabled_modules` commands (unchanged signatures); `server-log` event with `{message, level}` payload.

- [ ] **Step 1: tauri.conf.json — enable global API, remove the duplicate config-tray**

Replace the `"app"` section with (removes the `trayIcon` block — the tray is built in code by `TrayIconBuilder`; the config block creates a second, dead icon):

```json
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "label": "main",
        "title": "windows-mqtt",
        "width": 800,
        "height": 600,
        "resizable": true,
        "fullscreen": false,
        "visible": false
      }
    ]
  }
```

- [ ] **Step 2: index.html — v2 API paths, DOM-ready start, listen before invoke, real log cap**

Replace the `<script>` block (lines 7-44) with:

```html
    <script>
      const lines = [];

      function renderLogs() {
        const logTextarea = document.getElementById('log');
        logTextarea.value = lines.join('\n');
        logTextarea.scrollTop = logTextarea.scrollHeight;
      }

      function appendLog(message) {
        lines.push(message);
        if (lines.length > 500) lines.splice(0, lines.length - 500);
        renderLogs();
      }

      function renderEnabledModules(enabledModules) {
        const modulesList = document.getElementById('enabled-modules');
        modulesList.innerHTML = enabledModules.map(mod => `<span class="module">${mod}</span>`).join(', ');
      }

      async function start() {
        if (!window.__TAURI__) {
          appendLog('No backend detected.');
          return;
        }
        const { invoke } = window.__TAURI__.core;
        const { listen } = window.__TAURI__.event;

        // Subscribe to logs BEFORE starting the server so early lines are kept.
        await listen('server-log', (event) => {
          const payload = event.payload || {};
          const prefix = payload.level ? `[${payload.level}] ` : '';
          appendLog(`${prefix}${payload.message || ''}`.trim());
        });

        await invoke('start_mqtt_server');
        const enabledModules = await invoke('get_enabled_modules');
        renderEnabledModules(enabledModules);
      }

      window.addEventListener('DOMContentLoaded', () => {
        start().catch((e) => appendLog(`Error: ${e}`));
      });
    </script>
```

- [ ] **Step 3: main.rs — don't build the tray with an invalid 0x0 icon**

Replace (main.rs:613-620):

```rust
            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("windows-mqtt")
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .unwrap_or_else(|| tauri::image::Image::new(&[], 0, 0)),
                )
```

with:

```rust
            let mut tray_builder = TrayIconBuilder::new().menu(&menu).tooltip("windows-mqtt");
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let tray = tray_builder
```

(and keep the following `.on_menu_event(...)` chain attached to `tray_builder`'s result as it is now).

- [ ] **Step 4: Verify**

Run: `cd D:/projects/js/windows-mqtt/src-tauri && cargo check`
Expected: clean.
Run: `node scripts/prepare-frontend.js && node -e "console.log(require('fs').readFileSync('frontend/index.html','utf8').includes('__TAURI__.core') ? 'ok' : 'stale')"` (from project root)
Expected: `ok` — frontend copy regenerated.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/tauri.conf.json index.html src-tauri/src/main.rs
git commit -m "fix(tauri): expose global API, single tray icon, bounded UI log"
```

---

### Task 6: Small runtime bug fixes found during audit

**Files:**
- Modify: `src/modules/exec.js:62-71` (ssh handler ReferenceError)
- Modify: `src/helpers.js:27-29` (EventLogger has no `debug` method)

- [ ] **Step 1: Fix exec.js ssh handler (`data` is undefined — ReferenceError on any output)**

Replace lines 62-71:

```js
  async function ssh(topic, message) {
    const ssh_app = config.ssh_app || 'wt.exe ssh';

    let cmd = `${ssh_app} ${message}`;

    exec(cmd, (error, stdout, stderr) => {
      if (stdout && !data.silent) console.log(`stdout: ${stdout}`);
      if (stderr) console.error(`cmd: ${data.cmd}, stderr: ${stderr}`);
    });
  }
```

with:

```js
  async function ssh(topic, message) {
    const ssh_app = config.ssh_app || 'wt.exe ssh';

    const cmd = `${ssh_app} ${message}`;
    log(`< ${topic}: ${cmd}`);

    exec(cmd, (error, stdout, stderr) => {
      if (stdout) console.log(`stdout: ${stdout}`);
      if (stderr) console.error(`cmd: ${cmd}, stderr: ${stderr}`);
    });
  }
```

- [ ] **Step 2: Fix helpers.js Windows EventLogger call for 'debug' level**

Replace lines 27-29:

```js
  if (isWindows && process.env.NODE_ENV === 'production') {
    windowsLogger[logLevel](msg);
  }
```

with:

```js
  if (isWindows && process.env.NODE_ENV === 'production') {
    // EventLogger has info/warn/error only — map debug to info
    const method = logLevel === 'debug' ? 'info' : logLevel;
    if (typeof windowsLogger[method] === 'function') windowsLogger[method](msg);
  }
```

- [ ] **Step 3: Verify syntax and tests**

Run: `node --check src/modules/exec.js && node --check src/helpers.js && npm test`
Expected: no syntax errors; all 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/exec.js src/helpers.js
git commit -m "fix: exec ssh handler ReferenceError and event logger debug level"
```

---

### Task 7: End-to-end verification and docs update

**Files:**
- Modify: `AGENTS.md` (Tauri Architecture section), `src-tauri/CLAUDE.md` (IPC/lifecycle)

- [ ] **Step 1: Full test suites**

Run: `cd D:/projects/js/windows-mqtt && npm test`
Expected: 5/5 pass.
Run: `cd src-tauri && cargo test && cargo check`
Expected: 2/2 pass, clean check.

- [ ] **Step 2: Standalone smoke test (must keep working)**

Run in background, capture ~12s of output, then kill:

```bash
cd D:/projects/js/windows-mqtt && node src/index.js > /tmp/wmqtt-standalone.log 2>&1 &
sleep 12 && kill %1; cat /tmp/wmqtt-standalone.log
```

Expected markers in output: `windows-mqtt started`, `load module: audio` (and the other enabled modules), `Subscribe to N topics` with N > 0, **no** `Cannot find module`, and `Failed to load module` only for modules with genuinely unavailable deps (should be none among enabled ones).

- [ ] **Step 3: Tauri dev smoke test**

Run: `npm run start-tauri` (leave running).
Expected within ~1 min: app compiles, exactly ONE tray icon appears, left-click toggles the window, the window shows enabled modules and streaming `server-log` lines including `MQTT connected (Rust bridge)` and the Node module load lines.

- [ ] **Step 4: Zombie check (the memory-accumulation fix)**

While the app runs: `tasklist | grep -i node.exe | wc -l` → note count.
Quit via tray → Quit. Wait 3s.
Run: `tasklist | grep -i node.exe | wc -l`
Expected: count decreased by exactly the app's children (no lingering node.exe from the app; other unrelated node processes may exist).

- [ ] **Step 5: Tray action smoke**

Start again (`npm run start-tauri`), tray → "Place windows".
Expected: `server-log` shows `stdin: windows/autoplace` and windows get placed (windows module is enabled).

- [ ] **Step 6: Update docs to match the new architecture**

In `AGENTS.md` "Tauri Architecture" section, update the bullet about the Node spawn to:

```markdown
- Rust backend in `src-tauri/src/main.rs` — resolves an "app root" (dev: project root; bundled: `resource_dir/_up_`) via `resolve_app_root`, spawns the Node.js server from `setup()` as a child process via `tauri-plugin-shell`, and kills it gracefully on Quit (sends `app/shutdown` IPC action, then hard-kills after 800ms)
```

In `src-tauri/CLAUDE.md`, IPC table "Rust → JS", document the new action, and lifecycle:

```markdown
| `action` | `action` (tray menu commands; `app/shutdown` = graceful exit: Node runs cleanup() and exits) |
```

and append to the Reconnect Behavior section:

```markdown
## Lifecycle

- The Node child is spawned from `.setup()` (not from the webview). `start_mqtt_server` stays as an idempotent manual retry.
- On Quit, Rust sends `action: app/shutdown`, waits 800ms for module `onStop` cleanup, then kills the child — no zombie node.exe.
- If MQTT connects before the child is up, Rust replays `connected` right after spawn.
```

- [ ] **Step 7: Final commit**

```bash
git add AGENTS.md src-tauri/CLAUDE.md
git commit -m "docs: update agent docs for tauri bridge lifecycle"
```

---

## Follow-up (separate plan, needs user decision)

- **Production packaging:** bundled installs cannot run the Node child (no node_modules in resources, `node` assumed on PATH). Options: (a) portable-only — app runs from a git checkout with `npm install`, Rust reads an optional app-dir setting; (b) bundle node_modules; (c) esbuild single-file server with native deps externalized. Recommended: (a).
- Remove `../config.yml` from `bundle.resources` (secrets leak into installer, clean-clone build failure).
- Repo hygiene: delete `crash.log`, `dist/` (electron-builder leftovers), `src/daemon/`; commit `src-tauri/gen/schemas/`; commit the pending `package-lock.json` bump; update README (Electron mentions, nonexistent scripts); fix `scripts/tauri-wrapper.cmd` vswhere discovery for Build-Tools-only installs.
- Memory watch: `audio` module spawns `adjust_get_current_system_volume_vista_plus.exe` twice every 5s (config `interval: 5`) — observe RSS over hours; consider raising the interval or caching volume+mute in one call if it grows.
