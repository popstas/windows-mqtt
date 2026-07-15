# Fix code-review findings before merging fix/tauri-migration-completion

## Overview
- Fix all 17 confirmed findings from the pre-merge code review of branch `fix/tauri-migration-completion` (10 major + 7 minor).
- Blockers fixed: fresh bundled install crash (no config.yml), payload-less installer from direct `tauri build`, ENOENT for script-type commands.
- Silent regressions fixed: volume/mute reporting lost without audio-watcher, username-only MQTT auth ignored, stuck audio-watcher after spawn error, unbounded sysstats growth, crash.log dir missing, lost MIDI portName hint, mislabeled multi-line error stacks.
- Minor cleanups: missing Connected replay in manual server restart, MIDI retry log spam, duplicated `windows-mqtt` settings-path segment, redundant `removeListener` override, duplicated requires, double `Date.now()` timestamp, unguarded deprecated `process._getActiveHandles`.

## Context (from discovery)
- Files involved: `src/config.js`, `src/helpers.js`, `src/index.js`, `src/monitor.js`, `src/paths.js`, `src/mqtt-bridge.js`, `src/modules/audio.js`, `src/modules/commands.js`, `src/modules/midi.js`, `src-tauri/src/main.rs`, `src-tauri/src/mqtt_bridge.rs`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.bundle.conf.json`, `scripts/tauri-wrapper.js`, `config.example.yml`.
- Tests: `npm test` runs `node --test test/**/*.test.js` (3 existing test files). Rust check: `source "$HOME/.cargo/env" && cd src-tauri && cargo check`.
- `loudness` package is still in `package.json` dependencies — usable as volume/mute fallback when the audio-watcher binary is missing.
- `tauri.bundle.conf.json` overlay exists because `tauri dev` walks `resources` globs (commit ec55945 moved them out of the base config to keep dev fast). Tauri v2 config merge REPLACES arrays, so an overlay can also empty the list.
- helpers.js already has the correct Windows-safe rotation (rmSync before renameSync); monitor.js has the broken copy.
- Rust IPC `Connected` replay exists only in the setup() autostart closure (`src-tauri/src/main.rs:744-756`), not in `start_mqtt_server` (`src-tauri/src/main.rs:340`).

## Development Approach
- **Testing approach**: Regular (code first, then tests) — matches existing project style.
- Complete each task fully before moving to the next.
- Make small, focused changes; each task maps to related findings in the same files.
- **CRITICAL: every task MUST include new/updated tests** for code changes in that task (Node code — `node --test`; Rust code — `cargo check` plus unit tests where practical).
- **CRITICAL: all tests must pass before starting next task** (`npm test`; for Rust tasks also `cargo check`).
- **CRITICAL: update this plan file when scope changes during implementation.**
- Maintain backward compatibility of config keys and MQTT topics.
- This is a Windows-targeted app developed on Linux: never spawn Windows binaries in tests; test pure logic (path building, parsing, rotation) with temp dirs.

## Testing Strategy
- **Unit tests**: required for every task; use `node --test` with temp dirs (`fs.mkdtempSync`) for file-system logic.
- No e2e framework in this project — final verification is `npm test`, `cargo check`, and a manual Windows smoke test listed in Post-Completion.

## Progress Tracking
- Mark completed items with `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix.
- Document issues/blockers with ⚠️ prefix.

## Implementation Steps

### Task 1: Add settingsDir helper and crash.log dir creation (findings: minor-3, major-8)
- [x] add `settingsDir(...segments)` helper to `src/paths.js` returning `path.join(appDataDir(), 'windows-mqtt', ...segments)`; export it
- [x] replace all hand-built `path.join(appDataDir(), 'windows-mqtt', ...)` call sites with `settingsDir(...)`: `src/paths.js:34,53,60`, `src/index.js:9`, `src/helpers.js:27`, `src/monitor.js:16`
- [x] in `src/index.js` segfault-handler block: `fs.mkdirSync` the settings dir (`recursive: true`) before `SegfaultHandler.registerHandler` (inside the existing try/catch so startup never blocks)
- [x] write tests for `settingsDir` (joins segments, respects APPDATA/XDG env overrides)
- [x] run `npm test` — must pass before next task (native-modules.test.js fails pre-existing on Linux: robotjs native dep unavailable; new paths tests pass)

### Task 2: Config fallback to config.example.yml, never-null config (finding: major-1)
- [x] in `src/config.js` `loadConfig()`: if reading `resolveAppFile('config.yml', 'CONFIG')` fails, fall back to `resolveAppFile('config.example.yml')` (bundled via tauri.bundle.conf.json) and log a clear warning to stderr that the example config is in use and where to put a real one (logic extracted to new `src/config-loader.js` for testability with injectable resolver; `src/config.js` now delegates to it)
- [x] if the example also fails, return a minimal safe default object (`{ mqtt: {}, modules: {} }`) instead of `null` so `helpers.log()` never dereferences null (also maps empty yaml document to the safe-default shape)
- [x] in `src/paths.js` `resolveAppFile`: when `envVar` is set but the file at `process.env[envVar]` does not exist, fall through to the candidate list instead of returning a nonexistent path (Rust passes CONFIG unconditionally)
- [x] write tests for loadConfig fallback chain (missing config.yml → example; both missing → safe default, no throw) using temp dirs and CONFIG env var
- [x] write tests for resolveAppFile env-var fallthrough (existing env path wins; nonexistent env path falls through)
- [x] run `npm test` — must pass before next task (6 new tests pass; native-modules.test.js fails pre-existing on Linux: robotjs native dep unavailable)

### Task 3: Make direct `tauri build` produce a complete bundle (finding: major-2)
- [x] move the `resources` list from `src-tauri/tauri.bundle.conf.json` into the base `src-tauri/tauri.conf.json` `bundle` section (correct-by-default builds)
- [x] create `src-tauri/tauri.dev.conf.json` overlay with `"bundle": { "resources": [] }` and make `scripts/tauri-wrapper.js` pass `--config src-tauri/tauri.dev.conf.json` for `dev` runs (Tauri v2 merge replaces arrays), keeping dev out of the node_modules resource walk
- [x] delete `src-tauri/tauri.bundle.conf.json` and remove the `--config` injection for `build` from `scripts/tauri-wrapper.js`; verify no other references remain (grep repo — only the new regression test references the old filename)
- [x] ⚠️ verify with Tauri v2 docs/behavior that overlay arrays replace (not append) — confirmed via official docs (https://v2.tauri.app/develop/configuration-files/): Tauri v2 merges configs per JSON Merge Patch (RFC 7396), which treats arrays as atomic — the overlay's empty `resources` array REPLACES the base list. Inversion fallback not needed.
- [x] update `AGENTS.md`/`CLAUDE.md` deployment section if the build command semantics changed (added a Tauri v2 Gotcha explaining base-config resources + dev overlay; CLAUDE.md is a symlink to AGENTS.md)
- [x] write/adjust test or script check if feasible (e.g. a test asserting tauri.conf.json contains the resource globs); otherwise verify via `node scripts/prepare-frontend.js && npx tauri build --help`-level dry check and document in plan (added `test/tauri-config.test.js`: base config has the globs, dev overlay empties them, legacy file removed)
- [x] run `npm test` — must pass before next task (3 new tests pass; native-modules.test.js fails pre-existing on Linux: robotjs native dep unavailable)

### Task 4: Script-type commands write temp files to a writable dir; dedupe requires (findings: major-3, minor-5)
- [x] in `src/modules/commands.js` `runCmds`: write `cmd.script` temp files to `os.tmpdir()` (e.g. `path.join(os.tmpdir(), 'windows-mqtt-script-...')`) instead of `path.resolve('data/...')` — cwd in a bundled app is read-only and has no `data/` (extracted to top-level `writeScriptFile` helper; cleanup timer unref'd)
- [x] guard the delayed `fs.unlinkSync` with try/catch so a missing file doesn't throw in the timer (extracted to `removeScriptFile` helper)
- [x] remove duplicated in-function `require('js-yaml')`, `require('fs')`, `require('../paths')` inside `loadYamlCommands()` — use the top-level imports (add `resolveAppFile` to the top-level paths import; parsing extracted to top-level `parseCommandsFile`)
- [x] write tests: script temp file is created under os.tmpdir() and cleaned up; loadYamlCommands still parses a commands.yml from a temp dir (`test/commands.test.js`, 6 tests)
- [x] run `npm test` — must pass before next task (6 new tests pass; native-modules.test.js fails pre-existing on Linux: robotjs native dep unavailable)

### Task 5: Audio — volume/mute must survive missing watcher and device:false; recover from spawn error (findings: major-4, major-6)
- [ ] in `src/modules/audio.js`: decouple gating — `config.device === false` / `deviceCfg.enabled === false` must only disable device-topic publishing (`publishDevice`), NOT the watcher spawn that feeds volume/mute
- [ ] when `resolveWatcherBin()` returns nothing: log a warn that explicitly mentions volume/mute reporting is affected, and start a fallback `loudness`-based polling loop (package already in dependencies) publishing volume/mute on the existing topics at `config.interval || 5` seconds; stop polling if a watcher later starts
- [ ] fix `watcher.on('error')`: clear `watcher`, reset last* state, and schedule `startWatcher` via `watcherRestartTimer` (respect `watcherStopping`; guard against double-restart when both 'error' and 'exit' fire)
- [ ] update `config.example.yml` audio section: document `interval` as the fallback polling period (or remove it if fallback is rejected during implementation — keep config and code in sync)
- [ ] write tests for the gating logic and error-handler restart scheduling (extract pure helpers if needed to avoid spawning binaries in tests)
- [ ] run `npm test` — must pass before next task

### Task 6: Rust — username-only MQTT credentials and Connected replay on manual restart (findings: major-5, minor-1)
- [ ] in `src-tauri/src/mqtt_bridge.rs:33`: set credentials when username alone is present — `if let Some(ref user) = config.username { opts.set_credentials(user, config.password.as_deref().unwrap_or("")); }`
- [ ] in `src-tauri/src/main.rs`: extract the Connected-replay block from the setup() autostart closure (lines ~744-756) into a helper and call it from `start_mqtt_server` too, so a manual "Start server" after MQTT is already connected replays the `connected` IPC line to the fresh child
- [ ] add a Rust unit test for the credentials logic if structure allows (or verify via `cargo check` + code review note)
- [ ] run `source "$HOME/.cargo/env" && cd src-tauri && cargo check` — must pass
- [ ] run `npm test` — must pass before next task

### Task 7: Shared Windows-safe log rotation for helpers.js and monitor.js (findings: major-7, minor-6)
- [ ] add `rotateFile(file, maxBytes, onWarn)` to a shared module (e.g. `src/paths.js` or new `src/log-rotate.js`): statSync size check, `rmSync(file + '.1', { force: true })` before `renameSync`, distinguish ENOENT (silent) from other errors (report via `onWarn`)
- [ ] use it in `src/helpers.js` `writeToLogFile` (replace inline rotation)
- [ ] use it in `src/monitor.js` `rotateIfNeeded` — rotation failures must produce a warn log instead of being swallowed, so sysstats.jsonl cannot grow unbounded silently
- [ ] in `src/helpers.js` `log()`: compute `Date.now()` once and derive both console and file timestamps from the same instant
- [ ] write tests for rotateFile: rotates past cap, replaces existing .1, silent on missing file, calls onWarn on rename failure (simulate via read-only dir or mock)
- [ ] run `npm test` — must pass before next task

### Task 8: MIDI — restore portName discovery, dedupe open-failure log (findings: major-9, minor-2)
- [ ] in `src/modules/midi.js` unconfigured-device attach listener: enumerate MIDI input ports right there (new `midi.Input()`, `getPortCount`/`getPortName`) and print the port list at info level (`console.log`) so the user can copy `portName:` without enabling debug
- [ ] keep the vid/pid snippet output; print `portName: '<name>'` candidates from the enumerated list
- [ ] dedupe the retry-loop failure log in `openMidi` catch branch: add an `openFailedLogged` set keyed by portNum/portName (mirroring `notFoundLogged`), clear on successful open
- [ ] write tests for the dedupe logic if extractable; otherwise cover the port-list formatting helper
- [ ] run `npm test` — must pass before next task

### Task 9: Multi-line stderr keeps its log level (finding: major-10)
- [ ] in `src/index.js` `stderrWrite`: split the joined message on `'\n'` and prefix EVERY line with `[${level}] ` before writing, so multi-line error stacks arrive in Rust `parse_stderr_log` with the correct level on each physical line
- [ ] extract the line-tagging function to a small testable helper (e.g. in `src/helpers.js` or inline export) — `src/index.js` must stay side-effect-minimal
- [ ] write tests: single-line tagging, multi-line stack tagging (every line tagged), empty message
- [ ] run `npm test` — must pass before next task

### Task 10: Remaining minors — dead override, deprecated API guard (findings: minor-4, minor-7)
- [ ] delete the redundant `removeListener(event, fn)` override in `src/mqtt-bridge.js:71-73` (pure super delegation)
- [ ] in `src/monitor.js` `sample()`: guard `process._getActiveHandles()`/`process._getActiveRequests()` with `typeof ... === 'function'` (fall back to `null` in stats) so a future Node removal of these private APIs cannot break sampling
- [ ] write/extend test for stats shape with guards applied
- [ ] run `npm test` — must pass before next task

### Task 11: Verify acceptance criteria
- [ ] re-check every finding from the review list against the code (all 17 addressed)
- [ ] run full `npm test`
- [ ] run `source "$HOME/.cargo/env" && cd src-tauri && cargo check`
- [ ] grep for leftovers: `tauri.bundle.conf.json` references, `data/windows-mqtt-script`, `appDataDir(), 'windows-mqtt'` duplicates
- [ ] verify config.example.yml matches actual config keys (audio.interval semantics)

### Task 12: [Final] Update documentation
- [ ] update `README.md` if audio fallback/polling behavior or build commands changed
- [ ] update `AGENTS.md`/`CLAUDE.md` deployment/build notes if wrapper config flags changed
- [ ] update `src-tauri/CLAUDE.md` if IPC/lifecycle notes changed (Connected replay in start_mqtt_server)

## Technical Details
- **Config fallback order** (JS, must stay in sync with Rust `resolve_config_path`): `$CONFIG` (if exists) → `<app_root>/data/config.yml` → `<settings>/windows-mqtt/config.yml` → `<app_root>/config.yml` → `config.example.yml` (same resolution) → safe default `{}`-shaped object.
- **Tauri config overlay semantics**: v2 `--config` merge replaces arrays; dev overlay `"resources": []` empties the base list. Verify before relying on it (Task 3 has an inversion fallback).
- **audio-watcher protocol**: stdout lines `kind\tvalue` where kind ∈ playback|recording|volume|mute; fallback polling must publish to the same `volumeStatTopic`/`muteStatTopic` with the same dedupe (`lastVolume`/`lastMute`).
- **rumqttc**: `set_credentials(user, pass)` accepts empty-string password; matches JS `mqtt.js` behavior of sending username without password.
- **stderr IPC**: Rust `parse_stderr_log` (`src-tauri/src/main.rs:113`) strips one `[level] ` prefix per line; fixing tagging on the JS side avoids Rust protocol changes.

## Post-Completion
*Items requiring manual intervention — no checkboxes.*

**Manual verification on Windows:**
- Fresh install test: uninstall / remove `%APPDATA%\windows-mqtt\config.yml`, run NSIS installer, confirm app starts with example config and a clear warning instead of a dead tray.
- Direct build test: `npx tauri build` (without wrapper) produces an installer whose installed app finds `src/index.js`.
- Rename `bin/audio-watcher.exe` away, restart app: volume/mute still published via loudness fallback, warn mentions volume/mute.
- MQTT broker with username-only auth: bridge connects with credentials.
- Plug in an unconfigured MIDI device: portName list printed at info level.
- Trigger a module error: multi-line stack fully labeled [error] in UI log and windows-mqtt.log.

**Deployment:** follow AGENTS.md deployment steps (build, taskkill /T, silent installer, relaunch).
