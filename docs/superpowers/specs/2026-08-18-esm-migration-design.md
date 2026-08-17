# Миграция windows-mqtt на ESM

Дата: 2026-08-18
Статус: согласовано, готово к планированию

## Цель

Перевести весь JavaScript проекта (`src/`, `scripts/`, `test/`) на ES-модули:
`"type": "module"` в `package.json`, ни одного `require()` в репозитории после
миграции. Один PR.

Мотивация: две зависимости (`clipboardy@3`, `chatgpt@5`) уже ESM-only и грузятся
через `await import()` внутри функций; экосистема Node ушла на ESM, и каждая
новая зависимость требует такого же обходного пути. Плюс `require.cache`-магия в
тестах — источник хрупкости, который миграция вынуждает убрать.

## Форма миграции

Честный ESM без CJS-совместимости: ни `createRequire()`, ни `require(esm)`.
Там, где сегодня нужен синхронный доступ к модулю изнутри функции, поведение
переносится на асинхронный holder (см. §3).

Отвергнутые варианты:

- **Гибрид через `createRequire()`** — быстро закрывает `src/index.js`,
  `src/modules/midi.js` и тесты, но оставляет `require.cache`-семантику живой
  внутри ESM-графа. Из такого состояния тяжело выйти позже.
- **`require(esm)` из CJS-тестов** (Node ≥22.12) — позволил бы не трогать тесты,
  но ломается на любом top-level await в графе (а он появляется в
  `src/server.js`, см. §2) и молча привязывает проект к Node 22.12+ при
  отсутствующем поле `engines`.

## 1. Упаковка и бандл

Изменения:

- `package.json`: добавить `"type": "module"`.
- `src-tauri/tauri.conf.json`: добавить `"../package.json"` в `bundle.resources`.

Второй пункт — блокер, а не деталь. `bundle.resources` перечисляет
`../src/*`, `../src/modules/**/*`, `../node_modules/**/*`, но не корневой
`package.json`. Node, запущенный на `_up_/src/index.js`, ищет ближайший
`package.json` вверх по дереву; не найдя его, читает `.js` как CommonJS и падает
на первом `import`. Падение будет тихим: `initModules()` ловит и логирует
исключения модулей, а стартовый сбой в bridge-режиме уходит в stderr, который
видно только в окне приложения.

Секретов в `package.json` нет (файл в git). Проверка собранного инсталлятора
через `7z x` из `CLAUDE.md` остаётся обязательной и не меняется.

Автопроверка (`test/tauri-config.test.js`): `package.json` присутствует в
`bundle.resources` **и** содержит `"type": "module"`. Это единственный тест,
который ловит проблему до установки на Windows.

## 2. Граф модулей в `src/`

Механическая часть, общие правила:

- `require('./x')` → `import ... from './x.js'` — расширение обязательно.
- `module.exports = X` → `export default X`; `module.exports = { a, b }` →
  именованные экспорты.
- `__dirname` → `import.meta.dirname` (доступно с Node 20.11; локально 22.23).
- **CJS-зависимости импортируются дефолтом и деструктурируются**, а не
  именованными импортами: `import usbPkg from 'usb'; const { usb } = usbPkg;`.
  Именованные экспорты из CJS зависят от статического анализа
  (`cjs-module-lexer`), который на нативных аддонах ненадёжен. Правило касается
  `mqtt`, `usb`, `@hurdlegroup/robotjs`, `@julusian/midi`, `node-windows`,
  `loudness`, `node-notifier`, `lodash.debounce`.
- `await import()` внутри функций (`src/modules/clipboard.js:3`,
  `src/modules/gpt.js:8`) остаётся как есть — эти модули должны грузиться лениво
  независимо от системы модулей.

Нетривиальная часть — два места:

**`src/modules/index.js`.** `load(name)` становится `async` и использует
`await import(registry[name])`; значения реестра получают расширение `.js`.
Ленивость реестра (одна битая нативная зависимость не должна убивать сервер)
сохраняется полностью. Рябь ровно на одну строку: `src/helpers.js:190`
(`const mod = await loadModule(name)`) уже находится внутри асинхронного
`initModules()`, а единственный вызов `initModules()` в `src/server.js:97` уже
написан с `await`.

Побочный эффект: `load()` для неизвестного имени теперь возвращает отклонённый
промис вместо синхронного throw. Обработчик в `initModules()` — `try/catch`
вокруг `await` — работает одинаково в обоих случаях; меняется только тест
(см. §5).

**`src/server.js:2`.** Условный выбор транспорта по рантайм-флагу:

```js
const { mqttInit } = await import(isTauriBridge ? './mqtt-bridge.js' : './mqtt.js');
```

Top-level await. Это единственный TLA в `src/`, и он появляется намеренно —
статический импорт обоих транспортов загрузил бы неиспользуемый.

## 3. `src/index.js` — порядок выполнения

Самое опасное место миграции. Сегодня файл читается сверху вниз:

1. настройка `process.report` (диагностика OOM/фатальных ошибок V8),
2. подмена `console.*` в bridge-режиме (stdout — это IPC-канал),
3. `require('./server')`.

Статический `import` хойстится: `import { start } from './server.js'` выполнил
бы `server.js` **раньше всего тела файла**, и обе гарантии — «отчёт настроен как
можно раньше» и «stdout не засорён» — исчезли бы молча.

Решение: тело остаётся телом, а сервер грузится в конце динамическим импортом.

```js
const { start } = await import('./server.js');
void start();
```

Импорты `fs`, `./paths.js`, `./crash-report.js` поднимаются наверх статически
(модули чистые, побочных эффектов при загрузке не имеют); `try/catch` остаётся
вокруг исполняемой части — создания директории и `configureReport()`.

**Ленивый `require('./helpers')` внутри `stderrWrite`** (`src/index.js:39`)
заменяется на holder:

```js
let helpersMod;
import('./helpers.js').then((m) => { helpersMod = m; }, () => {});
```

`stderrWrite` синхронен и пишет в файловый лог, только если holder заполнен.
Существующая ветка `fileLogFailureNoted` («начало лога не доехало») покрывает
окно ожидания тем же самым сообщением, что и сегодняшний случай «helpers в
середине загрузки» — наблюдаемое поведение не меняется. Строка в stderr пишется
всегда и первой, до попытки записи в файл, как и сейчас.

## 4. `src/config.js` — reload вместо cache-busting

`src/modules/midi.js:11-16` перезагружает конфиг через
`delete require.cache[require.resolve('../config.js')]`. В ESM кеш модулей не
сбрасывается.

`src/config.js` получает две функции сверх дефолтного экспорта:

- `reload()` — перечитывает YAML и возвращает **новый** объект, не трогая
  дефолтный экспорт;
- `setConfig(obj)` — заменяет содержимое дефолтного экспорта, точка инъекции для
  тестов (см. §5).

`reload()` возвращает свежий объект намеренно: сегодня `midi.js` через
cache-busting получал новый объект только себе, а `src/helpers.js:1` продолжал
держать ссылку на свой. Мутация общего объекта на месте была бы расширением
поведения на весь процесс — за рамками миграции.

`getConfig()` в `midi.js` схлопывается до `reload().modules.midi`.

## 5. Тесты — инъекция зависимостей вместо `require.cache`

Четыре теста держатся на `require.cache`. Заменяем механизм, а не утверждения.

**`test/keys-press-throttle.test.js`.** Сейчас подменяет `@hurdlegroup/robotjs`
через `require.cache` — иначе тест реально нажал бы клавиши в том окне, где
идёт прогон. Дефолтный экспорт `src/modules/keys.js` получает четвёртый
необязательный аргумент с зависимостями:

```js
export default async (mqtt, config, log, deps = {}) => {
  const robot = deps.robot ?? (await import('@hurdlegroup/robotjs')).default;
  ...
};
```

Тест передаёт заглушку и никогда не касается нативного аддона. Следствие:
сегодняшний скип «нет `@hurdlegroup/robotjs` (не Windows)» становится не нужен —
тест начинает работать и на Linux. Скип снимается.

**`test/power-module-gate.test.js`.** Два `delete require.cache[...]`
(`../src/config`, `../src/helpers`) заменяются на `setConfig(fixture)` из §4
перед каждым кейсом. Перезагрузка `helpers` больше не нужна: он читает конфиг
через тот же живой объект.

**`test/modules-registry.test.js`.**

- `assert.throws(() => load('nope'))` → `assert.rejects(load('nope'))`.
- Тест «импорт реестра не грузит реализации модулей» переезжает на
  `module.registerHooks()` (`node:module`, доступно с Node 22.15; локально
  22.23): хук `load` записывает загруженные URL, утверждения про `tts` и `midi`
  остаются дословно теми же.
- Запасной вариант, если `registerHooks` окажется нестабильным: утверждение
  уровня исходника — в `src/modules/index.js` нет ни одного статического
  `import` реализации модуля, только строки реестра. Слабее, но честно и без
  экспериментальных API.

**`test/native-modules.test.js`.** `load(...)` теперь асинхронный → `await`,
проверки типа остаются. Проба доступности зависимости `require.resolve(dep)`
внутри `try/catch` → `import.meta.resolve(dep)`; поведение то же — бросает, если
пакет не установлен, и файл скипается на Linux, как сейчас.

**`test/tauri-config.test.js:171`.** Тест «относительный путь в `src/` не уходит
за пределы `src/`» ценен ровно так же после миграции (он поймал реальный баг с
`frontend-src/session-glyph`, не попадающим в `bundle.resources`). Регулярка
учится видеть `import ... from '...'` и `import('...')` вместо `require('...')`.
Комментарий над тестом обновляется, чтобы описывать импорты.

## 6. `scripts/`

Механическая часть:

- `__dirname` → `import.meta.dirname` в шести скриптах, где он есть
  (`build-audio-watcher`, `tauri-wrapper`, `install-local`, `deploy-fast`,
  `service-install`, `service-uninstall`).
- `require.main === module` (`scripts/build-audio-watcher.js:46`) → сравнение
  `import.meta.url` с `pathToFileURL(process.argv[1]).href`.
- `require('../package.json')` (`scripts/service-install.js:4`,
  `scripts/service-uninstall.js:4`) → `JSON.parse(fs.readFileSync(...))`.
  Import attributes (`with { type: 'json' }`) на Node 22 всё ещё печатают
  ExperimentalWarning в stderr — сервисным скриптам это ни к чему.

`scripts/tauri-wrapper.js` вызывается через npm-скрипты и как ESM работает без
изменений сверх перечисленных.

## 7. Границы

Не затрагивается:

- `src-tauri/` — кроме одной строки в `bundle.resources` (§1). Rust-код
  спавнит `_up_/src/index.js` тем же способом.
- `frontend/` — только HTML (`index.html`, `about.html`); тип скриптов там
  определяет браузер, а не `package.json`.
- `audio-watcher` — Rust-крейт; `scripts/build-audio-watcher.js` вызывает
  `cargo build`. Никакого JS-бандлера (`pkg`, Node SEA) в цепочке сборки нет,
  поэтому обычный источник боли при переходе на ESM здесь отсутствует.

Одна оговорка: `data/` в `.gitignore` и содержит CJS-файлы (`data/config.js`,
`data/index.js`, `data/config.example.js`). С `"type": "module"` в корне они
перестанут запускаться напрямую через `node`. Лечится файлом
`data/package.json` с `{"type": "commonjs"}` — включить в план одной строкой.
`npm run deploy` (`zsh data/deploy.sh`) не затрагивается.

## 8. Приёмка

Автоматически:

- `npm test` зелёный, включая новые/переписанные тесты из §1 и §5.
- `cd src-tauri && TAURI_CONFIG='{"bundle":{"resources":[]}}' cargo test` зелёный.
- Гард из §1 (`package.json` в `bundle.resources` + `type: module`) на месте.
- Сканер относительных путей из §5 работает по импортам, а не по `require`.
- В `src/`, `scripts/`, `test/` не осталось ни одного `require(`,
  `module.exports`, `__dirname` — проверяется грепом при ревью.

Вручную, чек-листом в PR (на Windows, за автором):

- `npm run deploy-local` — сборка инсталлятора, установка, запуск.
- Приложение поднялось, трей на месте, версия в меню верная.
- Живой лог в окне приложения не пустой и не залит `[error]` (проверка §3).
- Модули с нативными зависимостями отвечают: `keys`, `midi`, `obs`, `audio`.
- Перезагрузка midi-конфига работает (проверка §4).
- `7z x` по инсталлятору: `config.yml` / `commands.yml` / `data/` отсутствуют,
  реальные значения из `%APPDATA%\windows-mqtt\config.yml` не встречаются.

## Порядок работ (для плана)

Один PR, три коммита. `"type": "module"` — флаг-день: между ним и переводом
последнего файла зелёного состояния не существует, поэтому дробить второй
коммит нельзя. Первый коммит существует именно для того, чтобы флаг-день не
тащил на себе ещё и смену тестовых механизмов.

1. **Подготовка, ещё на CJS, тесты зелёные.** `reload()`/`setConfig()` в
   `src/config.js` (§4), `deps.robot` в `src/modules/keys.js` (§5), async
   `load()` в `src/modules/index.js` (§2) с `await` в `src/helpers.js:190`.
   Тесты `keys-press-throttle`, `power-module-gate`, `modules-registry`,
   `native-modules` переводятся на новые точки инъекции; `require.cache`
   уходит целиком.
2. **Флаг-день.** `"type": "module"` в `package.json` плюс перевод `src/`,
   `scripts/` и `test/` на импорты одним коммитом: `src/index.js` (§3),
   `src/server.js` (§2), механика по §2 и §6. Сюда же — `"../package.json"` в
   `bundle.resources` и гард-тест из §1: собранный между коммитами инсталлятор
   иначе был бы заведомо нерабочим, а гард-тест до этого коммита просто не
   может быть зелёным.
3. **Хвост: документация и мелочи.** `data/package.json` с
   `{"type": "commonjs"}` (§7), сканер относительных путей на импортах вместо
   `require` (§5), правка `CLAUDE.md` в разделе про относительные `require`
   в `src/`.
