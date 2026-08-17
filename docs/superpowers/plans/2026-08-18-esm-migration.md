# ESM Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести весь JavaScript проекта (`src/`, `scripts/`, `test/`) на ES-модули: `"type": "module"` в `package.json`, ни одного `require()` в репозитории.

**Architecture:** Три коммита. Первый готовит точки инъекции, оставаясь на CommonJS (тесты зелёные) — так флаг-день не тащит на себе ещё и смену тестовых механизмов. Второй — флаг-день: `"type": "module"` вместе с переводом всех файлов и правкой `bundle.resources`, дробить его нельзя, промежуточного зелёного состояния не существует. Третий — документация и мелочи.

**Tech Stack:** Node.js 22.23 (ESM, top-level await, `import.meta.dirname`, `node:module` `registerHooks`), `node --test`, Tauri v2, js-yaml.

**Spec:** `docs/superpowers/specs/2026-08-18-esm-migration-design.md`

## Global Constraints

- Node.js ≥ 22.15 (используются `import.meta.dirname`, `import.meta.resolve`, `node:module` `registerHooks`). Локально 22.23.1. Поле `engines` в `package.json` не добавляется — вне рамок этой работы.
- **Расширение `.js` в относительных импортах обязательно.** `import x from './paths'` в ESM не резолвится.
- **CJS-зависимости импортируются дефолтом и деструктурируются**, а не именованными импортами: именованные экспорты из CJS зависят от `cjs-module-lexer`, который на нативных аддонах ненадёжен. Встроенные модули (`node:fs`, `node:child_process`, …) — исключение, у них именованные импорты работают всегда.
- **Нативные аддоны не грузятся на этапе загрузки модуля** там, где это уже так: `@hurdlegroup/robotjs` в `keys.js` (после Task 2), `node-windows` в `helpers.js` (под `if (isWindows)`), реализации модулей в `src/modules/index.js`. Ленивость — не стиль, а защита: одна битая нативная зависимость не должна убивать сервер.
- Тесты никогда не запускают Windows/нативные бинарники (`CLAUDE.md`). Заглушки — через инъекцию зависимостей.
- Сообщения коммитов — Angular-стиль, русскоязычные, как в истории репозитория.

---

## File Structure

**Новые файлы:**

- `data/package.json` — `{"type": "commonjs"}`, изолирует gitignore-мусор от корневого `type: module` (Task 5).

**Файлы с изменением интерфейса (не механика):**

| Файл | Что меняется |
|---|---|
| `src/config.js` | Форма экспорта: `{ config, reload, setConfig }` вместо голого объекта конфига |
| `src/modules/index.js` | `load()` становится асинхронным |
| `src/modules/keys.js` | Четвёртый необязательный аргумент `deps` с `robot` |
| `src/modules/midi.js` | `getConfig()` через `reload()` вместо `require.cache` |
| `src/index.js` | Порядок выполнения: сервер грузится динамическим импортом в конце |
| `src/server.js` | Выбор транспорта через `await import()` |
| `src/helpers.js` | Потребитель всех трёх изменений выше |
| `src-tauri/tauri.conf.json` | `"../package.json"` в `bundle.resources` |

**Файлы с чисто механическим переводом** (`require` → `import`, `module.exports` → `export`, `__dirname` → `import.meta.dirname`), Task 4:

`src/`: `config-loader.js`, `crash-report.js`, `log-reentry.js`, `log-rotate.js`, `log-tag.js`, `monitor.js`, `mqtt.js`, `mqtt-bridge.js`, `paths.js`, `stdin-handler.js`, `tray-relay.js`

`src/modules/`: `_module.js`, `audio.js`, `clipboard.js`, `commands.js`, `delayed-slot-off.js`, `dirwatch.js`, `exec.js`, `filewatch.js`, `filewatch-helpers.js`, `gpt.js`, `midi-utils.js`, `mouse.js`, `notify.js`, `obs.js`, `obs-helpers.js`, `power.js`, `press-throttle.js`, `reaper.js`, `tabs.js`, `tts.js`

`scripts/`: `build-audio-watcher.js`, `deploy-fast.js`, `install-local.js`, `prepare-frontend.js`, `service-install.js`, `service-uninstall.js`, `stop-app.js`, `tauri-wrapper.js`

`test/`: все 22 файла

---

## Task 1: Точка инъекции конфига + переписать `power-module-gate`

Всё ещё CommonJS. После задачи `npm test` зелёный.

**Files:**
- Modify: `src/config.js` (весь файл, 3 строки)
- Modify: `src/helpers.js:1`
- Modify: `src/server.js:3`
- Modify: `src/modules/midi.js:11-16`
- Test: `test/power-module-gate.test.js:11-40`

**Interfaces:**
- Produces: `src/config.js` экспортирует `{ config, reload, setConfig }`.
  - `config` — живой объект конфига, идентичность которого сохраняется на всё время процесса.
  - `reload(): object` — перечитывает `config.yml` и возвращает **новый** объект, общий `config` не трогает.
  - `setConfig(next: object): void` — заменяет содержимое общего `config` **на месте**.
- Consumes: `loadConfig()` из `src/config-loader.js` (существует, без изменений).

### Почему `setConfig` мутирует на месте

`src/helpers.js:1` захватывает ссылку на объект конфига в момент загрузки модуля. Подмена ссылки (`config = next`) до него бы не доехала, и тесты `power-module-gate` видели бы конфиг, загруженный первым, — ровно та проблема, ради которой там сегодня стоит `delete require.cache`.

`reload()`, наоборот, возвращает свежий объект намеренно: `midi.js` через cache-busting получал новый объект только себе, а `helpers.js` продолжал держать свой. Мутация общего объекта из `midi.js` была бы расширением поведения на весь процесс.

- [ ] **Шаг 1: Переписать `src/config.js` целиком**

```js
const { loadConfig } = require('./config-loader');

// Живой объект конфига процесса. Его ИДЕНТИЧНОСТЬ обязана сохраняться:
// src/helpers.js захватывает ссылку при загрузке модуля, и подмена ссылки
// здесь до него бы не доехала.
const config = loadConfig();

/**
 * Перечитать config.yml и вернуть СВЕЖИЙ объект, не трогая общий config.
 *
 * Ровно та семантика, что была у `delete require.cache` в midi.js: вызывающий
 * получает свою копию, остальной процесс продолжает жить со своей.
 */
function reload() {
  return loadConfig();
}

/**
 * Заменить содержимое общего config на месте — точка инъекции для тестов.
 */
function setConfig(next) {
  for (const key of Object.keys(config)) delete config[key];
  Object.assign(config, next);
}

module.exports = { config, reload, setConfig };
```

- [ ] **Шаг 2: Обновить трёх потребителей**

`src/helpers.js:1`:

```js
const { config } = require("./config");
```

`src/server.js:3`:

```js
const { config } = require('./config');
```

`src/modules/midi.js:10-16` — весь блок `getConfig` заменить на:

```js
const { reload } = require('../config.js');

// loads config without cache
function getConfig() {
  return reload().modules.midi;
}
```

`const { reload } = require('../config.js')` поставить к остальным require в начале файла (после строки 5), саму функцию оставить на месте.

- [ ] **Шаг 3: Убедиться, что других потребителей нет**

Run: `grep -rn "require('\./config')\|require(\"\./config\")\|require('\.\./config" src scripts test --include='*.js'`
Expected: только `src/helpers.js`, `src/server.js`, `src/modules/midi.js`, `test/power-module-gate.test.js`.

- [ ] **Шаг 4: Переписать заголовок `test/power-module-gate.test.js`**

Заменить строки 20–40 (импорты + `loadHelpersWithConfig`) на:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const helpers = require('../src/helpers');
const { config, reload, setConfig } = require('../src/config');

function loadHelpersWithConfig(yamlLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-power-gate-'));
  const configPath = path.join(dir, 'config.yml');
  fs.writeFileSync(configPath, yamlLines.join('\n') + '\n');

  const prevConfig = process.env.CONFIG;
  process.env.CONFIG = configPath;
  setConfig(reload());
  if (prevConfig === undefined) delete process.env.CONFIG;
  else process.env.CONFIG = prevConfig;

  return { helpers, config };
}
```

Тела всех шести тестов в файле не трогать — они получают `{ helpers, config }` из того же хелпера и продолжают работать.

- [ ] **Шаг 5: Поправить комментарий в шапке файла**

Абзац в строках 13–18 (`...перечитывает src/config.js и src/helpers.js заново через require.cache — иначе все тесты в файле видели бы конфиг, загруженный первым`) заменить на:

```
 * getModulesEnabled()/initModules() читают общий объект конфига из
 * src/config.js, а не инжектируемый параметр, поэтому каждый тест
 * подставляет свой config.yml через переменную CONFIG и вызывает
 * setConfig(reload()) — иначе все тесты в файле видели бы конфиг,
 * загруженный первым. setConfig меняет объект НА МЕСТЕ: helpers.js
 * захватил ссылку на него при загрузке, и подмена ссылки до него бы
 * не доехала.
```

- [ ] **Шаг 6: Прогнать тест**

Run: `node --test test/power-module-gate.test.js`
Expected: PASS, 6 тестов. В частности `config.modules === undefined` и `config.modules === null` — `setConfig` удаляет все ключи перед `Object.assign`, поэтому отсутствующий в YAML ключ остаётся отсутствующим.

- [ ] **Шаг 7: Прогнать весь набор**

Run: `npm test`
Expected: PASS, регрессий нет.

- [ ] **Шаг 8: Коммит**

```bash
git add src/config.js src/helpers.js src/server.js src/modules/midi.js test/power-module-gate.test.js
git commit -m "refactor(config): reload()/setConfig() вместо перезагрузки через require.cache"
```

---

## Task 2: Инъекция robotjs в `keys` + снять skip с теста

Всё ещё CommonJS.

**Files:**
- Modify: `src/modules/keys.js:1-4`
- Test: `test/keys-press-throttle.test.js:1-53`

**Interfaces:**
- Produces: `src/modules/keys.js` экспортирует `async (mqtt, config, log, deps = {}) => {...}`. `deps.robot` — объект с методами `keyTap(key, mods)` и `typeString(text)`; при отсутствии берётся настоящий `@hurdlegroup/robotjs`, загружаемый **внутри** функции.
- Consumes: `throttlePress` из `src/modules/press-throttle.js` (без изменений).

### Почему require переезжает внутрь функции

Сегодня `require('@hurdlegroup/robotjs')` стоит первой строкой файла и бросает на любой машине без нативного аддона — поэтому весь тест-файл сегодня скипается вне Windows. Перенос загрузки внутрь функции плюс инъекция делают тест исполнимым везде, и скип снимается. Побочный эффект приятный: `load('keys')` из реестра перестаёт трогать нативный код вообще.

- [ ] **Шаг 1: Изменить `src/modules/keys.js`**

Удалить строку 1 (`const robot = require('@hurdlegroup/robotjs');`). Строку 4 заменить на:

```js
module.exports = async (mqtt, config, log, deps = {}) => {
  // robotjs — нативный аддон: грузим внутри функции, а не на уровне модуля,
  // чтобы реестр модулей мог отдать keys на машине без собранного аддона, а
  // тест — подставить заглушку вместо настоящих нажатий (иначе прогон жал бы
  // клавиши в том самом окне, где идут тесты).
  const robot = deps.robot || require('@hurdlegroup/robotjs');
```

Остальное тело файла не трогать: `robot.keyTap(...)` и `robot.typeString(...)` теперь читают локальную константу.

- [ ] **Шаг 2: Переписать строки 1–53 `test/keys-press-throttle.test.js`**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const keys = require('../src/modules/keys');

const TOPIC_BASE = 'home/room/pc/keys';

/**
 * Поднять модуль keys с подставным robotjs.
 *
 * Настоящий нажал бы клавиши по-настоящему — в том самом окне, где идут
 * тесты, и `(win)f10` открыл бы пикер. Заглушка приходит четвёртым
 * аргументом, поэтому нативный аддон не грузится вовсе и файл исполняется
 * на любой платформе, а не только на Windows.
 */
async function initKeys() {
  const taps = [];
  const fakeRobot = {
    keyTap: (key, mods) => taps.push([key, mods]),
    typeString: () => {},
  };
  const logged = [];
  const mod = await keys(
    {},
    { base: TOPIC_BASE },
    (message, level) => logged.push({ message, level }),
    { robot: fakeRobot },
  );
  const handlerFor = (suffix) => {
    const sub = mod.subscriptions.find((s) => s.topics.includes(`${TOPIC_BASE}/${suffix}`));
    assert.ok(sub, `нет подписки на ${TOPIC_BASE}/${suffix}`);
    return sub.handler;
  };
  return { handlerFor, taps, logged };
}
```

- [ ] **Шаг 3: Снять `{ skip }` с трёх тестов**

В трёх оставшихся тестах файла заменить `test('...', { skip }, async () => {` на `test('...', async () => {`. Заголовки тестов не менять:
- `press-throttled drops a bounced press: one tap, not two`
- `press-throttled keeps a separate window per key combination`
- `the plain press topic still lets repeats through`

- [ ] **Шаг 4: Прогнать тест**

Run: `node --test test/keys-press-throttle.test.js`
Expected: PASS, 3 теста, **ни одного skipped** — раньше на Linux все три скипались. Это и есть проверка, что инъекция работает.

- [ ] **Шаг 5: Прогнать весь набор**

Run: `npm test`
Expected: PASS.

- [ ] **Шаг 6: Коммит**

```bash
git add src/modules/keys.js test/keys-press-throttle.test.js
git commit -m "refactor(keys): инъекция robotjs вместо подмены через require.cache"
```

---

## Task 3: Асинхронный `load()` в реестре модулей

Всё ещё CommonJS.

**Files:**
- Modify: `src/modules/index.js:22-26`
- Modify: `src/helpers.js:190`
- Test: `test/modules-registry.test.js:11-14`
- Test: `test/native-modules.test.js:19-24`

**Interfaces:**
- Produces: `load(name: string): Promise<Function>` — резолвится реализацией модуля, отклоняется `Error("Unknown module: <name>")` для неизвестного имени. `registry` и `isEnabled` без изменений.
- Consumes: `loadModule` в `src/helpers.js:190`, уже внутри асинхронной `initModules()`.

### Почему рябь останавливается на одной строке

`initModules()` (`src/helpers.js:162`) уже `async`, а её единственный боевой вызов (`src/server.js:97`) уже написан с `await`. Асинхронность `load()` дальше `helpers.js:190` не идёт.

Побочный эффект: `load('nope')` теперь возвращает отклонённый промис вместо синхронного throw. `try/catch` вокруг `await` в `initModules()` ловит оба случая одинаково — меняется только тест.

- [ ] **Шаг 1: Переписать тест на неизвестное имя**

`test/modules-registry.test.js`, строки 11–14:

```js
test('load() rejects for unknown module name', async () => {
  const { load } = require('../src/modules');
  await assert.rejects(load('nope'), /Unknown module/);
});
```

- [ ] **Шаг 2: Прогнать — должен упасть**

Run: `node --test test/modules-registry.test.js`
Expected: FAIL. `load('nope')` пока бросает синхронно, `assert.rejects` получает не промис, а исключение — ошибка вида `The "promiseFn" argument must be of type function or an instance of Promise`.

- [ ] **Шаг 3: Сделать `load()` асинхронным**

`src/modules/index.js`, строки 22–26:

```js
async function load(name) {
  const modulePath = registry[name];
  if (!modulePath) throw new Error(`Unknown module: ${name}`);
  return require(modulePath);
}
```

- [ ] **Шаг 4: Добавить `await` в `helpers.js`**

`src/helpers.js:190`:

```js
      const mod = await loadModule(name);
```

- [ ] **Шаг 5: Обновить `test/native-modules.test.js`**

Строки 19–24:

```js
test('modules with native deps load on Node 24', { skip: !nativesAvailable() }, async () => {
  const { load } = require('../src/modules');
  assert.strictEqual(typeof await load('keys'), 'function');
  assert.strictEqual(typeof await load('mouse'), 'function');
  assert.strictEqual(typeof await load('midi'), 'function');
});
```

- [ ] **Шаг 6: Прогнать оба теста**

Run: `node --test test/modules-registry.test.js test/native-modules.test.js`
Expected: PASS. `native-modules` на Linux по-прежнему skipped — `@julusian/midi` там нет.

- [ ] **Шаг 7: Прогнать весь набор**

Run: `npm test`
Expected: PASS. Особое внимание на `power-module-gate` — он единственный реально ходит через `initModules()` и поймал бы пропущенный `await` (модуль пришёл бы промисом, и `power.base` оказался бы `undefined`).

- [ ] **Шаг 8: Коммит**

```bash
git add src/modules/index.js src/helpers.js test/modules-registry.test.js test/native-modules.test.js
git commit -m "refactor(modules): асинхронный load() в реестре модулей"
```

---

## Task 4: Флаг-день — `"type": "module"` и перевод всех файлов

Один коммит. Между `"type": "module"` и переводом последнего файла зелёного состояния не существует — дробить нельзя.

**Files:**
- Modify: `package.json` (добавить `"type": "module"`)
- Modify: `src-tauri/tauri.conf.json` (`"../package.json"` в `bundle.resources`)
- Modify: все `.js` в `src/`, `scripts/`, `test/` (см. File Structure)
- Test: `test/tauri-config.test.js` (новый гард-тест), `test/modules-registry.test.js` (тест на ленивость)

**Interfaces:**
- Consumes: всё из Tasks 1–3 (`{ config, reload, setConfig }`, `deps.robot`, async `load()`).
- Produces: проект, в котором `grep -rn "require(" src scripts test` пуст.

### Правила перевода

**Относительные импорты — всегда с расширением:**

```js
const { resolveAppFile } = require('./paths');   // было
import { resolveAppFile } from './paths.js';     // стало
```

**Экспорты:**

| Было | Стало |
|---|---|
| `module.exports = { a, b };` | `export { a, b };` |
| `module.exports = async (mqtt, config, log) => {...}` | `export default async (mqtt, config, log) => {...}` |
| `module.exports = fn; module.exports.helper = h;` | `export default fn; export { helper };` |

Гибридная форма (дефолт + довески) есть в трёх файлах: `src/modules/commands.js:224-227`, `src/modules/power.js:151-152`, `src/modules/audio.js:279-283`. Их потребители в тестах (`test/commands.test.js`, `test/audio.test.js`, `test/power.test.js`, `test/tray-relay.test.js`) переводятся так:

```js
import * as commands from '../src/modules/commands.js';   // было: const commands = require(...)
import power from '../src/modules/power.js';              // было: const power = require(...); await power(...)
import { storeThen, createAckQueue } from '../src/modules/power.js';
```

`test/tray-relay.test.js:67` вызывает `await power(...)` — ему нужен именно дефолтный импорт, а не пространство имён.

**Зависимости из npm — дефолтом с деструктуризацией:**

| Было | Стало |
|---|---|
| `const mqtt = require('mqtt');` | `import mqtt from 'mqtt';` |
| `const yaml = require('js-yaml');` | `import yaml from 'js-yaml';` |
| `const { default: OBSWebSocket } = require('obs-websocket-js');` | `import OBSWebSocket from 'obs-websocket-js';` |
| `const midi = require('@julusian/midi');` | `import midi from '@julusian/midi';` |
| `const { usb } = require('usb');` | `import usbPkg from 'usb';`<br>`const { usb } = usbPkg;` |
| `const debounce = require('lodash.debounce');` | `import debounce from 'lodash.debounce';` |
| `const chokidar = require('chokidar');` | `import chokidar from 'chokidar';` |
| `const notifier = require('node-notifier');` | `import notifier from 'node-notifier';` |
| `const axios = require('axios');` | `import axios from 'axios';` |
| `const loudness = require('loudness');` | `import loudness from 'loudness';` |
| `const robot = require('@hurdlegroup/robotjs');` | `import robot from '@hurdlegroup/robotjs';` |
| `const Service = require('node-windows').Service;` | `import nodeWindows from 'node-windows';`<br>`const { Service } = nodeWindows;` |

**Встроенные модули — именованными импортами**, у них статический анализ не при делах: `import { execSync } from 'node:child_process';`, `import fs from 'node:fs';`.

**`__dirname` → `import.meta.dirname`** ровно в двенадцати файлах: шесть скриптов (`build-audio-watcher`, `tauri-wrapper`, `install-local`, `deploy-fast`, `service-install`, `service-uninstall`), два в `src/` (`paths.js:8`, `modules/notify.js:83`) и четыре теста (`obs-process`, `tray-relay`, `power-module-gate`, `tauri-config`).

### Шесть мест, где перевод не механический

- [ ] **Шаг 1: Добавить гард-тест в `test/tauri-config.test.js`**

Вставить сразу после теста `base tauri.conf.json bundles the full resource list` (заканчивается на строке 78):

```js
// "type": "module" живёт в корневом package.json, а Node ищет ближайший
// package.json вверх от запускаемого файла. В установленном приложении это
// _up_/src/index.js, значит package.json обязан лежать в _up_/ — то есть
// быть в bundle.resources. Без него Node прочитает src/*.js как CommonJS и
// упадёт на первом import, причём молча: initModules() глотает исключения
// модулей, а стартовый сбой в bridge-режиме уходит в stderr, который видно
// только в окне приложения.
test('bundle.resources ships package.json, and it declares type: module', () => {
  const base = readJson('tauri.conf.json');
  const resources = base.bundle && base.bundle.resources;
  assert.ok(Array.isArray(resources), 'bundle.resources must be an array');
  assert.ok(
    resources.includes('../package.json'),
    'bundle.resources must include ../package.json, иначе "type": "module" не доедет до установленного приложения'
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.type, 'module', 'package.json must declare "type": "module"');
});
```

- [ ] **Шаг 2: Прогнать гард-тест — должен упасть**

Run: `node --test test/tauri-config.test.js`
Expected: FAIL на новом тесте — `bundle.resources must include ../package.json`.

- [ ] **Шаг 3: Переключить `package.json` и `bundle.resources`**

`package.json` — добавить `"type": "module"` сразу после `"description"`:

```json
  "description": "Windows MQTT",
  "type": "module",
```

`src-tauri/tauri.conf.json` — добавить `"../package.json"` в `bundle.resources` первым элементом:

```json
      "resources": [
        "../package.json",
        "../config.example.yml",
```

С этого момента и до конца задачи `npm test` красный целиком — это ожидаемо.

- [ ] **Шаг 4: Перевести листовые модули `src/`**

Файлы без локальных зависимостей или почти без них, порядок значения не имеет:
`src/log-tag.js`, `src/log-rotate.js`, `src/log-reentry.js`, `src/crash-report.js`, `src/paths.js`, `src/config-loader.js`, `src/modules/press-throttle.js`, `src/modules/midi-utils.js`, `src/modules/delayed-slot-off.js`, `src/modules/filewatch-helpers.js`, `src/modules/obs-helpers.js`.

Два из них требуют внимания: `src/modules/filewatch-helpers.js:39` и `src/modules/obs-helpers.js:58` делают `const { execSync } = require('node:child_process')` **внутри синхронной функции**. `await import()` там невозможен — поднять в статический импорт наверх файла:

```js
import { execSync } from 'node:child_process';
```

Это безопасно: встроенный модуль, загрузка ничего не стоит и ничего не ломает.

`src/paths.js:8`: `const appRoot = path.join(import.meta.dirname, '..');`

Run: `node --check src/paths.js && node --check src/config-loader.js`
Expected: без вывода (успех).

- [ ] **Шаг 5: Перевести ядро `src/`**

`src/config.js`, `src/helpers.js`, `src/monitor.js`, `src/mqtt.js`, `src/mqtt-bridge.js`, `src/stdin-handler.js`, `src/tray-relay.js`, `src/modules/index.js`.

`src/config.js` — хвост файла:

```js
export { config, reload, setConfig };
```

`src/modules/index.js` — значения реестра получают расширение, `require` меняется на `import()`:

```js
const registry = {
  audio: './audio.js',
  clipboard: './clipboard.js',
  commands: './commands.js',
  dirwatch: './dirwatch.js',
  exec: './exec.js',
  filewatch: './filewatch.js',
  gpt: './gpt.js',
  keys: './keys.js',
  midi: './midi.js',
  mouse: './mouse.js',
  notify: './notify.js',
  obs: './obs.js',
  power: './power.js',
  reaper: './reaper.js',
  tabs: './tabs.js',
  tts: './tts.js',
};

async function load(name) {
  const modulePath = registry[name];
  if (!modulePath) throw new Error(`Unknown module: ${name}`);
  return (await import(modulePath)).default;
}
```

**`.default` обязателен.** `import()` возвращает пространство имён, а реализации модулей — дефолтный экспорт. Без него `helpers.js:190` получил бы объект вместо функции, и все модули падали бы с `mod is not a function` — молча, потому что `initModules()` ловит исключения и пишет их в лог.

`src/helpers.js:11-14` — условная загрузка `node-windows` должна остаться условной (на не-Windows пакета может не быть):

```js
let windowsLogger;
if (isWindows) {
  const { default: nodeWindows } = await import('node-windows');
  const { EventLogger } = nodeWindows;
  windowsLogger = new EventLogger('windows-mqtt');
}
```

Top-level await внутри `if` на верхнем уровне модуля — легально в ESM.

Run: `node --check src/helpers.js && node --check src/modules/index.js`
Expected: без вывода.

- [ ] **Шаг 6: Перевести реализации модулей `src/modules/`**

`_module.js`, `audio.js`, `clipboard.js`, `commands.js`, `dirwatch.js`, `exec.js`, `filewatch.js`, `gpt.js`, `keys.js`, `midi.js`, `mouse.js`, `notify.js`, `obs.js`, `power.js`, `reaper.js`, `tabs.js`, `tts.js`.

`src/modules/keys.js` — ленивая загрузка внутри функции переезжает на `await import`:

```js
  const robot = deps.robot ?? (await import('@hurdlegroup/robotjs')).default;
```

`src/modules/clipboard.js:3` и `src/modules/gpt.js:8` уже используют `await import()` — **не трогать**, они и должны остаться ленивыми.

`src/modules/notify.js:83`: `path.join(import.meta.dirname, '..', '..', 'assets', 'icons', ...)`.

Run: `for f in src/modules/*.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: ни одного `FAIL`.

- [ ] **Шаг 7: Переписать `src/server.js`**

Строки 1–7 заменить целиком на:

```js
import { config } from './config.js';
import { log, getModulesEnabled, initModules } from './helpers.js';
// stdin-handler экспортирует { init, register }, а server.js зовёт их через
// точку (stdinHandler.register(...), пять мест) — нужен именно импорт
// пространства имён, а не дефолтный.
import * as stdinHandler from './stdin-handler.js';
import { buildTrayRelayActions } from './tray-relay.js';
import { startMonitor } from './monitor.js';

const isTauriBridge = process.env.TAURI_BRIDGE === '1';
// Транспорт выбирается по рантайм-флагу: статический импорт обоих загрузил бы
// неиспользуемый. Единственный top-level await в src/ — и он намеренный.
const { mqttInit } = await import(isTauriBridge ? './mqtt-bridge.js' : './mqtt.js');
```

Порядок изменился намеренно: статические импорты в ESM выполняются раньше любого кода файла, поэтому объявление `isTauriBridge` обязано стоять после них — иначе оно читается глазами как выполняющееся первым, хотя это не так. На поведение перестановка не влияет: `process.env` доступен всегда.

Хвост файла (`module.exports = { start, cleanup }`) → `export { start, cleanup };`.

Run: `node --check src/server.js`
Expected: без вывода.

- [ ] **Шаг 8: Переписать `src/index.js` целиком**

Это самое опасное место миграции: статический `import { start } from './server.js'` выполнил бы `server.js` **раньше всего тела файла**, и обе гарантии — «отчёт настроен как можно раньше» и «в bridge-режиме stdout не засорён» — исчезли бы молча.

```js
import fs from 'node:fs';
import { settingsDir } from './paths.js';
import { configureReport } from './crash-report.js';
import { tagLines } from './log-tag.js';

// Diagnostic reports for runtime-fatal events (OOM, V8 fatal errors), written
// to the user settings dir so they survive the process death. Configure as
// early as possible. Optional — never block startup if it fails.
// See src/crash-report.js for what this does and does not capture.
try {
  const reportDir = settingsDir('reports');
  // Node falls back to cwd (read-only in a bundled install) if the report
  // directory does not exist, so create it before pointing process.report there.
  fs.mkdirSync(reportDir, { recursive: true });
  configureReport(process.report, reportDir);
} catch {}

// In Tauri bridge mode, stdout is the IPC channel — redirect all console output to stderr
if (process.env.TAURI_BRIDGE === '1') {
  // When the parent Tauri process dies, the stdio pipes break and every write
  // throws EPIPE; without these guards the uncaughtException handler tries to
  // log the error to the same dead pipe, creating a 100% CPU error loop.
  process.stdout.on('error', () => {});
  process.stderr.on('error', () => {});

  // helpers тянет за собой конфиг, поэтому грузится ПОСЛЕ подмены console, а
  // не статическим импортом наверху: статический импорт выполнился бы до
  // тела файла. До того как промис разрешится, строки уходят только в stderr —
  // ровно то же окно, что было у ленивого require раньше.
  let helpersMod;
  import('./helpers.js').then((m) => { helpersMod = m; }, () => {});

  // Одна пометка на весь процесс. Молчать тут нельзя — этот путь для того и
  // заведён, чтобы диагностика перестала теряться, — но и жаловаться на каждую
  // строку тоже: сбой файлового лога превратился бы в поток шума в stderr.
  let fileLogFailureNoted = false;
  const stderrWrite = (level) => (...args) => {
    const text = args.join(' ');
    try {
      process.stderr.write(tagLines(level, text) + '\n');
    } catch {}
    try {
      if (!helpersMod) throw new Error('helpers ещё не загружен');
      helpersMod.logConsoleLine(level, text);
    } catch (e) {
      // Штатный случай — helpers ещё грузится: строка мимо файла. Дальше всё
      // чинится само, но знать, что начало лога не доехало, надо.
      if (!fileLogFailureNoted) {
        fileLogFailureNoted = true;
        try {
          process.stderr.write(tagLines('warn',
            `[log] console line did not reach the file log: ${e && e.message}`) + '\n');
        } catch {}
      }
    }
  };
  console.log = stderrWrite('info');
  console.info = stderrWrite('info');
  console.warn = stderrWrite('warn');
  console.error = stderrWrite('error');
  console.debug = stderrWrite('debug');
}

// Динамический импорт, а не статический: тело этого файла обязано выполниться
// раньше server.js — статический import хойстится и порядок бы сломался.
const { start } = await import('./server.js');

void start();
```

Проверить, что `settingsDir` и `configureReport` не бросают при загрузке модуля: раньше их `require` стоял внутри `try`, теперь импорт статический и падение убило бы процесс. `src/paths.js` и `src/crash-report.js` при загрузке только считают пути — побочных эффектов нет.

Run: `node --check src/index.js`
Expected: без вывода.

- [ ] **Шаг 9: Перевести `scripts/`**

Восемь файлов. `import.meta.dirname` вместо `__dirname`.

`scripts/build-audio-watcher.js:46` — точка входа:

```js
import { pathToFileURL } from 'node:url';
...
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(build() ? 0 : 1);
}
```

`scripts/service-install.js:4` и `scripts/service-uninstall.js:4` — JSON вместо `require`:

```js
const packageJson = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')
);
```

Import attributes (`with { type: 'json' }`) не использовать: на Node 22 они печатают ExperimentalWarning в stderr, а это сервисные скрипты.

Run: `for f in scripts/*.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: ни одного `FAIL`.

- [ ] **Шаг 10: Перевести `test/`**

Все 22 файла. Механика та же плюс два места:

`test/native-modules.test.js:11` — проба доступности пакета:

```js
function nativesAvailable() {
  for (const dep of ['@hurdlegroup/robotjs', '@julusian/midi']) {
    try {
      import.meta.resolve(dep);
    } catch (e) {
      return false;
    }
  }
  return true;
}
```

`import.meta.resolve()` синхронный и бросает `ERR_MODULE_NOT_FOUND`, если пакет не установлен, — поведение то же, что у `require.resolve()`.

`test/native-modules.test.js:20` — `load` теперь импортируется статически:

```js
import { load } from '../src/modules/index.js';
```

Run: `for f in test/*.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: ни одного `FAIL`.

- [ ] **Шаг 11: Переписать тест на ленивость реестра**

`test/modules-registry.test.js`, последний тест. `require.cache` в ESM нет; замена — хук загрузки из `node:module`.

```js
import { registerHooks } from 'node:module';

test('импорт реестра не грузит реализации модулей (ленивость)', async () => {
  const loaded = [];
  const hook = registerHooks({
    load(url, context, nextLoad) {
      loaded.push(url);
      return nextLoad(url, context);
    },
  });
  try {
    // Строка запроса обязательна: реестр уже импортирован статически выше и
    // лежит в кэше модулей, а хук видит только НОВЫЕ загрузки. `?lazy-probe`
    // даёт свежий инстанс, за загрузкой которого хук и наблюдает.
    await import('../src/modules/index.js?lazy-probe');
  } finally {
    hook.deregister();
  }
  const paths = loaded.map((u) => u.replace(/\\/g, '/'));
  assert.ok(paths.some((p) => p.includes('src/modules/index.js')),
    'хук обязан увидеть сам реестр — иначе тест ничего не проверяет');
  assert.ok(!paths.some((p) => p.includes('src/modules/tts')), 'tts (sherpa-onnx) must not load eagerly');
  assert.ok(!paths.some((p) => p.includes('src/modules/midi')), 'midi must not load eagerly');
});
```

Утверждение про сам реестр — не украшение: без него тест проходил бы и в случае, когда хук не видит вообще ничего, и молча перестал бы что-либо охранять.

- [ ] **Шаг 12: Сплошная синтаксическая проверка**

Run:
```bash
for f in $(find src scripts test -name '*.js'); do node --check "$f" || echo "FAIL $f"; done
```
Expected: ни одного `FAIL`. `node --check` уважает `"type": "module"` из `package.json` и принимает top-level await.

- [ ] **Шаг 13: Проверить, что CommonJS не остался**

Run:
```bash
grep -rn "require(\|module\.exports\|__dirname\|__filename" src scripts test --include='*.js'
```
Expected: пусто. Единственные допустимые совпадения — слово `require` внутри текстовых комментариев; если такие есть, переписать комментарий, чтобы он описывал импорты.

- [ ] **Шаг 14: Прогнать тесты**

Run: `npm test`
Expected: PASS. Ожидаемое число skipped прежнее (`native-modules` на не-Windows); `keys-press-throttle` после Task 2 не скипается.

- [ ] **Шаг 15: Прогнать Rust-тесты**

Run: `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test`
Expected: PASS. Перед этим — `source "$HOME/.cargo/env"`.

- [ ] **Шаг 16: Дымовая проверка запуска**

Run: `timeout 10 node src/index.js; echo "exit=$?"`
Expected: процесс стартует, пишет строки конфига/модулей и живёт до таймаута (`exit=124`). Ошибок `ERR_MODULE_NOT_FOUND`, `Cannot use import statement outside a module` или `mod is not a function` быть не должно. На Linux часть модулей ожидаемо не грузится — важно, что это ловится и логируется, а не роняет процесс.

- [ ] **Шаг 17: Коммит**

```bash
git add -A
git commit -m "refactor: перевести проект на ES-модули

\"type\": \"module\" плюс перевод src/, scripts/ и test/ одним коммитом:
между флагом и последним переведённым файлом зелёного состояния не
существует. Сюда же package.json в bundle.resources — иначе флаг не
доезжает до установленного приложения, и гард-тест на это."
```

---

## Task 5: Хвост — изоляция `data/`, сканер импортов, документация

**Files:**
- Create: `data/package.json`
- Modify: `test/tauri-config.test.js:171-198` (сканер относительных путей)
- Modify: `CLAUDE.md` (раздел про относительные `require` в `src/`)

**Interfaces:**
- Consumes: ESM-проект из Task 4.

- [ ] **Шаг 1: Изолировать `data/`**

`data/` в `.gitignore` и содержит CommonJS-файлы (`data/config.js`, `data/index.js`, `data/config.example.js`) — с корневым `"type": "module"` они перестанут запускаться через `node`. Создать `data/package.json`:

```json
{
  "type": "commonjs"
}
```

Файл попадает под gitignore вместе со всем `data/` — это нормально, он нужен только на машине разработчика. Проверить: `git check-ignore -v data/package.json` должен подтвердить игнор. Если `data/` на машине нет — шаг пропустить и отметить это в PR.

- [ ] **Шаг 2: Написать проверку сканера — пока красную**

Сканер `no relative require() in src/ resolves to a path outside src/` (`test/tauri-config.test.js:171`) после Task 4 ищет `require(...)`, которых больше нет, — то есть проходит всегда и не охраняет ничего. Чтобы убедиться, что новая версия действительно работает, временно добавить в конец `src/log-tag.js` строку:

```js
import '../package.json';
```

Run: `node --test test/tauri-config.test.js`
Expected: FAIL с упоминанием `src/log-tag.js`. Если тест **проходит** — сканер сломан, чинить его, а не тест.

- [ ] **Шаг 3: Переписать сканер на импорты**

`test/tauri-config.test.js`, тело теста — заменить регулярку и заголовок:

```js
test('no relative import in src/ resolves to a path outside src/', () => {
  const srcDir = path.join(repoRoot, 'src');
  const jsFiles = fs.globSync('src/**/*.js', { cwd: repoRoot })
    .filter(p => fs.statSync(path.join(repoRoot, p)).isFile());

  const offenders = [];
  // Три формы разом: `from './x.js'` (статический импорт и реэкспорт),
  // `import './x.js'` (импорт ради побочного эффекта) и `import('./x.js')`
  // (динамический — на нём держится реестр модулей).
  const importRe = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.\.?\/[^'"]+)['"]/g;
  for (const rel of jsFiles) {
    const abs = path.join(repoRoot, rel);
    const content = fs.readFileSync(abs, 'utf8');
    let m;
    while ((m = importRe.exec(content))) {
      const target = path.resolve(path.dirname(abs), m[1].replace(/\?.*$/, ''));
      const relToSrc = path.relative(srcDir, target);
      if (relToSrc === '..' || relToSrc.startsWith(`..${path.sep}`)) {
        offenders.push(`  ${rel}: import '${m[1]}' -> src/${relToSrc}`);
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    `relative imports in src/ must stay inside src/ (bundle.resources ships only ` +
    `../src/* and its subdirectory globs, not the repo root):\n${offenders.join('\n')}`
  );
});
```

`.replace(/\?.*$/, '')` снимает строку запроса — иначе `./index.js?lazy-probe`-подобные пути резолвились бы мимо.

Комментарий над тестом (строки 160–170) — заменить слово `require()` на `import` в трёх местах, историю про `frontend-src/session-glyph` сохранить: она объясняет, зачем тест вообще существует.

- [ ] **Шаг 4: Прогнать — теперь должен упасть на подсадке**

Run: `node --test test/tauri-config.test.js`
Expected: FAIL с `src/log-tag.js: import '../package.json' -> src/../package.json`.

- [ ] **Шаг 5: Убрать подсадку и прогнать снова**

Удалить добавленную в Шаге 2 строку из `src/log-tag.js`.

Run: `node --test test/tauri-config.test.js`
Expected: PASS.

- [ ] **Шаг 6: Обновить `CLAUDE.md`**

В разделе `### Tauri v2 Gotchas` пункт про `bundle.resources` дополнить абзацем:

```markdown
- `package.json` обязан быть в `bundle.resources`: `"type": "module"` живёт
  в нём, а Node ищет ближайший package.json вверх от `_up_/src/index.js`.
  Без него установленное приложение читает `src/*.js` как CommonJS и падает
  на первом `import` — молча, потому что `initModules()` глотает исключения.
  Охраняется тестом в `test/tauri-config.test.js`.
```

В том же разделе, в пункте про `../src/<subdir>/**/*`, заменить фразу про относительные `require()` на «относительные импорты». Проверить грепом, что в `CLAUDE.md` не осталось утверждений про CommonJS, ставших ложными:

Run: `grep -n "require\|CommonJS\|module.exports" CLAUDE.md`
Expected: остаются только упоминания, которые всё ещё верны (например, про `require` в контексте Rust или истории). Ложные — переписать.

- [ ] **Шаг 7: Прогнать весь набор**

Run: `npm test`
Expected: PASS.

- [ ] **Шаг 8: Коммит**

```bash
git add test/tauri-config.test.js CLAUDE.md
git commit -m "task(esm): сканер относительных импортов и документация после миграции"
```

`data/package.json` в коммит не попадает — он под gitignore.

---

## Финальная проверка перед PR

- [ ] `npm test` — зелёный, `keys-press-throttle` больше не скипается
- [ ] `source "$HOME/.cargo/env" && cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test` — зелёный
- [ ] `grep -rn "require(\|module\.exports\|__dirname\|__filename" src scripts test --include='*.js'` — пусто
- [ ] `git log --oneline master..HEAD` — три коммита реализации плюс коммит спеки

**Ручной чек-лист в PR (на Windows, за автором — автотесты этого не покрывают):**

- [ ] `npm run deploy-local` — сборка инсталлятора, установка, запуск
- [ ] Приложение поднялось, трей на месте, версия в меню верная
- [ ] Живой лог в окне приложения не пустой и не залит `[error]` (проверка порядка выполнения в `src/index.js`)
- [ ] Отвечают модули с нативными зависимостями: `keys`, `midi`, `obs`, `audio`
- [ ] Перезагрузка midi-конфига работает (проверка `reload()`)
- [ ] `7z x` по инсталлятору: `package.json` внутри есть и содержит `"type": "module"`; `config.yml`, `commands.yml`, `data/` отсутствуют; реальные значения из `%APPDATA%\windows-mqtt\config.yml` не встречаются
