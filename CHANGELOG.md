# [1.1.0](https://github.com/popstas/windows-mqtt/compare/v1.0.0...v1.1.0) (2026-08-13)


**claude-wt, the session picker and window management moved out of this repo.**
What is left here is the MQTT transport for the rest of the home-automation
modules. This release is a *split*, not a feature drop — that is why it is a
minor bump and not a patch.

**Highlights**

- **Removed:** `src/modules/windows.js`, the in-app session picker
  (`src/picker/`, `frontend-src/`, `sessions.html` and the `sessions` webview
  window), the Home Assistant export and the claude-wt watchdog. Window
  management and claude-wt now live in `windows11-manager`; the picker became
  a standalone app, `ccfzf-picker`.
- **New module `power`** carries what stayed: sleep, restart, shutdown and
  "restart with restore". It deliberately answers on the historical topic base
  `<mqtt.base>/windows`, not `<mqtt.base>/power` — physical buttons, the
  openHASP panel and Node-RED all still address `windows/restart`, and moving
  that topic is separate work in another repo.
- **The tray menu survived the split.** `windows.js` was the only module that
  ever supplied tray actions, so removing it silently orphaned the whole menu.
  Power items are handled locally again (shutting the machine down must not
  depend on a live broker); window-management items are relayed to MQTT and
  executed by `windows11-manager`. `Open default apps` and `Restore claude
  terminals` are gone — nothing implements them anymore.
- **`keys/press-throttled`**: a new topic that accepts at most one press per
  second per key combination, for physical panel buttons that bounce. Plain
  `keys/press` stays unthrottled — repeats are the point there.
- **Logging**: `console` output from libraries now reaches the log file, both
  entry points share one level threshold, and re-entry is guarded.
- **Startup is harder to break**: a config with no `modules:` section, or with
  the section present but fully commented out (YAML gives `null`, not
  `undefined`), no longer crashes the server.
- **`npm run deploy-fast`**: copy the Node part into the installed app without
  a rebuild.

**Upgrade note**

Rolling this back means reverting the commit, not flipping a flag — and it has
to be done at both ends. A restored `windows.js` would parse the same topics
`windows11-manager` already parses: one `restore` would launch every app twice,
and two publishers on the panel slots would flip rows between sessions.

### Bug Fixes

* **bundle:** include assets/ in Tauri resources so toast icons ship ([09c0878](https://github.com/popstas/windows-mqtt/commit/09c0878f567d8daba088d6331073e76e4923c600))
* **bundle:** stop shipping the gitignored src/daemon/ in the installer ([73c35ec](https://github.com/popstas/windows-mqtt/commit/73c35ecd5d903fc5c997b84b826a936cd13bb183))
* **claude-wt:** focus already-open sessions instead of failing restore ([a045ae1](https://github.com/popstas/windows-mqtt/commit/a045ae1cd1b64a2c56e10511ae558e0e655706b1))
* **claude-wt:** на панели видно, на чём остановилась работающая сессия ([e141885](https://github.com/popstas/windows-mqtt/commit/e141885b432b75742ba66060b1d4ac70bd754a6a))
* **claude-wt:** сторож не слепнет молча ([d9f4e94](https://github.com/popstas/windows-mqtt/commit/d9f4e946bcf482e061a60ba490b864d21e732a9d))
* **config:** power.base в примере не забивает наследование базы windows ([a3ef16b](https://github.com/popstas/windows-mqtt/commit/a3ef16be0886ed9d7286307b3863730c51036497))
* **deploy:** не убивать дерево процессов вместе с приложением ([da8dbc5](https://github.com/popstas/windows-mqtt/commit/da8dbc5959da2d9354395783a9efccff1d9e1d21))
* **helpers:** getModulesEnabled не падает без секции modules в конфиге ([c37e1b0](https://github.com/popstas/windows-mqtt/commit/c37e1b0884ab01d3f6134d8762e14146595a6c57))
* **helpers:** пустая секция modules (null) не роняет старт ([df19cfb](https://github.com/popstas/windows-mqtt/commit/df19cfbedaf92286acc7a79c397dceac0b71fa8f))
* **homeassistant:** прочерк в пустом слоте вместо пробела ([7ca66a2](https://github.com/popstas/windows-mqtt/commit/7ca66a2b463932b3cec899ef179ea90bae39488a))
* **homeassistant:** пустой слот отдаёт пробел, а не пустую строку ([c00f279](https://github.com/popstas/windows-mqtt/commit/c00f279b6a3075f91bf9ba528c40f6423a852b54))
* **homeassistant:** только ASCII в значках состояния ([65ddac9](https://github.com/popstas/windows-mqtt/commit/65ddac9e3e79f835906654d624ddc2834abce057))
* **log:** порог уровня для console-строк и тест на задвоение ([4eb0cfb](https://github.com/popstas/windows-mqtt/commit/4eb0cfb6ad4a610208f72396467afde6a7de768f))
* **picker:** arm the watchdog per-show and cover the first-show hotkey race ([92e7429](https://github.com/popstas/windows-mqtt/commit/92e74298381da2ae4b1c9d6a59c098ed4724a470))
* **picker:** check foreground grant result and fix stale comment ([de188b0](https://github.com/popstas/windows-mqtt/commit/de188b03a7fd9d619a4918ad31d5e20de3d06c8c))
* **picker:** decide the desktop switch from the live value, not the stored one ([4ccc602](https://github.com/popstas/windows-mqtt/commit/4ccc602f41cffcdffb043cf1e38caeacaf66ef2c))
* **picker:** degrade instead of crashing on app-root, tray-toggle and show failures ([1e752a7](https://github.com/popstas/windows-mqtt/commit/1e752a772fedda8f22330862c3d5eeebbf296608))
* **picker:** focus a session that opened after the last snapshot ([caf1b76](https://github.com/popstas/windows-mqtt/commit/caf1b767b27059070f030f0b29acff8fa8023c89))
* **picker:** guard native sessions call and extract testable payload shaping ([dc5b47a](https://github.com/popstas/windows-mqtt/commit/dc5b47a0586ca2618184baea2ef2a49809896a2a))
* **picker:** ignore /home prefix in search ([f0ffffe](https://github.com/popstas/windows-mqtt/commit/f0ffffe11268380b0de6f1ec211c71579b12416b))
* **picker:** scope the sessions window to core:default only ([510abab](https://github.com/popstas/windows-mqtt/commit/510abab2e80c123ca250a1669aff5f5de56b7c7b))
* **picker:** Session info из меню берёт сессию по id, а не по индексу ([5360ecc](https://github.com/popstas/windows-mqtt/commit/5360ecc5f4ec441324f0481ab60e27c1b313e58e))
* **picker:** store the group-key separator as an escape, not a raw NUL ([6c4dcd4](https://github.com/popstas/windows-mqtt/commit/6c4dcd48c09ac2f35895f1518c36f9623da6c169))
* **picker:** switch to the live virtual desktop, not the stale stored one ([9c22516](https://github.com/popstas/windows-mqtt/commit/9c22516163cb017cae794304f51289a0322fc801))
* **picker:** вынести разбор PR-номера в src/picker/pr-url.js ([f5d9cb6](https://github.com/popstas/windows-mqtt/commit/f5d9cb6639901eb3c0dd0e0eb3993a548d899c13))
* **picker:** гасить по фокусу и review от stop, не только idle ([4921df6](https://github.com/popstas/windows-mqtt/commit/4921df69d87033fd0b7e877ffe936fbde008c486))
* **picker:** согласовать formatAge с session-glyph и добавить граничные тесты ([b1b84b0](https://github.com/popstas/windows-mqtt/commit/b1b84b01170e8d840575d91e988ce92c21491617))
* **picker:** список рисуется один раз за открытие, а не каждую секунду ([3444b5e](https://github.com/popstas/windows-mqtt/commit/3444b5e3e74273d865884aef2c88b2d9fb153aee))
* **picker:** сузить регулярку PR-ссылки до owner/repo без спецсимволов ([fc96136](https://github.com/popstas/windows-mqtt/commit/fc96136ad9d34d32a42c06b0e177083a9c889744))
* **power:** power грузится на старом config.yml, ack не путает запросы ([e0d862a](https://github.com/popstas/windows-mqtt/commit/e0d862aa1261250aade94661fff17c003d4ca5d1))
* **scripts:** deploy-local возвращает управление ([366f4b7](https://github.com/popstas/windows-mqtt/commit/366f4b78817b54f5d7f05a8cfa443905a509262d))
* **sessions:** фокус гасит и вопрос агента ([08917ec](https://github.com/popstas/windows-mqtt/commit/08917ecfdb4d03581f9c03d6958bef47d2633226))
* **shortcuts:** фильтр Pressed теперь общий, не только у ShowPicker ([654c92a](https://github.com/popstas/windows-mqtt/commit/654c92a830c1b59ba6a5314a1de8ea20ec34195a))
* **tauri:** route the picker's CloseRequested through hide_picker_window ([bc2dcc6](https://github.com/popstas/windows-mqtt/commit/bc2dcc6016da7474fd350097c80b43d0e2bae236))
* **tray:** пункты меню снова доходят до исполнителя ([2e00ea3](https://github.com/popstas/windows-mqtt/commit/2e00ea3132222b3da3896b342ee87f5dc0c75c6d))
* **windows:** log a warning when windows/focus finds no match ([457f7a8](https://github.com/popstas/windows-mqtt/commit/457f7a83e29daa12b19bf29b6980c9c577f4fcf6))
* **windows:** просьба пикера о подъёме окна приходит по MQTT ([0a7fb17](https://github.com/popstas/windows-mqtt/commit/0a7fb1787d7b54e4fd9bfa37e9b7c9c245ac685d))
* **windows:** разбирать JSON в просьбе о восстановлении ([b0b10a0](https://github.com/popstas/windows-mqtt/commit/b0b10a08266bc48e2652c7a13fee595c241a104a))


### Features

* **claude-wt:** forward claudeProjects.profile to openClaudeProject ([dd3e4a3](https://github.com/popstas/windows-mqtt/commit/dd3e4a346cffb83a92426fc69fc0341da276d9c9))
* **claude-wt:** http-сервер трекера поднимается внутри демона ([d7346a6](https://github.com/popstas/windows-mqtt/commit/d7346a6606f5938d388db7dbbec90242f67591ee))
* **claude-wt:** load projects from manager; Terminal reopens via restore ([bdb8d78](https://github.com/popstas/windows-mqtt/commit/bdb8d78a517d9c92e239f080b74c3049cc02ffab))
* **claude-wt:** register project hotkeys from manager JS API ([6caf64d](https://github.com/popstas/windows-mqtt/commit/6caf64d4baee11ba388de3304d0ca3d0343ef2c9))
* **claude-wt:** подключить сторожа к жизненному циклу модуля ([2b0e44c](https://github.com/popstas/windows-mqtt/commit/2b0e44c769ac7e1ebd819922f086f159cba921c1))
* **claude-wt:** сторож живости демона ([962ef63](https://github.com/popstas/windows-mqtt/commit/962ef63b1ac440e229b4b738aad69a70290b11d0))
* **homeassistant:** значок работающей сессии и экспорт сразу после фокуса ([f11c821](https://github.com/popstas/windows-mqtt/commit/f11c8210a7a4c61895e9af2c3117b555033d69bd))
* **homeassistant:** имя сущности — заголовок сессии ([0396898](https://github.com/popstas/windows-mqtt/commit/0396898fb3d715465def32592da58df56f1e9e4d))
* **homeassistant:** отдавать на панель только живые сессии ([fc9b0ce](https://github.com/popstas/windows-mqtt/commit/fc9b0ce299555a484c68f00a82442c574de9b43b))
* **homeassistant:** сессии как binary_sensor с состоянием внимания ([f047f7a](https://github.com/popstas/windows-mqtt/commit/f047f7a9243d09315fb70bd7a7bcd488c3309448))
* **homeassistant:** сессии через MQTT Discovery, устройством claude-wt ([e2783f0](https://github.com/popstas/windows-mqtt/commit/e2783f0fa50f8a483352458e1764febd0cdb9ef3))
* **homeassistant:** экспорт сессий claude-wt через REST API ([55ce4e9](https://github.com/popstas/windows-mqtt/commit/55ce4e9f097eaabf17036bb27e513c3c89927fe7))
* **keys:** топик press-throttled для дребезжащих кнопок платы ([0f9eef3](https://github.com/popstas/windows-mqtt/commit/0f9eef3c113b1c154a82e12604a8859496559a1c))
* **log:** console из библиотеки доезжает до файлового лога ([84dbc77](https://github.com/popstas/windows-mqtt/commit/84dbc77908af09f98ab846cd4299ecc4a77af679))
* **notify:** persistent Windows toasts via PowerShell reminder scenario ([c6fab90](https://github.com/popstas/windows-mqtt/commit/c6fab90985d82a03c539fafa4275df05921b5b5c))
* **notify:** png toast icons + file-URI image src for persistent toasts ([ffcd4e9](https://github.com/popstas/windows-mqtt/commit/ffcd4e9e36412dd5679d5767ca5ea7a86bc55079))
* **panel:** в углу строки только контекст ([db6a958](https://github.com/popstas/windows-mqtt/commit/db6a9588412b0679c56e41950224d20080026988))
* **picker,panel:** время текущего хода вместо возраста последнего события ([a136da7](https://github.com/popstas/windows-mqtt/commit/a136da737e542d11374ff9de503419cf4600875d))
* **picker:** /s snapshots and panel slot off ([6f4d712](https://github.com/popstas/windows-mqtt/commit/6f4d712728bc3785a2de73ff79f61a96d833fef8))
* **picker:** Ctrl+K session open actions ([4403717](https://github.com/popstas/windows-mqtt/commit/4403717c2484619b1e34edbe51dc2b79354e817c))
* **picker:** explain empty states and fall back to restore on a dead window handle ([073df84](https://github.com/popstas/windows-mqtt/commit/073df84d10e060fba81351984be06246d6eff94e))
* **picker:** filter sessions by name and project ([132ced3](https://github.com/popstas/windows-mqtt/commit/132ced36813ce23bbeb0d6ebdbea0d8f230e1597))
* **picker:** focus a claude session, with the foreground right granted from Rust ([9add988](https://github.com/popstas/windows-mqtt/commit/9add9881d41881a7c808900a097b0ce4fe2f1eb2))
* **picker:** group and label claude sessions by desktop and monitor ([77d1e54](https://github.com/popstas/windows-mqtt/commit/77d1e54dd6279fff0187c96a5438fa408eeb5db9))
* **picker:** Open PR в меню действий ([8ae67e1](https://github.com/popstas/windows-mqtt/commit/8ae67e1eea2f1626a8b1538da454b602cc4abb6d))
* **picker:** palette window with search, keyboard navigation and position glyphs ([a95696f](https://github.com/popstas/windows-mqtt/commit/a95696fc8f51e2edaf5c1f5d0e9e690e64e49be7))
* **picker:** palette window, Win+F10 hotkey and tray left-click choice ([fd031b1](https://github.com/popstas/windows-mqtt/commit/fd031b11c892afb2b4679b976d865c2c21401a94))
* **picker:** prompt line, less chrome ([e310a5d](https://github.com/popstas/windows-mqtt/commit/e310a5d8422b011f6d2ec6d9c5dcfe6674816ff7))
* **picker:** push grouped session list from Node to the webview ([92c51d7](https://github.com/popstas/windows-mqtt/commit/92c51d70ceb9d0059bf2baf7e7990466fa382103))
* **picker:** shift над строкой показывает будущую пометку ([8f8bab5](https://github.com/popstas/windows-mqtt/commit/8f8bab58f1af47301397aa0eef69e23dc3674a46))
* **picker:** shift+клик и пункт меню помечают сессию непрочитанной ([f303218](https://github.com/popstas/windows-mqtt/commit/f3032180c35c251397fc2c10c851dbbb66e828d5))
* **picker:** Show event checkbox in statusline ([93bb8c9](https://github.com/popstas/windows-mqtt/commit/93bb8c9052f6a723233667be552ced1c6217f235))
* **picker:** Show paths checkbox in statusline ([bf6b2f8](https://github.com/popstas/windows-mqtt/commit/bf6b2f810a390d6a1318a05fbf920ef2ef4c90ec))
* **picker:** status dot instead of a position glyph, calmer active row ([7ea061c](https://github.com/popstas/windows-mqtt/commit/7ea061cc148dcbeb7b8fa55ff063c40995cac52a))
* **picker:** гасить оранжевый по фокусу, а не по времени ([27561cc](https://github.com/popstas/windows-mqtt/commit/27561cc89d11490bc48013ede72d100d0dfabea7))
* **picker:** горячая клавиша закрывает пикер повторным нажатием ([c0312ef](https://github.com/popstas/windows-mqtt/commit/c0312ef4ff70f9c9b24df3da3a14d355c6891808))
* **picker:** действия по прямым клавишам, без меню ([f021310](https://github.com/popstas/windows-mqtt/commit/f021310c9c6f2decddd3d80788adb89986052629))
* **picker:** живые сессии отдельной группой, оранжевый для ждущих проверки ([868dfaa](https://github.com/popstas/windows-mqtt/commit/868dfaad0fee9b3ea5dde7f1598cbd6be9a135b5))
* **picker:** колонка хоткея и чекбоксы строки ([2453d13](https://github.com/popstas/windows-mqtt/commit/2453d13fa0a8abaf34291820bc440d16051f475f))
* **picker:** метка PR в строке сессии ([1685529](https://github.com/popstas/windows-mqtt/commit/1685529e1c24f1c1b135a85a839deeebf14a409d))
* **picker:** оверлей Session info по Ctrl+I и из меню ([bf31a07](https://github.com/popstas/windows-mqtt/commit/bf31a07a80e9ecf5c187232181602b6ccafdddb6))
* **picker:** подписи хоткеев в меню и в статуслайне ([32737e5](https://github.com/popstas/windows-mqtt/commit/32737e59a476bc60dd7f1c52a33c475a9ebaf4f5))
* **picker:** пункт и команда mark unread ([967f639](https://github.com/popstas/windows-mqtt/commit/967f6393ee5552dd87830aa7fa1095f55149c097))
* **picker:** раскладка сессий по фиксированным слотам ([372564d](https://github.com/popstas/windows-mqtt/commit/372564d0fd7498db1b41ad5eee3ff2b6df878fda))
* **picker:** сводка третьей строкой, путь без домашнего каталога ([37c0cad](https://github.com/popstas/windows-mqtt/commit/37c0cad069ae7a2902452660df79e6eacff56bbc))
* **picker:** сортировка списка сессий ([cd2c5f2](https://github.com/popstas/windows-mqtt/commit/cd2c5f2a827dd3d98f465ed11132208effa44a36))
* **picker:** состояние агента и возраст активности в списке сессий ([a4df257](https://github.com/popstas/windows-mqtt/commit/a4df2574e3c44c672f7e70920172d90f80e5da85))
* **picker:** счётчик в Active sessions ([ccdc543](https://github.com/popstas/windows-mqtt/commit/ccdc543045214d10cb28a2775a83e52ee277021e))
* **picker:** таблица полей сессии для Session info ([588ad3c](https://github.com/popstas/windows-mqtt/commit/588ad3c9386f19b1f1d422f2e7cc72c1eb0cf0de))
* **picker:** текстовый статус агента рядом с возрастом ([64584ee](https://github.com/popstas/windows-mqtt/commit/64584ee74e1a14f815415358256de0701ada94ff))
* **picker:** тултип с полным cwd и сообщением агента ([f28a959](https://github.com/popstas/windows-mqtt/commit/f28a959f75806ec44ade2a0fdc3713fb1214fd14))
* **picker:** фоновый агент и короткий id в правой колонке ([282f259](https://github.com/popstas/windows-mqtt/commit/282f25993ad8adc266eed314c344437db7057a2d))
* **picker:** чекбоксы id, cost, context в статуслайне ([b15b9eb](https://github.com/popstas/windows-mqtt/commit/b15b9eb5ddc11a92caaa5e42412902873d3f803f))
* **power:** питание машины отдельным модулем за флагом windows.enabled ([223188f](https://github.com/popstas/windows-mqtt/commit/223188fba89a7b0cea2344218c03d74360e95c99))
* **sessions:** dump refresh and HA slot sort ([09fcbf2](https://github.com/popstas/windows-mqtt/commit/09fcbf265763a958e6a48122957641d2d268bc75))
* **sessions:** project hotkeys and clears ([088ee93](https://github.com/popstas/windows-mqtt/commit/088ee93f0a55c597bc6ed99295b0319d8b414b87))
* **sessions:** показывать, чем сессия закончила ([c4a035b](https://github.com/popstas/windows-mqtt/commit/c4a035be9218b254a5e9289b3a3cffa434c63e5d))
* **sessions:** последняя известная сводка отдельным полем ([7b53339](https://github.com/popstas/windows-mqtt/commit/7b5333902efcbdd507f178a7d5110c4ab49d2ede))
* **windows:** start claude-wt watcher and add tray restore action ([df1695a](https://github.com/popstas/windows-mqtt/commit/df1695a7646f6b034bdd5a13f5a3d6f8f7648e86))
* **windows:** восстановление снимка по MQTT ([f77a498](https://github.com/popstas/windows-mqtt/commit/f77a4984aa8a0856e3599210ab5197000a4d276e))

# [1.0.0](https://github.com/popstas/windows-mqtt/compare/6d538571f678ed89429fff520e6934b122a0620a...v1.0.0) (2026-07-16)


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
