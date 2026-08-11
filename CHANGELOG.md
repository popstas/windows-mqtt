## Unreleased

**claude-wt, the session picker window and Home Assistant export moved out**
of this repo entirely — into `windows11-manager` and `ccfzf-picker`. Removed:
`src/modules/windows.js`, `src/modules/claude-wt-watchdog.js`,
`src/homeassistant/`, `src/picker/`, `frontend-src/` and `sessions.html` (the
in-app palette window), plus their tests. This was already dead code in the
live config (`modules.windows.enabled: false`): the whole point was to free
`Ctrl+F11`/`Ctrl+F12` and the picker's own hotkey, which `windows.js` kept
losing the registration race for even though nothing here still handled them.

The one behavioral change: `power`'s **enablement** no longer shares the
`modules.windows.enabled` flag with the now-deleted `windows.js` — that
interlock existed only so the two wouldn't both answer `windows/restart`.
With `windows.js` gone, `power` is enabled the same way any other module is
(its own `enabled` key, default on) — live behavior is unchanged, since it
was already on. Its **MQTT topic base stays the historical one**,
`<mqtt.base>/windows` rather than `<mqtt.base>/power` — that part is kept
intentionally, not an oversight: physical buttons, the panel and the openHASP
config all still address the old `windows/restart` topic, and moving them is
separate work in another repo.

# 1.0.0 (2026-07-16)

First tagged release. The app moved from Electron to **Tauri v2**, which is the
reason this is 1.0.0 rather than another 0.0.1 patch.

**Highlights**

- **Tauri v2 desktop app** replaces the Electron shell. A Rust backend owns the
  MQTT connection (rumqttc) and talks to the Node.js modules over JSON-lines IPC
  on stdin/stdout. Tray icon, hotkeys and graceful shutdown live in Rust.
- **Config and user data moved out of the app payload** into
  `%APPDATA%\windows-mqtt\`. Installers no longer ship a `config.yml`, and a
  missing config now falls back to the bundled example with a clear warning
  instead of a dead tray.
- **Volume/mute reporting** is event-driven via a native `audio-watcher`
  sidecar, with a `loudness` polling fallback when the sidecar is absent.
- **Logs persist to disk**: `windows-mqtt.log` (rotated at 5 MB) and
  `sysstats.jsonl` telemetry, so a crash no longer takes the log with it.
- **Node 24 support** via updated native forks (midi, robotjs, usb).

**Known gaps**

- Native-addon crashes are reported by exit code only, without a stack trace.
  `segfault-handler` was removed because it reported benign Windows debug-print
  exceptions as fake segfaults; `process.report` does not cover native crashes.

Everything below is the full conventional-commit history, which had no prior
tags to split on — so it spans the project's entire life, Electron era included.

### Bug Fixes

* address code review findings ([4448f9e](https://github.com/popstas/windows-mqtt/commit/4448f9eff0aec9ebb4f46c53310f39feeb5dbd2d))
* address codex review findings ([ae6935f](https://github.com/popstas/windows-mqtt/commit/ae6935f211918e853acf428a3acb639524dd7204))
* better logging, electronLog.log replaced console.log ([cef1b9c](https://github.com/popstas/windows-mqtt/commit/cef1b9c89a80d0788436e7e7acb9d627ff361e53))
* change winMan.placeWindows output format ([de39fcc](https://github.com/popstas/windows-mqtt/commit/de39fcc45c2d3959093e0f496651fa194f593e9d))
* close midi port when paused ([6784257](https://github.com/popstas/windows-mqtt/commit/678425718853df0755aea87af9bdbbf757b15a8c))
* **deps:** restore midi/robotjs/usb via node24-compatible forks ([fcf6353](https://github.com/popstas/windows-mqtt/commit/fcf635399be866fe923488933f655ce676f13767))
* disable systray debug ([8696a09](https://github.com/popstas/windows-mqtt/commit/8696a0937c2b6c9ead1fd8127068856d225fdead))
* drop segfault-handler false crashes and stale bundle files ([433b598](https://github.com/popstas/windows-mqtt/commit/433b598a7f2af920ee92ab932d5eae8e0f26fa3f))
* exec ssh handler ReferenceError and event logger debug level ([423aa31](https://github.com/popstas/windows-mqtt/commit/423aa31d760c707702db829a15cd7db96f711b92))
* fix service, add config.example.yml ([c2cf572](https://github.com/popstas/windows-mqtt/commit/c2cf572e63e772c2c2b3946c98ea8c50c9059e36))
* guard deprecated process handle APIs and drop dead removeListener override ([9a7c953](https://github.com/popstas/windows-mqtt/commit/9a7c953d0de3afc67f9c9fe90b274e9e8bad9cf4))
* **log:** carry log level through bridge stderr instead of flagging all as error ([aebe5a3](https://github.com/popstas/windows-mqtt/commit/aebe5a357b00098aaeb5dc05849ec1cae98400d2))
* make woking electron-builder version ([d97aca3](https://github.com/popstas/windows-mqtt/commit/d97aca365959a57cbe43e627804e160b6f1fc24a))
* make working on linux ([4bee682](https://github.com/popstas/windows-mqtt/commit/4bee6827a3c9877cf9028a910ffeb2146e90bbad))
* **memory:** prevent memory leaks ([5345a0c](https://github.com/popstas/windows-mqtt/commit/5345a0ce2775d9b23576be4ce269827282b2f8ae))
* **midi:** better console output for detect new device ([2c0427b](https://github.com/popstas/windows-mqtt/commit/2c0427b1bf2b425606f67c74488889ab5a6ee848))
* **midi:** config helpers ([fdf331b](https://github.com/popstas/windows-mqtt/commit/fdf331bb854e407a2d043bfa7226a0480873ab06))
* **midi:** fix usb device, robotjs ([d2274e2](https://github.com/popstas/windows-mqtt/commit/d2274e2ab5a5754dc46efb7484e80404c0a81faa))
* **midi:** open port error handler ([12b74aa](https://github.com/popstas/windows-mqtt/commit/12b74aa6e5f79b6a06d868215feb2e6b3414e473))
* **midi:** retry device bind so MIDI resumes after restart without replug ([3619e5a](https://github.com/popstas/windows-mqtt/commit/3619e5af9463cfcfb213368c5ac5802801f60eee))
* **modules:** lazy module registry, drop deleted vad entry ([d5bfb2a](https://github.com/popstas/windows-mqtt/commit/d5bfb2a0ffb6ae66c1ad404c97ea94a5306bdb21))
* move windows11-manager and node-hide-console-window to optionalDependencies ([670f0b3](https://github.com/popstas/windows-mqtt/commit/670f0b3ccedb2c84676280b281ce98f90b008413))
* NaN volume ([99c9d02](https://github.com/popstas/windows-mqtt/commit/99c9d028a7e91a88c9faf4cab8a3907438806264))
* **notify:** better notify clear for MacroDroid ([e6add3a](https://github.com/popstas/windows-mqtt/commit/e6add3a185afad3ac242e5e6683a1e272f9f227b))
* **notify:** fix messages with * ([ae72dde](https://github.com/popstas/windows-mqtt/commit/ae72ddea64328620dbc17b9c35840fb85f286b30))
* rearrange tray menu items ([e7f5b0c](https://github.com/popstas/windows-mqtt/commit/e7f5b0c16ce93718fa238bfc4b8a0c262cbbd168))
* remove midi, robotjs, usb-detection due node24 incompatibility ([48ef3b9](https://github.com/popstas/windows-mqtt/commit/48ef3b9e8f5adb7d7bb08754f345d5da7c3bd20c))
* remove vad.js and naudiodon2 package ([247a969](https://github.com/popstas/windows-mqtt/commit/247a969e400f4ea3d135bc9a7cfbf2a4a4004ca3))
* **review:** restore config.example fallback, harden audio and tests ([c659a38](https://github.com/popstas/windows-mqtt/commit/c659a38831dccc92b41e6765bae0e65a537e8ab0))
* set electron window icon, hide menu ([cba14d3](https://github.com/popstas/windows-mqtt/commit/cba14d34de4ffd85a6abc34e723f0f24d948be29))
* stop EPIPE busy-loop of orphaned bridge process, add health monitor ([4d520cd](https://github.com/popstas/windows-mqtt/commit/4d520cd773f68a424a8d6efc13c0330a0d03a864))
* **tabs:** count only not excluded tabs in total ([5dd3699](https://github.com/popstas/windows-mqtt/commit/5dd369999dbaed17b35f7535ba9e9b8856a4689d))
* **tabs:** excludedDomains, send 0 tabs for charts ([c2466af](https://github.com/popstas/windows-mqtt/commit/c2466afe1fa2ab8beaba86bc859cfb237a2c9704))
* **tabs:** handle websocket error ([67949a1](https://github.com/popstas/windows-mqtt/commit/67949a1f3e321ebb485bebdf7092bb1fbd926b46))
* **tabs:** try open websocket server ([131463a](https://github.com/popstas/windows-mqtt/commit/131463abb47c7dff059f32517e323f66df990309))
* **tauri:** add wrapper for MSVC linker in Git Bash ([37ae6b1](https://github.com/popstas/windows-mqtt/commit/37ae6b167110460670948f1a0df7e93350408ad6))
* **tauri:** avoid cmd paren blocks around ProgramFiles(x86) expansions in wrapper ([b4bebb1](https://github.com/popstas/windows-mqtt/commit/b4bebb1be5914d116dd6b610b3c0cf04817ca64f))
* **tauri:** cross-platform frontendDist setup ([669e14d](https://github.com/popstas/windows-mqtt/commit/669e14d25fa303bdda1f256e41efc1549eacd593))
* **tauri:** detect VS Build Tools in wrapper via vswhere -products * ([bca5b95](https://github.com/popstas/windows-mqtt/commit/bca5b9503f1702e45138d01a48d5eee3351205c2))
* **tauri:** expose global API, single tray icon, bounded UI log ([78efe8a](https://github.com/popstas/windows-mqtt/commit/78efe8ad1e721b1cec24611d64cb4d611b0d47b5))
* **tauri:** keep dev builds out of the node_modules resource walk ([ec55945](https://github.com/popstas/windows-mqtt/commit/ec559450dd7906682b164253c3bd0e449b880165))
* **tauri:** read vswhere output via temp file, add BuildTools x86 fallback ([33bcdaa](https://github.com/popstas/windows-mqtt/commit/33bcdaac29a1483be3e9c70b2698c1cf380d6af1))
* **tauri:** remove devUrl, serve static frontend ([fa830da](https://github.com/popstas/windows-mqtt/commit/fa830dad64828989455fb4251ba21d8993839a5d))
* **tauri:** resolve app root for dev and bundled resources ([18df444](https://github.com/popstas/windows-mqtt/commit/18df4443d66e1f212f92a348bc18ce1668373231))
* **tauri:** spawn MQTT event loop via tauri async_runtime, not bare tokio ([d8c698a](https://github.com/popstas/windows-mqtt/commit/d8c698a14cdf5d29281e83b766c204efcf8a4516))
* **tauri:** spawn node server in setup, graceful child shutdown on quit ([60b1529](https://github.com/popstas/windows-mqtt/commit/60b1529557c82e8919556b10cbd65331d28e1d07))
* **tauri:** trust cwd-derived app-root candidates only in dev builds ([0165ee2](https://github.com/popstas/windows-mqtt/commit/0165ee292099bfd270e612df662ce60a3c942cec))
* **tauri:** use dist/ for frontendDist ([9f44b27](https://github.com/popstas/windows-mqtt/commit/9f44b2734089ba2071070818f0c969aa15f28097))
* **tauri:** use script for beforeBuildCommand ([43ea4b6](https://github.com/popstas/windows-mqtt/commit/43ea4b6b39f0acb524d6a7869cb4326278e12e6b))
* **tray:** reliable left/right click and resilient hotkey registration ([8c1d87f](https://github.com/popstas/windows-mqtt/commit/8c1d87f5813f60552f86dcd87e1e7dc3e1f9d0d7))
* try to load module, catch exceptions ([693f179](https://github.com/popstas/windows-mqtt/commit/693f1790fc933cfbd10c2baefbb72adb68b83ef7))
* uncaught exceptions catch ([e6c3468](https://github.com/popstas/windows-mqtt/commit/e6c3468824fe14cba15f6a33e51023401970b018))
* update tauri v1 -> v2 in package.json ([dcdd9fd](https://github.com/popstas/windows-mqtt/commit/dcdd9fd6eb04b827ca454d2859f727dcc48cefc0))
* windows service fix ([40a0cf2](https://github.com/popstas/windows-mqtt/commit/40a0cf229890c9c868deda33833bae6f1fd3c773))
* **windows:** default store windows on restart ([2199221](https://github.com/popstas/windows-mqtt/commit/2199221902f09b2f151107b4125aeb7ed9b0493f))
* **windows:** fix placeWindowOnStart: false ([0c15b29](https://github.com/popstas/windows-mqtt/commit/0c15b29652b335299ef3f682382ab7f713cb8104))
* **windows:** hide console fast when systray enabled ([4ffd5de](https://github.com/popstas/windows-mqtt/commit/4ffd5dec8d2269e235750c9b57cba5d661cb028e))
* **windows:** publishStats apps 0, for correct grafana graphs ([03ac344](https://github.com/popstas/windows-mqtt/commit/03ac3442da793f4629093dd8209216882b45a249))
* **windows:** restart context menu ([a94cb27](https://github.com/popstas/windows-mqtt/commit/a94cb27ea083069d2d675c1e8d73e0ce50a0fedf))
* **windows:** timeout 15 sec before place windows after restoreOnStart ([f565c8d](https://github.com/popstas/windows-mqtt/commit/f565c8d8efcfe2582544f04b637364cfde71e4f8))
* **windows:** update windows11-manager ([c7c3d77](https://github.com/popstas/windows-mqtt/commit/c7c3d778921d2064be622ee3f19daa9c74e615a6))
* working node-hide-console-window on Windows ([949e2c7](https://github.com/popstas/windows-mqtt/commit/949e2c79dd8ebb31b73365e4d6f8ce61cd29c1cb))


### Features

* **audio:** event-driven volume/mute via audio-watcher, drop loudness polling ([dfa3f2a](https://github.com/popstas/windows-mqtt/commit/dfa3f2a27b4a6b4ddd0a87059089b4b0eb0c1140))
* **audio:** loudness fallback and watcher restart on spawn error ([a66426c](https://github.com/popstas/windows-mqtt/commit/a66426c36148b48fb34ecaa9a9b1863dbbafb774))
* **audio:** report default device via native audio-watcher sidecar ([557e005](https://github.com/popstas/windows-mqtt/commit/557e005da2beb18ef68661dd9d239074f3188866))
* **clipboard:** new module clipboard, copy text to system clipboard ([1c3c96e](https://github.com/popstas/windows-mqtt/commit/1c3c96e55f617499cfd5f02cb0e5436ca8cbb26b))
* **clipboard:** some custom commands for click detected button ([84f843f](https://github.com/popstas/windows-mqtt/commit/84f843f5045b51e47b875eaae575cfdae58d4220))
* **commands:** add ([36285b5](https://github.com/popstas/windows-mqtt/commit/36285b525f595ea33be0313abf3f735c86af8c85))
* **commands:** new module commands ([82cb400](https://github.com/popstas/windows-mqtt/commit/82cb400e2e75888218c4c16fb3b853cbafa9a06e))
* **commands:** write script temp files to tmpdir, dedupe requires ([8fd6aed](https://github.com/popstas/windows-mqtt/commit/8fd6aeda05e13f2eb3f884f24c38bbafc781e95f))
* **config:** fall back to example config and never return null ([25579d4](https://github.com/popstas/windows-mqtt/commit/25579d42963ceeba98e24a0cc85b0d2dccf87305))
* **config:** settings-folder config/commands, bundled deps, renamed binary ([c91920b](https://github.com/popstas/windows-mqtt/commit/c91920baafe654fc39816bf6eccbb29e6a384e6c))
* control audio volume/mute, TTS text from MQTT ([6d53857](https://github.com/popstas/windows-mqtt/commit/6d538571f678ed89429fff520e6934b122a0620a))
* **dirwatch, filewatch:** new modules, watch for directory or file changes, mqtt action ([f7681d7](https://github.com/popstas/windows-mqtt/commit/f7681d7a38ad18d3d2bd616771d361a118eca936))
* dynamic module stop/start (for midi), modules context menu ([2f3ed0f](https://github.com/popstas/windows-mqtt/commit/2f3ed0fabae85df9be96decfa2ad5dee7bf3d7a7))
* electron version, add logLevel, split index.js to 4 files, better error handling. Build not working yet ([be1efd3](https://github.com/popstas/windows-mqtt/commit/be1efd31549d831a037bc73de634684f08f45944))
* exec/cmd - execute command with arguments in system shell ([15d70e9](https://github.com/popstas/windows-mqtt/commit/15d70e9de89f7b47e1d9d4f7bdfd66ffec4a85a0))
* **exec:** self-kill ([2085349](https://github.com/popstas/windows-mqtt/commit/2085349be6bee2746ff095783e1ec230f23ed0a8))
* **exec:** silent mode, /exec/cmd/silent, {silent:true} ([7aef2fa](https://github.com/popstas/windows-mqtt/commit/7aef2fa31f4ea722d9abc2d02b5c107f5b4f43ac))
* **exec:** ssh command, open ssh terminal ([e1cfc9d](https://github.com/popstas/windows-mqtt/commit/e1cfc9dbc7fd0e2d05bb2ac96986dbe1be1c2a5d))
* **exec:** tts feedback after command exec ([a98e805](https://github.com/popstas/windows-mqtt/commit/a98e805cf507fe0a46b84badc6ca67fb3278f156))
* **exec:** tts when command is long than config.long_time_sec ([f5ea063](https://github.com/popstas/windows-mqtt/commit/f5ea063b451af96c98576b97c56f300cf11932b1))
* **gpt:** /gpt/fix-and-copy ([0b9727d](https://github.com/popstas/windows-mqtt/commit/0b9727d418b1c6a18cb1062c4a030a0e8cbca001))
* **gpt:** new module gpt, answer with openai chatgpt / gpt 4 ([0fe1169](https://github.com/popstas/windows-mqtt/commit/0fe116904d14e8d23ef316a9ead9a9309cb4b4b2))
* **helpers:** load modules from registry ([f540018](https://github.com/popstas/windows-mqtt/commit/f540018e0d41163f4dfe23a3dc5c389774948ad5))
* **keys:** emulate hotkey press, type sting ([6877d5a](https://github.com/popstas/windows-mqtt/commit/6877d5a47af96d020ec722b9b8956acc67eb70fe))
* logging, tabs module ([f5523fd](https://github.com/popstas/windows-mqtt/commit/f5523fd01b062e905dc6ac52ff74b8d633831b8e))
* **logging:** persist logs and native crashes to disk ([3a65b91](https://github.com/popstas/windows-mqtt/commit/3a65b914e496c42209c36e0eb26fc195dfb284f5))
* **logging:** shared Windows-safe log rotation for helpers and monitor ([33a541f](https://github.com/popstas/windows-mqtt/commit/33a541f6953b069f99373a7c2205bb0bb81ca684))
* **logging:** tag every stderr line so multi-line stacks keep their level ([128d141](https://github.com/popstas/windows-mqtt/commit/128d14108bdbc4ca76c2ecd8f30d748a8985e025))
* midi input module ([3065d2b](https://github.com/popstas/windows-mqtt/commit/3065d2b8249a5f376bf980c63ddaf3cdeb314330))
* **midi:** apply hotkeys config in runtime, ignore part of midi lines ([320def1](https://github.com/popstas/windows-mqtt/commit/320def15cd828c1020e30d9b4c332f1812fdb4f0))
* **midi:** config.fastDebounce for ranges, reduce delays ([5ea543a](https://github.com/popstas/windows-mqtt/commit/5ea543aafee5876feb91890d0bdf3eec9c27eb8c))
* **midi:** print portName candidates on device attach and dedupe open failures ([ce84c77](https://github.com/popstas/windows-mqtt/commit/ce84c77f0365ce92535e5fe2585661565ec936ca))
* **midi:** range controls support ([30d08c3](https://github.com/popstas/windows-mqtt/commit/30d08c312935729ce7f6dc9aa0bc2d43ffbff6fe))
* **midi:** support multiple midi devices ([8e0a158](https://github.com/popstas/windows-mqtt/commit/8e0a158222d8fd650aba100da61497c223754952))
* mouse/get current position ([28312e3](https://github.com/popstas/windows-mqtt/commit/28312e36efc16044bfe1f550eae343f87081f8fe))
* **mouse:** mouse back after point and click ([1dd88a1](https://github.com/popstas/windows-mqtt/commit/1dd88a10e3bedc46b1ef0a2e3be6539cc8bf9669))
* **mouse:** mouse click emulate ([516f48f](https://github.com/popstas/windows-mqtt/commit/516f48fb365f810b7e007d735639dab78469c4f9))
* **mouse:** point (move and optional click) ([e9beae0](https://github.com/popstas/windows-mqtt/commit/e9beae07993351ef4a215475b1a13cf24e77253a))
* **mqtt:** support username-only credentials and replay Connected on manual restart ([7f332b1](https://github.com/popstas/windows-mqtt/commit/7f332b1020811c9313ecab167dda9b1b1baa14e6))
* multiple keys/press ([2538730](https://github.com/popstas/windows-mqtt/commit/253873060d303c20292ba3a577bf27c59153de73))
* **notify:** notify module ([34a2208](https://github.com/popstas/windows-mqtt/commit/34a220801c59e08a3e16b563ff2c6f4cf9f8dca9))
* **obs:** new module: obs, start/stop recording, recording state changes ([0a9c7a3](https://github.com/popstas/windows-mqtt/commit/0a9c7a35cab33bdd1c6111b46304e95f26a5f9d5))
* **paths:** add settingsDir helper and ensure crash.log dir exists ([a02229d](https://github.com/popstas/windows-mqtt/commit/a02229db0c0abea2ff31feccba8639fcaef1c56a))
* **reaper:** new module, reaper commands ([07f3e93](https://github.com/popstas/windows-mqtt/commit/07f3e9379a82de0d4311950534cf84fd7d4efe79))
* replace src/config.js to config.yml, env CONFIG ([618037c](https://github.com/popstas/windows-mqtt/commit/618037c495f98ae65206ca2411f1468ce70eb1ec))
* self-kill ([670788d](https://github.com/popstas/windows-mqtt/commit/670788da13d47431b080736a23615f0cf7b320e0))
* show enabled modules and log in main window ([33a3446](https://github.com/popstas/windows-mqtt/commit/33a3446aa9b8d88a8e1182b1c5da035adb9800c9)), closes [#5](https://github.com/popstas/windows-mqtt/issues/5)
* systray icon ([e011689](https://github.com/popstas/windows-mqtt/commit/e011689146c155f605f46fa90d993ece779389f8))
* **tauri:** add tray menu actions and hotkeys ([92212f6](https://github.com/popstas/windows-mqtt/commit/92212f679d9b66627b5b8ff232e7598f38ab1721))
* **tauri:** bundle resources by default so direct tauri build is complete ([6dababc](https://github.com/popstas/windows-mqtt/commit/6dababca69cf35abb3ddfcd302273bf4d96923ce))
* **tauri:** migrate from Tauri v1 to v2 ([01bc2e7](https://github.com/popstas/windows-mqtt/commit/01bc2e761440239d051e064f531543d1f179fae9))
* **tauri:** move MQTT to Rust bridge ([8ddd0d7](https://github.com/popstas/windows-mqtt/commit/8ddd0d72c6fd88a28927e7be357386dcea5e8699))
* **vad:** new module vad, voice activity detection ([7c26dce](https://github.com/popstas/windows-mqtt/commit/7c26dce55817dad77c4c863af3cd06f3f1ae89d5))
* verify code-review findings acceptance criteria ([5d539fa](https://github.com/popstas/windows-mqtt/commit/5d539fad19bcc4400e952bb9ae235c8cbe249de2))
* windows module, autoplace windows ([2dea6d9](https://github.com/popstas/windows-mqtt/commit/2dea6d94c718aad12198b17dd137f531c69578ff))
* **windows:** idempotent windows autoplace ([dc6bcb4](https://github.com/popstas/windows-mqtt/commit/dc6bcb41c18b9bbe21823a1395b6d573148abfe7))
* **windows:** publish windows stats by apps, focus command, add restart ([41a1d30](https://github.com/popstas/windows-mqtt/commit/41a1d30614bd46f09a73cb7b89bef08560231b7d))
* **windows:** publish windows stats to mqtt ([3b376a6](https://github.com/popstas/windows-mqtt/commit/3b376a6b612d3763a452a7fcb404334698b600e6))
* **windows:** reload configs ([6148f8a](https://github.com/popstas/windows-mqtt/commit/6148f8a1a6f07bb8a12946fbf89f2efb9171682d))
* **windows:** restore custom windows with arguments ([2e36e92](https://github.com/popstas/windows-mqtt/commit/2e36e920ea2414992a0befb56373c163ac26fc73))
* **windows:** shutdown ([9673872](https://github.com/popstas/windows-mqtt/commit/9673872cc3083f1e5e487f718980cedf37542a07))
* **windows:** store/restore windows, context menu ([c9d0d94](https://github.com/popstas/windows-mqtt/commit/c9d0d94d3fb23ef5ea1d3774a2ac49e8cd64ba22))



