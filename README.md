# Control PC with MQTT

Tested on Windows 10, Windows 11 and Ubuntu Desktop 20.04

## Features (modules)
### audio
- `home/room/pc/audio/volume/set` - set volume, `0-100`
- `home/room/pc/audio/mute/set` - set mute, `0 or 1`

Publish to:

- `home/room/pc/audio/volume`
- `home/room/pc/audio/mute`
- `home/room/pc/audio/device` - default recording device name
- `home/room/pc/audio/device/playback` - default playback device name

Device names are reported event-driven by the native `audio-watcher` sidecar
(Core Audio, no PowerShell polling). Build it once with
`npm run build-audio-watcher`; `npm run build` bundles it automatically.

If the `audio-watcher` binary is missing, volume/mute still report via a
`loudness`-based polling fallback (a warning is logged, and device-name topics
are unavailable until the sidecar is present). The poll period is
`modules.audio.interval` seconds (default `5`). Setting `modules.audio.device`
to `false` only disables the device-name topics; volume/mute keep working.

### clipboard
- `home/room/pc/clipboard/set` - copy text to system clipboard

### commands
Read file commands.yml (see commands.example.yml), subscribe to topics, execute commands via exec module.

### dirwatch
Watch for changes in directories and send notifications.

### exec
- `home/room/pc/exec/cmd 'shell cmd'` - simple execute command with arguments in system shell
- `home/room/pc/exec/cmd/silent 'shell cmd'` - execute command without notifications
- `home/room/pc/exec/cmd '{"cmd" "shell cmd", "silent": true}'` - execute command without notifications
- `home/room/pc/exec/cmd '{"cmd": "shell cmd", "success_tts": "Success", "error_tts": "Error"}` - execute command with tts feedback. You can define default tts feedback in config. Set `success_tts: 'stdout'` for answer with command output
- `home/room/pc/exec/ssh user@host` - open ssh terminal

### filewatch
Watch for changes in files and send notifications.

### gpt
- `home/room/pc/gpt/ask` - send request to GPT

Publish to:

- `home/room/pc/gpt/answer` - get answer

### keys
- `home/room/pc/keys/press` - press a single key, you can pass several keys, space delimeted
- `home/room/pc/keys/press-throttled` - same, but at most once a second per key combination, for physical panel buttons that bounce
- `home/room/pc/keys/type` - type a string

Keys:

- `f1-f12`
- `enter, escape, tab, space, backspace`
- `up, down, left, right`
- `home, end, insert, delete, pageup, pagedown`
- `control, shift, alt, command`
- `audio_prev, audio_next, audio_pause`

[Full keys list](https://robotjs.io/docs/syntax#keys)

Modifiers `control|ctrl|^, shift, alt, command|cmd|win` can be used: `(ctrl+alt+win)t`

Examples:

- `(win)x up up right down` - suspend for Windows 10

### midi
Binds midi signals to exec or mqtt actions.

### mouse
- `home/room/pc/mouse/click` - click button, `left|right|middle`
- `home/room/pc/mouse/point` - move button to `x`, `y`, optional click and mouse backs, example: `400,200,left,1`
- `home/room/pc/mouse/get` - get current mouse position

### notify
- `home/room/pc/notify/notify 'message'` - simple notify
- `home/room/pc/notify/notify '{"title": "title", "msg": "msg", "app": "Planfix", "icon": "/path/to/planfix.png", "actions": ["OK"]}'` - full notify
- `home/room/pc/notify/clear 'msg text'` - clear notify on Android (for MacroDroid), you must define `config.modules.notify.clearNotificationWebhook` for this

### obs
Commands:
- `home/room/pc/obs/rec` - start recording
- `home/room/pc/obs/stop` - stop recording

Events:
- `home/room/pc/obs/state/rec` - change recording state

### reaper
- `home/room/pc/reaper/record` - start recording
- `home/room/pc/reaper/stop` - stop recording
- `home/room/pc/reaper/play` - start playing
- `home/room/pc/reaper/stop` - stop playing
- `home/room/pc/reaper/prev` - go to previous track
- `home/room/pc/reaper/next` - go to next track
- `home/room/pc/reaper/loop` - toggle loop

### tabs
Send browser tabs stats to MQTT. Requires browser extension [chrome-tabs-exporter](https://github.com/popstas/chrome-tabs-exporter).

### tts
- `tts` - TTS received message

### vad
Voice activity detection (VAD) using silero-vad.
- `home/room/pc/vad/speech` - 0/1, speech detected
- `home/room/pc/vad/start` - start
- `home/room/pc/vad/stop` - stop

### windows
- `home/room/pc/windows/autoplace` - autoplace windows with config
- `home/room/pc/windows/place '{"window":"current","fancyZones":{"monitor":1,"position":6}}'` - place window with rules
- `home/room/pc/windows/store` - store opened windows
- `home/room/pc/windows/restore` - restore windows
- `home/room/pc/windows/clear` - clear store
- `home/room/pc/windows/open '{ "apps": ["c:\\app1.exe"], "paths": ["d:\\prog"] }'` - open store
- `home/room/pc/windows/focus '{ "titleMatch": "blog.popstas.ru" }'` - focus window by title
- `home/room/pc/windows/restart` - restart PC, `nostore` for just restart, other payload for store opened windows

It's using module, https://github.com/popstas/windows11-manager, Vitrual desktop manager work only for Windows 11 now, as I am single user.

## Monitoring and logs
- Process health is sampled periodically (memory, CPU, event-loop utilization,
  handle/request counts) and published as JSON to `<mqtt.base>/sysstats`, plus
  appended to `<settings-dir>/windows-mqtt/sysstats.jsonl` (rotated at 10 MB).
  Enabled by default; configure via the top-level `monitor:` block
  (`monitor.enabled`, `monitor.interval` seconds, `monitor.topic`, `monitor.path`).
- All log output is also written to `<settings-dir>/windows-mqtt/windows-mqtt.log`
  (rotated at 5 MB) so it survives Tauri bridge mode where console output only
  reaches the webview. Set `log.enabled: false` to disable file logging.

## Bugs
- Keyboard and mouse emulation not work while `windows-mqtt` running as Windows service.
- Process not kill when exit

## Install
1. Copy [config.example.yml](config.example.yml) to `config.yml` and update MQTT credentials and module settings for your environment.

2. This script will install Windows service "windows-mqtt":
``` sh
git clone https://github.com/popstas/windows-mqtt
cd windows-mqtt
npm install
npm run install-windows
```

3. For TTS setup you should install `gTTS` (Python) and `mpg123`, see [popstas/mqtt2tts](https://github.com/popstas/mqtt2tts#requirements).

4. When building desktop apps, make sure `config.yml` is present in the project root so the tray apps can read it at runtime. It is **not** bundled into the installer (it's gitignored and holds real credentials — see "Never ship secrets in the installer" in AGENTS.md); both Electron and Tauri builds read it from disk next to the running app instead.

## Extend
1. Copy [src/modules/_module.js](src/modules/_module.js) to `src/modules/yourModuleName.js`
2. Add module options to `modules.yourModuleName` object in `src/config.js`

Module will receive  as `config` variable.

Module should return list of subscriptions on MQTT topics:
``` js
return {
  subscriptions: [
    {
      topics: [
        config.base + '/status',
        config.base + '/status/get',
      ],
      handler: onStatus
    },
  ]
}
```

## Desktop tray apps
The project includes both Electron and Tauri tray launchers. Both keep the main window hidden while exposing a tray icon for quick access to controls, but they differ in runtime requirements and packaging outputs.

### Electron
- Start the Electron tray app with `npm run start-electron` once dependencies are installed.
- Portable builds are produced with `npm run build:dist` (Electron Builder), which places artifacts under `dist/` (for example, a portable `.exe` when building on Windows).
- Electron uses the HTML UI from `index.html` for its tray popover and ships assets from the `assets/` folder via electron-builder configuration.

### Tauri (v2)
- Install the Rust toolchain (for example, `curl https://sh.rustup.rs -sSf | sh` on Unix-like systems or the Rust installer on Windows) and install the Tauri CLI (`npm install -g @tauri-apps/cli` or use the local dependency via `npm run start-tauri`).
- Requires `libwebkit2gtk-4.1-dev` on Linux (Ubuntu 24.04+ ships this; older `4.0` is not supported).
- Run the Tauri development tray with `npm run start-tauri` (or `cargo tauri dev` from `src-tauri/`) to launch the native system tray while keeping the window hidden unless explicitly shown.
- Build release bundles with `npm run build:tauri`; Tauri outputs installers and executables under `src-tauri/target/release/bundle/` (for example, `.msi` and `.exe` files on Windows).
- Extra files are bundled from `src-tauri/tauri.conf.json` under `bundle.resources`. The current configuration includes `config.example.yml`, `commands.example.yml`, `bin/*`, the `src/` module tree, `assets/`, and `node_modules/` - deliberately **not** `config.yml`, `commands.yml`, or `data/**`, which are gitignored and hold real credentials (see "Never ship secrets in the installer" in AGENTS.md). Add new paths there to ship additional assets with the Tauri build, and make sure any addition can't sweep in gitignored files.
- Shell permissions (spawning/killing the Node server) are defined in `src-tauri/capabilities/default.json`.
- Tauri uses the native system tray instead of the custom HTML popover used by Electron, so tray menus and balloon behaviors follow the host OS conventions.

### Session picker
A Raycast-style palette window listing the terminal sessions tracked by the
`windows` module's `claudeWt` feature (see `windows11-manager`'s claude-wt
tracker). It groups sessions by virtual desktop and monitor; picking one
focuses its window if it's still open, or restores it if the window is gone.
- Open it with the global hotkey (`picker.hotkey` in `config.yml`, default
  `Super+F10`), or by left-clicking the tray icon when `tray.leftClick` is set
  to `picker` (see below).
- Type to filter by session name or project path; Escape or clicking away
  dismisses it.
- Config keys (top-level in `config.yml`, see `config.example.yml`):
  - `picker.hotkey` - the global hotkey that opens the picker. Windows
    swallows some `Win+`/`Super+` combinations before they reach the app;
    change this if it never fires.
  - `tray.leftClick` - what a left click on the tray icon opens: `picker` or
    `log` (default `log`).
