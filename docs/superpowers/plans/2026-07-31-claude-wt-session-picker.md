# Claude-wt Session Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Окно-палитра в духе Raycast, которое перечисляет claude-wt сессии, ищет по имени и проекту, фокусирует открытые и поднимает закрытые.

**Architecture:** Данные собирает Node (там же, где живёт вотчер) и толкает в webview через существующий построчный JSON-протокол Node → Rust → Tauri-событие. Обратно webview шлёт действия одной командой Tauri. Вся содержательная логика — группировка, подписи, фильтр — вынесена в чистые функции с тестами; нативные вызовы (фокус, сканирование окон) тестируются вручную.

**Tech Stack:** Node.js (CommonJS в windows-mqtt, ESM в windows11-manager), Tauri v2 + Rust, `node-window-manager`, тесты — `node:test` в windows-mqtt и `vitest` в windows11-manager.

## Global Constraints

- Два репозитория: `D:\projects\js\windows-mqtt` (основной) и `D:\projects\js\windows11-manager` (сосед, подключён junction-ом как `node_modules/windows11-manager`). Правки в обоих разрешены. Правка файла в `node_modules/windows11-manager` — это правка соседнего репозитория, каталог не копия.
- Тесты — только чистая логика, никакого запуска нативных бинарей (AGENTS.md).
- Перед любой командой cargo: `source "$HOME/.cargo/env"` (на этой машине cargo уже в PATH, шаг можно пропустить, если `cargo --version` отвечает).
- `cargo check` запускать с `TAURI_CONFIG='{"bundle":{"resources":[]}}'`, иначе build script обходит `.git` внутри junction-а и падает с `Access is denied`.
- Conventional commits с именем модуля: `feat(picker): ...`. Префиксы `feat:`/`fix:` — только для настоящих фич и багфиксов.
- Спека: `docs/superpowers/specs/2026-07-31-claude-wt-session-picker-design.md`.
- Имена действий фиксированы спекой: `windows/claude-sessions-start`, `windows/claude-sessions-stop`, `windows/claude-focus`, `windows/claude-restore-one`.
- Имя Tauri-события с данными: `claude-wt-sessions`. Метка окна пикера: `sessions`.

---

## Порядок и главный риск

Задача 2 — проверка того, что Windows вообще даст переключить фокус. Если она провалится и запасной путь тоже, дальнейшая работа теряет смысл в текущем виде. **Не начинать задачи 3+ до её ручной проверки.**

## Файлы

**windows11-manager** (`D:\projects\js\windows11-manager`):

| Файл | Ответственность |
| --- | --- |
| `src/claude-wt/view-helpers.js` (создать) | чистое: номер монитора по центру окна, сборка списка сессий |
| `src/claude-wt/view-helpers.test.js` (создать) | тесты к нему |
| `src/claude-wt/view.js` (создать) | нечистое: чтение состояния, сканирование терминалов, `claudeWtSessions()` |
| `src/windows.js` (изменить) | `focusWindowById(id)` — примитив фокуса, которого в пакете не было |
| `src/lib/index.js` (изменить) | реэкспорт `view.js` |

**windows-mqtt** (`D:\projects\js\windows-mqtt`):

| Файл | Ответственность |
| --- | --- |
| `src/picker/session-groups.js` (создать) | чистое: подписи и группировка |
| `test/picker-session-groups.test.js` (создать) | тесты к нему |
| `frontend-src/picker-filter.js` (создать) | чистое: фильтр по строке поиска, работает и в браузере, и в тестах |
| `test/picker-filter.test.js` (создать) | тесты к нему |
| `sessions.html` (создать) | разметка, стиль и поведение палитры |
| `src/stdin-handler.js` (изменить) | нагрузка у действий |
| `src/mqtt-bridge.js` (изменить) | `sendEvent()`, нагрузка у входящих действий |
| `src/modules/windows.js` (изменить) | четыре новых действия |
| `scripts/prepare-frontend.js` (изменить) | копирование новых файлов фронтенда |
| `src-tauri/src/main.rs` (изменить) | окно, команды, событие, хоткей, трей |
| `src-tauri/Cargo.toml` (изменить) | крейт `windows` ради `AllowSetForegroundWindow` |
| `src-tauri/tauri.conf.json` (изменить) | объявление окна `sessions` |
| `config.example.yml` (изменить) | ключи `picker.hotkey` и `tray.leftClick` |

---

### Task 1: Источник данных — `claudeWtSessions()` в windows11-manager

Список сессий с номером монитора, признаком «открыта» и хендлом окна. Без хендла нечего фокусировать, а `claudeWtStatus()` его не знает и `cwd` не отдаёт.

**Files:**
- Create: `D:\projects\js\windows11-manager\src\claude-wt\view-helpers.js`
- Create: `D:\projects\js\windows11-manager\src\claude-wt\view-helpers.test.js`
- Create: `D:\projects\js\windows11-manager\src\claude-wt\view.js`
- Modify: `D:\projects\js\windows11-manager\src\lib\index.js`

**Interfaces:**
- Consumes: `getWindows()` из `../windows.js` (массив объектов `Window` с `.id`, `.getTitle()`), `getMons()` из `../monitors.js` (массив, где индекс = номер монитора, нулевой элемент — заглушка), `readState(path)`, `loadSessionIndex(path)`, `resolveSession(title, sessionIndex, slots) -> {id, cwd, ambiguous} | null`, `stripTitleDecoration(title)`, `getClaudeWtConfig()`, `isTerminalWindow(w)`.
- Produces:
  - `monitorNumberForBounds(mons, bounds) -> number | null`
  - `buildSessionList({ slots, openMap, mons }) -> Session[]`, где `Session = { id, title, cwd, bounds, desktop, monitor, monitorBounds, open, windowId }`
  - `openSessionMap(cfg, state) -> Map<sessionId, windowId>`
  - `claudeWtSessions() -> { ok: true, sessions: Session[] } | { ok: false, reason: string }`

- [ ] **Step 1: Написать падающий тест**

Создать `src/claude-wt/view-helpers.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { monitorNumberForBounds, buildSessionList } from './view-helpers.js';

const mons = [
  {},
  { bounds: { x: 0, y: 0, width: 1000, height: 1000 } },
  { bounds: { x: 1000, y: 0, width: 1000, height: 1000 } },
];

describe('monitorNumberForBounds', () => {
  it('picks the monitor under the centre of the window', () => {
    expect(monitorNumberForBounds(mons, { x: 100, y: 100, width: 200, height: 200 })).toBe(1);
    expect(monitorNumberForBounds(mons, { x: 1100, y: 100, width: 200, height: 200 })).toBe(2);
  });

  it('uses the centre, not the corner, for a window across the seam', () => {
    // Corner sits on monitor 1, but most of the window is on monitor 2.
    expect(monitorNumberForBounds(mons, { x: 900, y: 0, width: 400, height: 100 })).toBe(2);
  });

  it('returns null for a window left over from a disconnected display', () => {
    expect(monitorNumberForBounds(mons, { x: -3000, y: -3000, width: 100, height: 100 })).toBe(null);
  });

  it('returns null when bounds are missing', () => {
    expect(monitorNumberForBounds(mons, null)).toBe(null);
  });
});

describe('buildSessionList', () => {
  const slots = {
    a1: { titles: ['ccfzf'], cwd: '/p/ccfzf', bounds: { x: 10, y: 10, width: 100, height: 100 }, desktop: 2 },
    b2: { titles: ['gone'], cwd: '/p/gone', bounds: { x: -5000, y: 0, width: 100, height: 100 } },
  };

  it('marks open sessions and carries their window handle', () => {
    const list = buildSessionList({ slots, openMap: new Map([['a1', 777]]), mons });
    const a1 = list.find(s => s.id === 'a1');
    expect(a1.open).toBe(true);
    expect(a1.windowId).toBe(777);
    expect(a1.monitor).toBe(1);
    expect(a1.monitorBounds).toEqual(mons[1].bounds);
    expect(a1.title).toBe('ccfzf');
    expect(a1.cwd).toBe('/p/ccfzf');
    expect(a1.desktop).toBe(2);
  });

  it('marks a session with no window as closed and its desktop as unknown', () => {
    const list = buildSessionList({ slots, openMap: new Map(), mons });
    const b2 = list.find(s => s.id === 'b2');
    expect(b2.open).toBe(false);
    expect(b2.windowId).toBe(null);
    expect(b2.desktop).toBe(null);
    expect(b2.monitor).toBe(null);
    expect(b2.monitorBounds).toBe(null);
  });

  it('returns an empty list when there are no slots', () => {
    expect(buildSessionList({ slots: undefined, openMap: new Map(), mons })).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd /d/projects/js/windows11-manager && npx vitest run src/claude-wt/view-helpers.test.js`
Expected: FAIL — `Failed to load url ./view-helpers.js`

- [ ] **Step 3: Написать чистые помощники**

Создать `src/claude-wt/view-helpers.js`:

```js
/** Pure helpers for the session picker view. No external I/O. */

/**
 * Monitor number for a window, taken from its centre point.
 *
 * The top-left corner lands on the neighbouring monitor for any window that
 * straddles a seam, and outside every monitor for one left at coordinates from
 * a display that is gone. The centre is right in both cases.
 *
 * `mons` is the getMons() array: index 0 is a placeholder, so the index of a
 * monitor is the number used in placement rules.
 */
function monitorNumberForBounds(mons, bounds) {
  if (!bounds) return null;
  const x = bounds.x + Math.floor(bounds.width / 2);
  const y = bounds.y + Math.floor(bounds.height / 2);
  for (let i = 1; i < (mons?.length ?? 0); i++) {
    const b = mons[i]?.bounds;
    if (!b) continue;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return i;
  }
  return null;
}

function buildSessionList({ slots, openMap, mons }) {
  return Object.entries(slots ?? {}).map(([id, slot]) => {
    const bounds = slot.bounds ?? null;
    const monitor = monitorNumberForBounds(mons, bounds);
    return {
      id,
      title: slot.titles?.[0] ?? '',
      cwd: slot.cwd ?? '',
      bounds,
      desktop: slot.desktop ?? null,
      monitor,
      monitorBounds: monitor === null ? null : (mons[monitor]?.bounds ?? null),
      open: openMap.has(id),
      windowId: openMap.get(id) ?? null,
    };
  });
}

export { monitorNumberForBounds, buildSessionList };
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `cd /d/projects/js/windows11-manager && npx vitest run src/claude-wt/view-helpers.test.js`
Expected: PASS, 7 тестов

- [ ] **Step 5: Написать нечистую обёртку**

Создать `src/claude-wt/view.js`:

```js
import { getWindows } from '../windows.js';
import { getMons } from '../monitors.js';
import { readState } from './state.js';
import { loadSessionIndex } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { buildSessionList } from './view-helpers.js';

/**
 * Session id -> hwnd for every claude terminal on screen right now.
 *
 * openSessionIds() answers the same question but throws the handle away, and
 * the picker cannot focus a window it has no handle for.
 */
function openSessionMap(cfg, state) {
  const sessionIndex = loadSessionIndex(cfg.sessionsFile);
  const map = new Map();
  for (const w of getWindows().filter(isTerminalWindow)) {
    const resolved = resolveSession(stripTitleDecoration(w.getTitle()), sessionIndex, state.slots);
    if (resolved && !resolved.ambiguous) map.set(resolved.id, w.id);
  }
  return map;
}

/**
 * Everything the picker needs about claude sessions, open and closed.
 *
 * State comes from disk rather than the daemon's in-memory copy: the daemon
 * writes on every change of the layout fingerprint, so the file is current, and
 * reading it keeps this usable from a process that is not running the watcher.
 */
function claudeWtSessions() {
  const cfg = getClaudeWtConfig();
  if (!cfg.enabled) return { ok: false, reason: 'claudeWt.enabled is false in config' };
  if (!cfg.statePath) return { ok: false, reason: 'claudeWt.statePath is not set in config' };
  const state = readState(cfg.statePath);
  const openMap = openSessionMap(cfg, state);
  return { ok: true, sessions: buildSessionList({ slots: state.slots, openMap, mons: getMons() }) };
}

export { openSessionMap, claudeWtSessions };
```

- [ ] **Step 6: Реэкспортировать из точки входа**

В `src/lib/index.js` после строки `export * from '../claude-wt/restore.js';` добавить:

```js
export * from '../claude-wt/view.js';
```

- [ ] **Step 7: Прогнать весь набор тестов соседа**

Run: `cd /d/projects/js/windows11-manager && npm test`
Expected: PASS, падений нет

- [ ] **Step 8: Коммит**

```bash
cd /d/projects/js/windows11-manager && git add src/claude-wt/view-helpers.js src/claude-wt/view-helpers.test.js src/claude-wt/view.js src/lib/index.js && git commit -m "feat(claude-wt): expose sessions with window handles for the picker"
```

---

### Task 2: Фокус окна и проверка запрета переднего плана

**Это шлагбаум всего плана.** Windows разрешает вывести окно вперёд только процессу, который владеет текущим передним окном или получил последний ввод. Enter будет нажат в окне Tauri, а фокусировать будет Node — другой процесс. Лекарство: Rust зовёт `AllowSetForegroundWindow` для дочернего Node перед отправкой команды.

Задача заодно чинит фантом: `windows.js:141` зовёт `winMan.focusWindow`, которой в пакете нет — топик `windows/focus` падает на первом сообщении.

Временный пункт трея нужен только для ручной проверки; задача 7 его убирает.

**Files:**
- Modify: `D:\projects\js\windows11-manager\src\windows.js`
- Modify: `src/stdin-handler.js:12-25`
- Modify: `src/mqtt-bridge.js:31-33`
- Modify: `src/modules/windows.js`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/main.rs`
- Test: `test/stdin-handler.test.js`

**Interfaces:**
- Consumes: `getWindowById(id)` из `windows.js` соседа (возвращает `Window` или `null`), `claudeWtSessions()` из задачи 1.
- Produces:
  - `focusWindowById(id) -> boolean` (windows11-manager)
  - `handleAction(action, payload)` — обработчики `stdinActions` получают необязательный первый аргумент
  - Rust: `send_command_with(app, action, payload)`, `allow_node_foreground(app)`
  - действие `windows/claude-focus` с нагрузкой `{ id }`

- [ ] **Step 1: Написать падающий тест на нагрузку у действий**

В конец `test/stdin-handler.test.js` добавить:

```js
test('stdin-handler passes payload to handlers', async () => {
  const stdinHandler = require('../src/stdin-handler');
  let got = 'not called';
  stdinHandler.register({ 'test/payload': (payload) => { got = payload; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/payload', { id: 'abc' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(got, { id: 'abc' }, 'handler must receive the payload');
});

test('stdin-handler still calls handlers registered without payload', async () => {
  const stdinHandler = require('../src/stdin-handler');
  let calls = 0;
  stdinHandler.register({ 'test/legacy': () => { calls += 1; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/legacy');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1, 'actions without a payload must keep working');
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/stdin-handler.test.js`
Expected: FAIL на `stdin-handler passes payload to handlers` — `got` остаётся `'not called'`... либо `undefined`; главное, что `deepStrictEqual` не выполняется

- [ ] **Step 3: Провести нагрузку через stdin-handler и мост**

В `src/stdin-handler.js` заменить `handleAction` и разбор строки:

```js
async function handleAction(action, payload) {
  const handler = handlers[action];
  if (!handler) {
    log(`stdin: unknown action "${action}"`, 'warn');
    return;
  }

  try {
    log(`stdin: ${action}`);
    await handler(payload);
  } catch (e) {
    log(`stdin: error in "${action}": ${e.message}`, 'error');
  }
}
```

и в ветке standalone-режима:

```js
      const { action, payload } = cmd;
      if (!action) return;

      await handleAction(action, payload);
```

В `src/mqtt-bridge.js` в `case 'action'` передать нагрузку дальше:

```js
        case 'action':
          this.emit('action', msg.action, msg.payload);
          break;
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `node --test test/stdin-handler.test.js`
Expected: PASS, 3 теста

- [ ] **Step 5: Добавить примитив фокуса соседу**

В `D:\projects\js\windows11-manager\src\windows.js` рядом с `getWindowById` добавить:

```js
// Windows parks minimized windows at x = -32000. restore() un-maximizes a
// maximized window, so it must only be called for one that is actually
// minimized.
const MINIMIZED_X = -30000;

/**
 * Bring a window to the foreground, un-minimizing it first if needed.
 *
 * Consumers used to call a `focusWindow` that this package never defined.
 */
function focusWindowById(id) {
  const w = getWindowById(id);
  if (!w) return false;
  const bounds = w.getBounds();
  if (bounds && bounds.x <= MINIMIZED_X) w.restore();
  w.bringToTop();
  return true;
}
```

и добавить `focusWindowById` в список экспорта в конце файла.

- [ ] **Step 6: Добавить действие фокуса в модуль windows**

В `src/modules/windows.js` рядом с `claudeRestore()` добавить:

```js
  // Focus fails silently unless Rust has granted this process the right to take
  // the foreground first — see picker_send in main.rs.
  async function claudeFocus(payload) {
    const id = payload?.id;
    if (!id) return;
    const res = winMan.claudeWtSessions();
    if (!res.ok) { log(`claude-wt: ${res.reason}`, 'warn'); return; }
    const session = res.sessions.find(s => s.id === id);
    if (!session) { log(`claude-wt: unknown session ${id}`, 'warn'); return; }
    if (session.open && session.desktop) {
      const current = await winMan.virtualDesktop.GetWindowDesktopNumber(session.windowId);
      if (current !== undefined && Number(current) + 1 !== session.desktop) {
        await winMan.virtualDesktop.GoToDesktopNumber(session.desktop);
      }
    }
    if (!session.open || !winMan.focusWindowById(session.windowId)) {
      log(`claude-wt: ${id} is not on screen`, 'warn');
    }
  }
```

и в `stdinActions` добавить строку:

```js
    'windows/claude-focus': (payload) => claudeFocus(payload),
```

- [ ] **Step 7: Подключить крейт windows в Rust**

В `src-tauri/Cargo.toml` после блока `[dependencies]` добавить:

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = ["Win32_Foundation", "Win32_UI_WindowsAndMessaging"] }
```

Если `cargo check` пожалуется на несовместимость версий — посмотреть, какую версию тянет Tauri (`cargo tree -p windows | head -3`), и выставить её.

- [ ] **Step 8: Провести нагрузку и выдачу прав в Rust**

В `src-tauri/src/main.rs` расширить вариант `Action` в `IpcToJs` (строка 47):

```rust
    Action {
        action: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        payload: Option<serde_json::Value>,
    },
```

Заменить `send_command` на пару функций (существующие вызовы `send_command` менять не нужно):

```rust
async fn send_command(app: &tauri::AppHandle, action: &str) {
    send_command_with(app, action, None).await;
}

async fn send_command_with(
    app: &tauri::AppHandle,
    action: &str,
    payload: Option<serde_json::Value>,
) {
    let state = app.state::<ServerState>();
    let mut guard = state.0.lock().await;
    if let Some(ref mut child) = *guard {
        let msg = IpcToJs::Action {
            action: action.to_string(),
            payload,
        };
        let line = match serde_json::to_string(&msg) {
            Ok(s) => s + "\n",
            Err(_) => return,
        };
        if let Err(e) = child.write(line.as_bytes()) {
            let _ = app.emit(
                "server-log",
                LogPayload {
                    message: format!("Failed to send command '{}': {}", action, e),
                    level: "error".into(),
                },
            );
        }
    }
}

/// Hand the foreground right to the Node child.
///
/// Windows only lets the process that owns the foreground window (that is us,
/// while the picker has focus) set it — or hand that right to another process
/// explicitly. Without this the Node child's bringToTop() flashes the taskbar
/// button instead of switching.
#[cfg(windows)]
async fn allow_node_foreground(app: &tauri::AppHandle) {
    use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;
    let state = app.state::<ServerState>();
    let guard = state.0.lock().await;
    if let Some(ref child) = *guard {
        unsafe {
            let _ = AllowSetForegroundWindow(child.pid());
        }
    }
}

#[cfg(not(windows))]
async fn allow_node_foreground(_app: &tauri::AppHandle) {}
```

Дописать `payload: None` в двух остальных местах, где строится `IpcToJs::Action` (в `shutdown_node` и, если есть, в обработчике сообщений моста) — `cargo check` укажет точные строки.

- [ ] **Step 9: Добавить временный пункт трея для ручной проверки**

Рядом с `let claude_restore = MenuItem::with_id(...)` добавить:

```rust
    let claude_focus_probe = MenuItem::with_id(
        app,
        "win_claude_focus_probe",
        "TEMP: focus first claude session",
        true,
        None::<&str>,
    )
    .map_err(m)?;
```

и `menu.append(&claude_focus_probe).map_err(m)?;` после `menu.append(&claude_restore)`.

В `on_menu_event`, перед блоком с таблицей действий, добавить отдельную ветку — она должна выдать право на передний план и передать нагрузку:

```rust
                    if id == "win_claude_focus_probe" {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            allow_node_foreground(&app_handle).await;
                            send_command_with(&app_handle, "windows/claude-focus-probe", None).await;
                        });
                        return;
                    }
```

В `src/modules/windows.js` добавить временное действие, которое фокусирует первую открытую сессию:

```js
    'windows/claude-focus-probe': async () => {
      const res = winMan.claudeWtSessions();
      if (!res.ok) { log(`claude-wt: ${res.reason}`, 'warn'); return; }
      const first = res.sessions.find(s => s.open);
      if (!first) { log('claude-wt: no open sessions', 'warn'); return; }
      log(`claude-wt: focusing ${first.title}`);
      await claudeFocus({ id: first.id });
    },
```

- [ ] **Step 10: Собрать и проверить руками**

Run: `node --test test/**/*.test.js` — Expected: PASS
Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo check` — Expected: `Finished`, ошибок нет
Run: `npm run deploy-local` (см. AGENTS.md; команда не завершается сама, потому что запускает приложение с унаследованным stdout — это нормально, проверять по запущенному процессу)

Ручная проверка: открыть хотя бы одно окно Windows Terminal с claude-сессией, увести фокус на другое приложение, нажать в трее «TEMP: focus first claude session».

**Ожидаемо:** окно терминала выходит на передний план.
**Провал:** кнопка на панели задач мигает, окно не выходит.

- [ ] **Step 11: Если провалилось — запасной путь**

Перенести сам вызов фокуса в Rust: вместо отправки действия в Node вызвать `SetForegroundWindow(HWND(window_id))` прямо из обработчика, а хендл получить из Node заранее (он уже приходит в списке сессий). Node в этом случае отвечает только за переключение виртуального стола. Записать выбранный путь в спеку в раздел «Действия» и продолжать.

- [ ] **Step 12: Коммит**

```bash
cd /d/projects/js/windows11-manager && git add src/windows.js && git commit -m "feat(windows): add focusWindowById, the focus primitive consumers assumed existed"
cd /d/projects/js/windows-mqtt && git add src/stdin-handler.js src/mqtt-bridge.js src/modules/windows.js src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/main.rs test/stdin-handler.test.js && git commit -m "feat(picker): focus a claude session, with the foreground right granted from Rust"
```

---

### Task 3: Подписи и группировка

Чистое преобразование плоского списка сессий в группы, готовые к отрисовке.

**Files:**
- Create: `src/picker/session-groups.js`
- Create: `test/picker-session-groups.test.js`

**Interfaces:**
- Consumes: `Session` из задачи 1.
- Produces:
  - `labelSessions(sessions) -> Session[]` — каждая запись получает поле `label`
  - `groupSessions(sessions) -> Group[]`, где `Group = { desktop, monitor, label, sessions }`

- [ ] **Step 1: Написать падающий тест**

Создать `test/picker-session-groups.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { labelSessions, groupSessions } = require('../src/picker/session-groups');

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, monitorBounds: null, open: true, windowId: 1, ...over,
});

test('labelSessions leaves a unique name alone', () => {
  const out = labelSessions([s({ id: 'aaaa1111', title: 'ccfzf' })]);
  assert.strictEqual(out[0].label, 'ccfzf');
});

test('labelSessions disambiguates identical name and project with an id prefix', () => {
  const out = labelSessions([
    s({ id: 'aaaa1111', title: 'agent', cwd: '/p/agent' }),
    s({ id: 'bbbb2222', title: 'agent', cwd: '/p/agent' }),
  ]);
  assert.strictEqual(out[0].label, 'agent (aaaa)');
  assert.strictEqual(out[1].label, 'agent (bbbb)');
});

test('labelSessions leaves same name in different projects alone', () => {
  const out = labelSessions([
    s({ id: 'a', title: 'agent', cwd: '/one' }),
    s({ id: 'b', title: 'agent', cwd: '/two' }),
  ]);
  assert.strictEqual(out[0].label, 'agent');
  assert.strictEqual(out[1].label, 'agent');
});

test('groupSessions sorts by x, then by y', () => {
  const [group] = groupSessions([
    s({ id: 'c', bounds: { x: 300, y: 0, width: 10, height: 10 } }),
    s({ id: 'a', bounds: { x: 100, y: 200, width: 10, height: 10 } }),
    s({ id: 'b', bounds: { x: 100, y: 10, width: 10, height: 10 } }),
  ]);
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['b', 'a', 'c']);
});

test('groupSessions splits by desktop and monitor and labels each group', () => {
  const groups = groupSessions([
    s({ id: 'a', desktop: 1, monitor: 1 }),
    s({ id: 'b', desktop: 1, monitor: 2 }),
    s({ id: 'c', desktop: 2, monitor: 1 }),
  ]);
  assert.deepStrictEqual(groups.map(g => g.label), [
    'Desktop 1 · Monitor 1',
    'Desktop 1 · Monitor 2',
    'Desktop 2 · Monitor 1',
  ]);
});

test('groupSessions puts an unknown desktop first and an unknown monitor last', () => {
  const groups = groupSessions([
    s({ id: 'a', desktop: 1, monitor: null }),
    s({ id: 'b', desktop: 1, monitor: 2 }),
    s({ id: 'c', desktop: null, monitor: 1 }),
  ]);
  assert.deepStrictEqual(groups.map(g => g.label), [
    'Desktop — · Monitor 1',
    'Desktop 1 · Monitor 2',
    'Desktop 1 · Unknown monitor',
  ]);
});

test('groupSessions tolerates a session with no bounds', () => {
  const [group] = groupSessions([s({ id: 'a', bounds: null })]);
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['a']);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/picker-session-groups.test.js`
Expected: FAIL — `Cannot find module '../src/picker/session-groups'`

- [ ] **Step 3: Написать реализацию**

Создать `src/picker/session-groups.js`:

```js
/** Pure shaping of the claude-wt session list for the picker. No I/O. */

const SEP = '\u0000';

// Sorting keys for the two "unknown" cases: an unknown desktop sorts before
// every real one, an unknown monitor after.
const DESKTOP_UNKNOWN = -1;
const MONITOR_UNKNOWN = Number.MAX_SAFE_INTEGER;

/**
 * Disambiguate rows that would read identically.
 *
 * Two slots can share both name and project — the same session reopened, or one
 * live and one stale. Nothing else on the row differs, so choosing between them
 * becomes a guess; a short id prefix is the cheapest thing that does not.
 */
function labelSessions(sessions) {
  const counts = new Map();
  for (const s of sessions) {
    const key = `${s.title}${SEP}${s.cwd}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sessions.map(s => {
    const key = `${s.title}${SEP}${s.cwd}`;
    const label = counts.get(key) > 1 ? `${s.title} (${String(s.id).slice(0, 4)})` : s.title;
    return { ...s, label };
  });
}

function groupLabel(desktop, monitor) {
  const d = desktop === null ? 'Desktop —' : `Desktop ${desktop}`;
  const m = monitor === null ? 'Unknown monitor' : `Monitor ${monitor}`;
  return `${d} · ${m}`;
}

function groupSessions(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const desktop = s.desktop ?? null;
    const monitor = s.monitor ?? null;
    const key = `${desktop}${SEP}${monitor}`;
    if (!groups.has(key)) groups.set(key, { desktop, monitor, label: groupLabel(desktop, monitor), sessions: [] });
    groups.get(key).sessions.push(s);
  }

  const list = [...groups.values()];
  for (const g of list) {
    g.sessions.sort((a, b) =>
      (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0) ||
      (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
  }
  list.sort((a, b) =>
    (a.desktop ?? DESKTOP_UNKNOWN) - (b.desktop ?? DESKTOP_UNKNOWN) ||
    (a.monitor ?? MONITOR_UNKNOWN) - (b.monitor ?? MONITOR_UNKNOWN));
  return list;
}

module.exports = { labelSessions, groupSessions };
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `node --test test/picker-session-groups.test.js`
Expected: PASS, 7 тестов

- [ ] **Step 5: Коммит**

```bash
git add src/picker/session-groups.js test/picker-session-groups.test.js && git commit -m "feat(picker): group and label claude sessions by desktop and monitor"
```

---

### Task 4: Фильтр строки поиска

Фильтр живёт в webview, поэтому обязан работать в браузере без сборщика — и при этом быть тестируемым в Node. Отсюда обёртка UMD: сборщика в проекте нет, а дублировать логику ради тестов хуже.

**Files:**
- Create: `frontend-src/picker-filter.js`
- Create: `test/picker-filter.test.js`

**Interfaces:**
- Consumes: `Group[]` из задачи 3.
- Produces: `filterSessions(groups, query) -> Group[]`; в браузере доступен как `window.PickerFilter.filterSessions`.

- [ ] **Step 1: Написать падающий тест**

Создать `test/picker-filter.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { filterSessions } = require('../frontend-src/picker-filter');

const groups = () => ([
  {
    label: 'Desktop 1 · Monitor 1',
    sessions: [
      { id: 'a', label: 'ccfzf', cwd: '/home/popstas/projects/shell/ccfzf' },
      { id: 'b', label: 'b2b-kpi', cwd: '/home/popstas/projects/text/ExpertizeMe' },
    ],
  },
  {
    label: 'Desktop 2 · Monitor 1',
    sessions: [
      { id: 'c', label: 'do', cwd: '/home/popstas/projects/text/skill-do' },
    ],
  },
]);

test('an empty query returns everything unchanged', () => {
  assert.deepStrictEqual(filterSessions(groups(), ''), groups());
  assert.deepStrictEqual(filterSessions(groups(), '   '), groups());
});

test('matches the session name regardless of case', () => {
  const out = filterSessions(groups(), 'CCF');
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].sessions.map(s => s.id), ['a']);
});

test('matches the project path too', () => {
  const out = filterSessions(groups(), 'expertize');
  assert.deepStrictEqual(out[0].sessions.map(s => s.id), ['b']);
});

test('drops groups where nothing matched', () => {
  const out = filterSessions(groups(), 'skill-do');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].label, 'Desktop 2 · Monitor 1');
});

test('returns an empty list when nothing matches', () => {
  assert.deepStrictEqual(filterSessions(groups(), 'zzzz'), []);
});

test('does not mutate the input', () => {
  const input = groups();
  filterSessions(input, 'ccf');
  assert.strictEqual(input[0].sessions.length, 2);
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/picker-filter.test.js`
Expected: FAIL — `Cannot find module '../frontend-src/picker-filter'`

- [ ] **Step 3: Написать реализацию**

Создать `frontend-src/picker-filter.js`:

```js
// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating the filter to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PickerFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function filterSessions(groups, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(g => ({ ...g, sessions: g.sessions.filter(s =>
        `${s.label} ${s.cwd}`.toLowerCase().includes(q)) }))
      .filter(g => g.sessions.length > 0);
  }

  return { filterSessions };
});
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `node --test test/picker-filter.test.js`
Expected: PASS, 6 тестов

- [ ] **Step 5: Коммит**

```bash
git add frontend-src/picker-filter.js test/picker-filter.test.js && git commit -m "feat(picker): filter sessions by name and project"
```

---

### Task 5: Канал данных Node → webview

Node собирает готовые группы и толкает их в окно пикера. Отправка идёт по таймеру, пока окно открыто, и прекращается по его закрытию.

**Files:**
- Modify: `src/mqtt-bridge.js`
- Modify: `src/modules/windows.js`
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `claudeWtSessions()` (задача 1), `labelSessions`/`groupSessions` (задача 3), `send_command_with` (задача 2).
- Produces:
  - `mqtt.sendEvent(name, payload)` — строка `{type:'event', name, payload}` в stdout
  - Tauri-событие `claude-wt-sessions` в окно `sessions` с нагрузкой `{ ok: true, groups } | { ok: false, reason }`
  - действия `windows/claude-sessions-start`, `windows/claude-sessions-stop`, `windows/claude-restore-one`

- [ ] **Step 1: Добавить отправку событий в мост**

В `src/mqtt-bridge.js` перед методом `end()` добавить:

```js
  /** Push arbitrary data to the Tauri webview. Rust re-emits it as an event. */
  sendEvent(name, payload) {
    this._send({ type: 'event', name, payload });
  }
```

- [ ] **Step 2: Добавить сборку и отправку списка в модуль windows**

В `src/modules/windows.js` в начало файла добавить импорт:

```js
const {labelSessions, groupSessions} = require('../picker/session-groups');
```

Рядом с `claudeFocus` добавить:

```js
  let sessionsTimerId = null;

  function sendSessions() {
    if (typeof mqtt.sendEvent !== 'function') return;
    const res = winMan.claudeWtSessions();
    if (!res.ok) {
      mqtt.sendEvent('claude-wt-sessions', {ok: false, reason: res.reason});
      return;
    }
    mqtt.sendEvent('claude-wt-sessions', {
      ok: true,
      groups: groupSessions(labelSessions(res.sessions)),
    });
  }

  // Only runs while the picker window is open: it scans every terminal window
  // once a second, which is not something to do in the background forever.
  function startSessionsFeed() {
    sendSessions();
    if (sessionsTimerId === null) sessionsTimerId = setInterval(sendSessions, 1000);
  }

  function stopSessionsFeed() {
    if (sessionsTimerId !== null) {
      clearInterval(sessionsTimerId);
      sessionsTimerId = null;
    }
  }

  async function claudeRestoreOne(payload) {
    const id = payload?.id;
    if (!id) return;
    try {
      const {restored, skipped} = await winMan.restoreClaudeSessions({sessionIds: [id]});
      log(`claude-wt restored ${restored.length}, skipped ${skipped.length}`);
      if (!restored.length) notifyPicker(`claude-wt: не удалось поднять сессию ${id}`);
    } catch (e) {
      log(`claude-wt restore failed: ${e.message}`, 'error');
      notifyPicker(`claude-wt: ошибка восстановления — ${e.message}`);
    }
  }

  // A silent failure is worse than one extra toast: the picker is already gone
  // by the time restore finishes, so the log is the only other channel.
  function notifyPicker(message) {
    mqtt.publish(globalConfig.mqtt.base + '/notify/notify', message);
  }
```

В `stdinActions` добавить три строки:

```js
    'windows/claude-sessions-start': () => startSessionsFeed(),
    'windows/claude-sessions-stop': () => stopSessionsFeed(),
    'windows/claude-restore-one': (payload) => claudeRestoreOne(payload),
```

В `onStop` добавить `stopSessionsFeed();` рядом с `winMan.stopClaudeWt()`.

- [ ] **Step 3: Принять событие в Rust и переслать в окно**

В `src-tauri/src/main.rs` в перечисление `IpcFromJs` добавить вариант:

```rust
    Event {
        name: String,
        #[serde(default)]
        payload: serde_json::Value,
    },
```

В `match` по `IpcFromJs` (около строки 258) добавить ветку:

```rust
                            IpcFromJs::Event { name, payload } => {
                                let _ = app_handle.emit_to("sessions", &name, payload);
                            }
```

`emit_to` приходит из трейта `tauri::Emitter` — он уже импортирован ради `app.emit`. Имя переменной с `AppHandle` в этом месте взять из соседних веток (`cargo check` покажет, если не совпало).

- [ ] **Step 4: Проверить сборку и тесты**

Run: `node --test test/**/*.test.js` — Expected: PASS
Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo check` — Expected: `Finished`

- [ ] **Step 5: Коммит**

```bash
git add src/mqtt-bridge.js src/modules/windows.js src-tauri/src/main.rs && git commit -m "feat(picker): push grouped session list from Node to the webview"
```

---

### Task 6: Окно палитры

Разметка, стиль и поведение. Отдельная страница, ничего общего с логом.

**Files:**
- Create: `sessions.html`
- Modify: `scripts/prepare-frontend.js`
- Modify: `test/tauri-config.test.js`

**Interfaces:**
- Consumes: событие `claude-wt-sessions`, `window.PickerFilter.filterSessions` (задача 4), команды Tauri `picker_send` и `hide_picker` (задача 7).
- Produces: страница `sessions.html`, копируемая в `frontend/` вместе с `picker-filter.js`.

- [ ] **Step 1: Написать падающий тест на сборку фронтенда**

В конец `test/tauri-config.test.js` добавить:

```js
test('prepare-frontend copies both pages and the picker filter', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'prepare-frontend.js'), 'utf8');
  for (const file of ['index.html', 'sessions.html', 'picker-filter.js']) {
    assert.ok(src.includes(file), `prepare-frontend.js must copy ${file}`);
  }
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/tauri-config.test.js`
Expected: FAIL — `prepare-frontend.js must copy sessions.html`

- [ ] **Step 3: Расширить сборку фронтенда**

Заменить содержимое `scripts/prepare-frontend.js`:

```js
var fs = require('fs');
fs.mkdirSync('frontend', { recursive: true });
fs.copyFileSync('index.html', 'frontend/index.html');
fs.copyFileSync('sessions.html', 'frontend/sessions.html');
fs.copyFileSync('frontend-src/picker-filter.js', 'frontend/picker-filter.js');
```

- [ ] **Step 4: Написать страницу пикера**

Создать `sessions.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>claude sessions</title>
    <style>
        :root { color-scheme: dark; }
        * { box-sizing: border-box; }
        body {
            margin: 0; height: 100vh; overflow: hidden;
            font-family: "Segoe UI", Arial, sans-serif;
            background: #1e1f22; color: #e6e6e6;
            border: 1px solid #3a3d42; border-radius: 10px;
        }
        #search {
            width: 100%; padding: 16px 18px; font-size: 18px;
            background: transparent; color: inherit;
            border: none; border-bottom: 1px solid #3a3d42; outline: none;
        }
        #list { height: calc(100vh - 59px); overflow-y: auto; padding: 6px 0; }
        .group-label {
            padding: 8px 18px 4px; font-size: 10px; letter-spacing: .08em;
            text-transform: uppercase; color: #7d838c;
        }
        .row {
            display: flex; align-items: center; gap: 12px;
            padding: 7px 18px; cursor: pointer;
        }
        .row.active { background: #2f6fd0; }
        .row.active .cwd { color: #d5e3f7; }
        .glyph {
            flex: 0 0 auto; width: 40px; height: 26px; position: relative;
            border: 1px solid #565b63; border-radius: 2px;
        }
        .glyph i { position: absolute; background: #62a0ff; border-radius: 1px; }
        .row.closed .glyph { border-style: dashed; }
        .row.closed .glyph i { background: #7d838c; }
        .row.closed .name { color: #a8adb5; }
        .text { min-width: 0; }
        .name { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cwd { font-size: 11px; color: #868c95; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .badge { margin-left: 6px; font-size: 10px; color: #868c95; }
        #message { padding: 24px 18px; color: #868c95; font-size: 13px; }
    </style>
</head>
<body>
<input id="search" type="text" placeholder="Search claude sessions…" autocomplete="off" spellcheck="false">
<div id="list"></div>
<div id="message">Loading…</div>
<script src="picker-filter.js"></script>
<script>
  let groups = [];
  let rows = [];
  let active = 0;

  const search = document.getElementById('search');
  const list = document.getElementById('list');
  const message = document.getElementById('message');

  function invoke(cmd, args) {
    if (!window.__TAURI__) return Promise.resolve();
    return window.__TAURI__.core.invoke(cmd, args);
  }

  // The window is a rectangle of the monitor scaled to fit the glyph; the
  // filled part is where the window sits on it.
  function glyphHtml(session) {
    const mb = session.monitorBounds;
    const b = session.bounds;
    if (!mb || !b || !mb.width || !mb.height) return '<div class="glyph"></div>';
    const left = Math.max(0, Math.min(100, ((b.x - mb.x) / mb.width) * 100));
    const top = Math.max(0, Math.min(100, ((b.y - mb.y) / mb.height) * 100));
    const width = Math.max(4, Math.min(100 - left, (b.width / mb.width) * 100));
    const height = Math.max(4, Math.min(100 - top, (b.height / mb.height) * 100));
    return `<div class="glyph"><i style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"></i></div>`;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }

  function render() {
    const visible = window.PickerFilter.filterSessions(groups, search.value);
    rows = [];
    let html = '';
    for (const group of visible) {
      html += `<div class="group-label">${escapeHtml(group.label)}</div>`;
      for (const session of group.sessions) {
        const index = rows.length;
        rows.push(session);
        html += `<div class="row ${session.open ? '' : 'closed'}" data-index="${index}">` +
          glyphHtml(session) +
          `<div class="text"><div class="name">${escapeHtml(session.label)}` +
          `${session.open ? '' : '<span class="badge">closed</span>'}</div>` +
          `<div class="cwd">${escapeHtml(session.cwd)}</div></div></div>`;
      }
    }
    list.innerHTML = html;
    message.style.display = rows.length ? 'none' : 'block';
    if (!rows.length) message.textContent = groups.length ? 'Nothing matches.' : 'No claude sessions yet.';
    if (active >= rows.length) active = Math.max(0, rows.length - 1);
    paint();
  }

  function paint() {
    const nodes = list.querySelectorAll('.row');
    nodes.forEach((node, i) => node.classList.toggle('active', i === active));
    const current = nodes[active];
    if (current) current.scrollIntoView({ block: 'nearest' });
  }

  function move(delta) {
    if (!rows.length) return;
    active = (active + delta + rows.length) % rows.length;
    paint();
  }

  async function choose() {
    const session = rows[active];
    if (!session) return;
    await invoke('hide_picker');
    await invoke('picker_send', {
      action: session.open ? 'windows/claude-focus' : 'windows/claude-restore-one',
      payload: { id: session.id },
    });
  }

  search.addEventListener('input', () => { active = 0; render(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(); }
    else if (e.key === 'Escape') { e.preventDefault(); invoke('hide_picker'); }
  });

  list.addEventListener('click', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    active = Number(row.dataset.index);
    choose();
  });

  async function start() {
    if (!window.__TAURI__) { message.textContent = 'No backend detected.'; return; }
    const { listen } = window.__TAURI__.event;

    await listen('claude-wt-sessions', (event) => {
      const data = event.payload || {};
      if (!data.ok) {
        groups = [];
        render();
        message.style.display = 'block';
        message.textContent = data.reason || 'claude-wt is not available.';
        return;
      }
      groups = data.groups || [];
      render();
    });

    // Fired by Rust every time the window is shown.
    await listen('picker-shown', () => {
      search.value = '';
      active = 0;
      search.focus();
      search.select();
      invoke('picker_send', { action: 'windows/claude-sessions-start' });
    });

    await listen('picker-hidden', () => {
      invoke('picker_send', { action: 'windows/claude-sessions-stop' });
    });

    setTimeout(() => {
      if (!groups.length && message.textContent === 'Loading…') {
        message.textContent = 'Backend not responding.';
      }
    }, 2000);

    search.focus();
    invoke('picker_send', { action: 'windows/claude-sessions-start' });
  }

  window.addEventListener('DOMContentLoaded', () => { start(); });
</script>
</body>
</html>
```

- [ ] **Step 5: Запустить тесты**

Run: `node --test test/**/*.test.js`
Expected: PASS, включая новый тест на `prepare-frontend`

- [ ] **Step 6: Коммит**

```bash
git add sessions.html scripts/prepare-frontend.js test/tauri-config.test.js && git commit -m "feat(picker): palette window with search, keyboard navigation and position glyphs"
```

---

### Task 7: Окно, хоткей, трей и конфиг

Объявление окна, показ по центру активного монитора, глобальный хоткей из конфига, выбор поведения левого клика по трею. Здесь же убирается временный пункт трея из задачи 2.

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/src/main.rs`
- Modify: `config.example.yml`
- Modify: `C:\Users\popstas\AppData\Roaming\windows-mqtt\config.yml`
- Test: `src-tauri/src/main.rs` (модуль `tests`)

**Interfaces:**
- Consumes: `show_picker`, `send_command_with`, `allow_node_foreground` (задача 2).
- Produces:
  - `parse_picker_config(yaml: &str) -> PickerConfig`, где `PickerConfig { hotkey: String, tray_left_click_picker: bool }`
  - команды Tauri `picker_send(action, payload)` и `hide_picker()`
  - события окна `picker-shown` и `picker-hidden`

- [ ] **Step 1: Написать падающий тест на разбор конфига**

В `src-tauri/src/main.rs` в модуль `#[cfg(test)] mod tests` добавить:

```rust
    use super::parse_picker_config;

    #[test]
    fn picker_config_falls_back_to_defaults() {
        let cfg = parse_picker_config("modules:\n  windows:\n    claudeWt: true\n");
        assert_eq!(cfg.hotkey, "Super+F10");
        assert!(!cfg.tray_left_click_picker);
    }

    #[test]
    fn picker_config_reads_hotkey_and_tray_choice() {
        let cfg = parse_picker_config("picker:\n  hotkey: 'Ctrl+Alt+J'\ntray:\n  leftClick: picker\n");
        assert_eq!(cfg.hotkey, "Ctrl+Alt+J");
        assert!(cfg.tray_left_click_picker);
    }

    #[test]
    fn picker_config_treats_any_other_tray_choice_as_log() {
        let cfg = parse_picker_config("tray:\n  leftClick: log\n");
        assert!(!cfg.tray_left_click_picker);
    }

    #[test]
    fn picker_config_survives_broken_yaml() {
        let cfg = parse_picker_config("\t\tnot: [valid");
        assert_eq!(cfg.hotkey, "Super+F10");
    }
```

Строку `use super::{describe_child_exit, find_app_root};` оставить как есть.

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test`
Expected: FAIL — `cannot find function parse_picker_config`

- [ ] **Step 3: Написать разбор конфига**

В `src-tauri/src/main.rs` рядом с `read_enabled_modules` добавить:

```rust
#[derive(Debug, Clone)]
struct PickerConfig {
    hotkey: String,
    tray_left_click_picker: bool,
}

const DEFAULT_PICKER_HOTKEY: &str = "Super+F10";

/// Parsed separately from reading the file so the parsing has tests.
fn parse_picker_config(content: &str) -> PickerConfig {
    let value: serde_yaml::Value = match serde_yaml::from_str(content) {
        Ok(v) => v,
        Err(_) => serde_yaml::Value::Null,
    };
    let hotkey = value
        .get("picker")
        .and_then(|p| p.get("hotkey"))
        .and_then(|h| h.as_str())
        .unwrap_or(DEFAULT_PICKER_HOTKEY)
        .to_string();
    let tray_left_click_picker = value
        .get("tray")
        .and_then(|t| t.get("leftClick"))
        .and_then(|v| v.as_str())
        .map(|s| s == "picker")
        .unwrap_or(false);
    PickerConfig {
        hotkey,
        tray_left_click_picker,
    }
}

fn read_picker_config(config_path: &PathBuf) -> PickerConfig {
    match std::fs::read_to_string(config_path) {
        Ok(content) => parse_picker_config(&content),
        Err(_) => parse_picker_config(""),
    }
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test`
Expected: PASS, 4 новых теста

- [ ] **Step 5: Объявить окно**

В `src-tauri/tauri.conf.json` в массив `app.windows` после объекта `main` добавить:

```json
      {
        "label": "sessions",
        "url": "sessions.html",
        "title": "claude sessions",
        "width": 720,
        "height": 480,
        "decorations": false,
        "alwaysOnTop": true,
        "skipTaskbar": true,
        "resizable": false,
        "visible": false
      }
```

- [ ] **Step 6: Написать показ, скрытие и команды**

В `src-tauri/src/main.rs` добавить рядом с `send_command_with`:

```rust
/// Show the picker centred on the monitor the cursor is on.
///
/// The `center: true` window option centres on the primary monitor, which is
/// the wrong one whenever the user is working somewhere else, so the position
/// is computed at every show.
fn show_picker(app: &tauri::AppHandle) {
    let window = match app.get_webview_window("sessions") {
        Some(w) => w,
        None => return,
    };
    if let (Ok(cursor), Ok(size)) = (app.cursor_position(), window.outer_size()) {
        if let Ok(Some(monitor)) = window.monitor_from_point(cursor.x, cursor.y) {
            let mp = monitor.position();
            let ms = monitor.size();
            let x = mp.x + (ms.width as i32 - size.width as i32) / 2;
            // A third of the way down reads as a palette; dead centre reads as a dialog.
            let y = mp.y + (ms.height as i32 - size.height as i32) / 3;
            let _ = window.set_position(tauri::PhysicalPosition { x, y });
        }
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.emit("picker-shown", ());
}

fn hide_picker_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("sessions") {
        let _ = window.hide();
        let _ = window.emit("picker-hidden", ());
    }
}

#[tauri::command]
async fn picker_send(
    app: tauri::AppHandle,
    action: String,
    payload: Option<serde_json::Value>,
) {
    allow_node_foreground(&app).await;
    send_command_with(&app, &action, payload).await;
}

#[tauri::command]
fn hide_picker(app: tauri::AppHandle) {
    hide_picker_window(&app);
}
```

`window.emit` требует трейта `tauri::Emitter` — он уже импортирован.

Зарегистрировать команды: в `invoke_handler` заменить список на

```rust
        .invoke_handler(tauri::generate_handler![
            start_mqtt_server,
            get_enabled_modules,
            picker_send,
            hide_picker
        ])
```

- [ ] **Step 7: Скрывать окно при потере фокуса**

В `.on_window_event(|window, event| { ... })` заменить тело на:

```rust
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let _ = window.hide();
                api.prevent_close();
            }
            // The palette is modal by habit: clicking elsewhere dismisses it.
            WindowEvent::Focused(false) if window.label() == "sessions" => {
                let _ = window.hide();
                let _ = window.emit("picker-hidden", ());
            }
            _ => {}
        })
```

- [ ] **Step 8: Обобщить хоткей и подключить конфиг**

Заменить `register_shortcut` так, чтобы действие приходило параметром:

```rust
fn register_shortcut(app: &tauri::AppHandle, shortcut_str: &str) -> Result<(), String> {
    register_shortcut_action(app, shortcut_str, ShortcutAction::Autoplace)
}

#[derive(Clone, Copy)]
enum ShortcutAction {
    Autoplace,
    ShowPicker,
}

fn register_shortcut_action(
    app: &tauri::AppHandle,
    shortcut_str: &str,
    what: ShortcutAction,
) -> Result<(), String> {
    if shortcut_str.is_empty() {
        return Ok(());
    }
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut_str, move |_app, _shortcut, _event| {
            let app_handle = app_clone.clone();
            match what {
                ShortcutAction::Autoplace => {
                    tauri::async_runtime::spawn(async move {
                        send_command(&app_handle, "windows/autoplace").await;
                    });
                }
                ShortcutAction::ShowPicker => show_picker(&app_handle),
            }
        })
        .map_err(|e| e.to_string())
}
```

В `setup()`, там же, где резолвится конфиг для `get_enabled_modules`, зарегистрировать хоткей пикера:

```rust
            let app_root = resolve_app_root(&app.handle())?;
            let picker_cfg = read_picker_config(&resolve_config_path(&app.handle(), &app_root));
            if let Err(e) = register_shortcut_action(
                &app.handle(),
                &picker_cfg.hotkey,
                ShortcutAction::ShowPicker,
            ) {
                let _ = app.handle().emit(
                    "server-log",
                    LogPayload {
                        message: format!(
                            "Picker hotkey '{}' not registered: {}",
                            picker_cfg.hotkey, e
                        ),
                        level: "warn".into(),
                    },
                );
            }
            app.manage(picker_cfg);
```

Чтобы `app.manage(picker_cfg)` работал, добавить `#[derive(Debug, Clone)]` уже есть; тип используется как managed state.

- [ ] **Step 9: Пункт трея и левый клик**

Заменить временный пункт из задачи 2 на постоянный. Убрать объявление `claude_focus_probe`, его `menu.append` и ветку `win_claude_focus_probe` в `on_menu_event`; убрать действие `windows/claude-focus-probe` из `src/modules/windows.js`.

Добавить рядом с `claude_restore`:

```rust
    let claude_picker = MenuItem::with_id(
        app,
        "win_claude_picker",
        "Claude sessions…",
        true,
        None::<&str>,
    )
    .map_err(m)?;
```

и `menu.append(&claude_picker).map_err(m)?;` после `menu.append(&claude_restore)`.

В `on_menu_event` перед таблицей действий добавить:

```rust
                    if id == "win_claude_picker" {
                        show_picker(app);
                        return;
                    }
```

В `on_tray_icon_event` заменить тело ветки левого клика:

```rust
                        let app = tray.app_handle();
                        let opens_picker = app
                            .try_state::<PickerConfig>()
                            .map(|cfg| cfg.tray_left_click_picker)
                            .unwrap_or(false);
                        if opens_picker {
                            let visible = app
                                .get_webview_window("sessions")
                                .and_then(|w| w.is_visible().ok())
                                .unwrap_or(false);
                            if visible {
                                hide_picker_window(app);
                            } else {
                                show_picker(app);
                            }
                        } else if let Some(window) = app.get_webview_window("main") {
                            let is_visible = window.is_visible().unwrap_or(false);
                            if is_visible {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
```

- [ ] **Step 10: Конфиг**

В `config.example.yml` перед строкой `modules:` (на верхнем уровне) добавить:

```yaml
picker:
  # Global hotkey for the claude session picker. Windows swallows some Win+
  # combinations before they reach the app; change this if it never fires.
  hotkey: 'Super+F10'
tray:
  # What a left click on the tray icon opens: picker | log
  leftClick: log
```

В рабочий конфиг `C:\Users\popstas\AppData\Roaming\windows-mqtt\config.yml` добавить то же самое, но с `leftClick: picker`.

- [ ] **Step 11: Собрать и проверить**

Run: `node --test test/**/*.test.js` — Expected: PASS
Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test` — Expected: PASS
Run: `npm run deploy-local`

Ручная проверка:
1. Win+F10 — окно без заголовка появляется по центру монитора с курсором, курсор в поле поиска.
2. Ввод части имени проекта сужает список; ↑/↓ ходят по строкам; Esc закрывает; клик мимо окна закрывает.
3. Enter на открытой сессии переключает на её окно, в том числе с другого виртуального стола.
4. Enter на закрытой сессии поднимает терминал; в логе — `claude-wt restored 1, skipped 0`.
5. Левый клик по трею открывает пикер; пункт «Show App» открывает лог.

- [ ] **Step 12: Коммит**

```bash
git add src-tauri/src/main.rs src-tauri/tauri.conf.json config.example.yml src/modules/windows.js && git commit -m "feat(picker): palette window, Win+F10 hotkey and tray left-click choice"
```

---

### Task 8: Устойчивость к отказам

Пикер не должен показывать пустоту без объяснения и не должен ломаться о мёртвый хендл.

**Files:**
- Modify: `src/modules/windows.js`
- Test: `test/picker-session-groups.test.js`

**Interfaces:**
- Consumes: `claudeWtSessions()`, `focusWindowById()`.
- Produces: поведение при отсутствии `windows11-manager`, при мёртвом хендле окна и при выключенном claude-wt.

- [ ] **Step 1: Написать падающий тест на мёртвый хендл**

Тестируется только чистая часть — решение, каким путём идти. Добавить в `src/picker/session-groups.js` функцию выбора действия и тест на неё.

В `test/picker-session-groups.test.js` добавить:

```js
const { chooseAction } = require('../src/picker/session-groups');

test('chooseAction focuses a session that is open', () => {
  assert.strictEqual(chooseAction({ open: true, windowId: 5 }, () => true), 'focus');
});

test('chooseAction restores a session that is closed', () => {
  assert.strictEqual(chooseAction({ open: false, windowId: null }, () => true), 'restore');
});

test('chooseAction restores when the handle died since the list was drawn', () => {
  assert.strictEqual(chooseAction({ open: true, windowId: 5 }, () => false), 'restore');
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `node --test test/picker-session-groups.test.js`
Expected: FAIL — `chooseAction is not a function`

- [ ] **Step 3: Реализовать выбор действия**

В `src/picker/session-groups.js` добавить и экспортировать:

```js
/**
 * Which way to go for the session the user just picked.
 *
 * The window could have been closed while the list sat on screen, so the handle
 * is checked at the moment of the action rather than kept fresh by polling.
 */
function chooseAction(session, isAlive) {
  if (session.open && session.windowId && isAlive(session.windowId)) return 'focus';
  return 'restore';
}
```

и добавить `chooseAction` в `module.exports`.

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `node --test test/picker-session-groups.test.js`
Expected: PASS, 10 тестов

- [ ] **Step 5: Использовать выбор действия и закрыть остальные отказы**

В `src/modules/windows.js` заменить тело `claudeFocus` так, чтобы мёртвый хендл уходил на восстановление:

```js
  async function claudeFocus(payload) {
    const id = payload?.id;
    if (!id) return;
    const res = winMan.claudeWtSessions();
    if (!res.ok) { log(`claude-wt: ${res.reason}`, 'warn'); return; }
    const session = res.sessions.find(s => s.id === id);
    if (!session) { log(`claude-wt: unknown session ${id}`, 'warn'); return; }

    const action = chooseAction(session, (windowId) => !!winMan.getWindowById(windowId));
    if (action === 'restore') {
      await claudeRestoreOne({id});
      return;
    }

    if (session.desktop) {
      const current = await winMan.virtualDesktop.GetWindowDesktopNumber(session.windowId);
      if (current !== undefined && Number(current) + 1 !== session.desktop) {
        await winMan.virtualDesktop.GoToDesktopNumber(session.desktop);
      }
    }
    winMan.focusWindowById(session.windowId);
  }
```

и добавить `chooseAction` в импорт из `../picker/session-groups`.

- [ ] **Step 6: Откат трея на лог, когда пикера не может быть**

`windows11-manager` — `optionalDependency`; без него модуль `windows` не грузится и данных для пикера нет. В `src-tauri/src/main.rs` в `show_picker` перед показом окна ничего проверять не нужно — окно само покажет причину, полученную от Node. Но если Node не отвечает вовсе, окно останется с «Backend not responding», и это правильное поведение: сообщение вместо пустоты.

Проверить, что `get_enabled_modules` не содержит `windows`, и в этом случае писать в лог предупреждение при старте — в `setup()` после чтения `picker_cfg`:

```rust
            if picker_cfg.tray_left_click_picker {
                let modules = read_enabled_modules(&resolve_config_path(&app.handle(), &app_root))
                    .unwrap_or_default();
                if !modules.iter().any(|m| m == "windows") {
                    let _ = app.handle().emit(
                        "server-log",
                        LogPayload {
                            message: "tray.leftClick is 'picker' but the windows module is disabled — the picker will have no data".into(),
                            level: "warn".into(),
                        },
                    );
                }
            }
```

- [ ] **Step 7: Прогнать всё**

Run: `node --test test/**/*.test.js` — Expected: PASS
Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test` — Expected: PASS
Run: `cd /d/projects/js/windows11-manager && npm test` — Expected: PASS

Ручная проверка деградации: временно выставить `claudeWt.enabled: false` в `windows11-manager.config.js`, перезапустить приложение, нажать Win+F10 — окно должно показать текст `claudeWt.enabled is false in config`, а не пустой список. Вернуть значение обратно.

- [ ] **Step 8: Коммит**

```bash
git add src/picker/session-groups.js src/modules/windows.js src-tauri/src/main.rs test/picker-session-groups.test.js && git commit -m "feat(picker): explain empty states and fall back to restore on a dead window handle"
```

---

## Самопроверка плана

**Покрытие спеки.** Два независимых окна — задачи 6 и 7. Показ по центру активного монитора — задача 7, шаг 6. Поток данных Node → webview — задача 5. Нагрузка у действий — задача 2. Модель сессии и `claudeWtSessions()` — задача 1. Монитор по центру окна — задача 1, шаг 3. Группировка и порядок групп — задача 3. Глиф, поиск, клавиатура — задача 6. Фокус и переключение стола — задачи 2 и 8. Восстановление одной сессии и тост на неудачу — задача 5. Конфиг `picker.hotkey` и `tray.leftClick` — задача 7. Отказы: выключенный claude-wt — задача 1 (`ok: false`) плюс отрисовка в задаче 6; отсутствие ответа за 2 секунды — задача 6; мёртвый хендл — задача 8; одинаковые подписи — задача 3; окно вне мониторов — задача 1. Отсутствие `windows11-manager` — задача 8, шаг 6.

**Не покрыто намеренно:** реальные превью окон, закрытие сессий из пикера, мультивыбор, вызов пикера по MQTT — вынесено в границы спеки.
