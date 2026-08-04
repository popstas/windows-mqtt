# ccfzf-picker (macOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Менеджер сессий claude-wt на macOS: список сессий с pc-virt, открытие
выбранной сессии в kitty, без отслеживания окон и без монтирования файловой
системы.

**Architecture:** Новый репозиторий `ccfzf-picker` на pc-virt
(`~/projects/js/ccfzf-picker`). Три слоя: агрегатор `ccfzf --state` на pc-virt
отдаёт весь список одним JSON по ssh; чистые функции во `frontend-src/` считают
всё про строку сессии; Rust (Tauri 2) держит окно, хоткеи и запуск процессов.
Windows-сторона не трогается — переводится отдельным спеком позже.

**Tech Stack:** Python 3 (внутри ccfzf), JavaScript без сборщика (UMD-шим,
как в windows-mqtt), тесты через `node --test` (node:test, ноль зависимостей),
Tauri 2 + tauri-plugin-global-shortcut + tauri-plugin-shell, kitty.

Спек: `docs/superpowers/specs/2026-08-04-ccfzf-picker-macos-design.md`.

## Global Constraints

- Репозиторий: `~/projects/js/ccfzf-picker` на pc-virt (`popstas@pc-virt.popstas.pro`).
- Задачи 1–8 выполняются **на pc-virt**. Задачи 9–14 требуют **macOS** (сборка Tauri).
- Файлы `frontend-src/*.js` пишутся в UMD-шиме: работают и как `<script>`, и как
  CommonJS-модуль в тестах. Паттерн копируется из
  `windows-mqtt/frontend-src/session-glyph.js` дословно.
- Тесты — только `node --test`, без vitest и без внешних зависимостей.
- Никаких чтений с сетевых дисков: единственный источник данных — `ccfzf --state`
  по ssh.
- Глобальный хоткей пикера по умолчанию: `Cmd+Shift+T`.
- `ccfzf` живёт по пути `/home/popstas/bin/ccfzf` (913 строк, bash + встроенный
  python в heredoc `PY`), правится на месте и **не копируется в репозиторий**.
- Ни одна задача не меняет режим `dump` в ccfzf: от него зависит работающий
  пикер на Windows.

---

### Task 1: Эксперимент с reptyr

Результат влияет только на то, останется ли строка `reptyr` в таблице стратегий
(Task 7). Всё остальное строится независимо, поэтому задача идёт первой, но не
блокирует.

**Files:**
- Create: `~/projects/js/ccfzf-picker/docs/reptyr-experiment.md`

**Interfaces:**
- Consumes: ничего
- Produces: вывод «reptyr пригоден / непригоден» — читается в Task 7 при
  заполнении `caps.reptyr`

- [ ] **Step 1: Убедиться, что есть на чём ставить опыт**

Запустить на pc-virt:

```bash
ps -eo pid,tty,nlwp,comm,args --sort=pid | grep -E '^\s*[0-9]+ pts' | grep -i claude | grep -v grep
```

Ожидается хотя бы одна строка с `pts/N` — это интерактивная сессия в терминале.
Записать её pid и tty. Если строк нет, открыть claude-сессию в терминале и
повторить.

- [ ] **Step 2: Поставить reptyr и временно ослабить ptrace**

```bash
sudo apt-get install -y reptyr && sudo sysctl -w kernel.yama.ptrace_scope=0
```

`sysctl -w` действует до перезагрузки — это намеренно: постоянным
(`/etc/sysctl.d/`) параметр становится только в Step 7 и только при успехе.

- [ ] **Step 3: Опыт на сессии, ждущей ввода**

В новом терминале (kitty на маке или второй ssh — важно, что это другой tty):

```bash
reptyr -T <pid>
```

Проверить по порядку и записать результат каждого пункта:

1. TUI перерисовался в новом терминале;
2. ввод доходит — отправить агенту короткое сообщение;
3. ход доводится до конца, ответ виден;
4. хук пишет состояние: `stat -c %y ~/.claude/claude-wt/<id>.state.json`
   изменилось после хода;
5. старый терминал, будучи закрытым, не уносит процесс:
   `ps -p <pid>` всё ещё показывает его;
6. `Ctrl+C` в новом терминале не разваливает сессию.

- [ ] **Step 4: Опыт на сессии в середине хода**

Повторить Step 3 на сессии, которая прямо сейчас работает (агент выполняет
инструменты). Именно здесь 21–32 потока Node проявляют себя, если проявляют.

- [ ] **Step 5: Записать результат**

Создать `docs/reptyr-experiment.md`: дата, версия reptyr
(`reptyr --version`), pid и tty подопытных, результат каждого из шести пунктов
для обоих опытов, итоговый вердикт одной строкой — «пригоден» или «непригоден,
причина».

- [ ] **Step 6: Если непригоден — вернуть ptrace_scope**

```bash
sudo sysctl -w kernel.yama.ptrace_scope=1
```

На этом задача закончена: в Task 7 `caps.reptyr` будет `false`.

- [ ] **Step 7: Если пригоден — закрепить ptrace_scope**

```bash
echo 'kernel.yama.ptrace_scope = 0' | sudo tee /etc/sysctl.d/10-ptrace.conf
```

В `docs/reptyr-experiment.md` дописать строку: это ослабление локальной защиты —
любой процесс пользователя может ptrace'ить любой другой его процесс.

- [ ] **Step 8: Commit**

Репозитория ещё нет — файл создаётся во временном месте
(`~/reptyr-experiment.md`) и переносится в репозиторий коммитом в Task 2,
Step 8.

---

### Task 2: Скелет репозитория и валидатор формы `--state`

**Files:**
- Create: `~/projects/js/ccfzf-picker/package.json`
- Create: `~/projects/js/ccfzf-picker/.gitignore`
- Create: `~/projects/js/ccfzf-picker/README.md`
- Create: `~/projects/js/ccfzf-picker/frontend-src/state-shape.js`
- Create: `~/projects/js/ccfzf-picker/scripts/check-state.js`
- Test: `~/projects/js/ccfzf-picker/test/state-shape.test.js`

**Interfaces:**
- Consumes: ничего
- Produces: `validateState(obj) -> string[]` — список претензий к форме ответа
  агрегатора, пустой массив означает «форма верна». Используется в Task 3 и 4.

- [ ] **Step 1: Создать репозиторий и package.json**

```bash
mkdir -p ~/projects/js/ccfzf-picker/{frontend-src,test,scripts,docs} && cd ~/projects/js/ccfzf-picker && git init
```

`package.json`:

```json
{
  "name": "ccfzf-picker",
  "version": "0.1.0",
  "description": "Cross-platform picker for claude-wt sessions",
  "private": true,
  "scripts": {
    "test": "node --test test/"
  }
}
```

`.gitignore`:

```
node_modules/
frontend/
src-tauri/target/
```

`README.md`:

```markdown
# ccfzf-picker

Пикер сессий claude-wt. Список берётся из `ccfzf --state` по ssh, окно
и хоткеи — Tauri, открытие сессии — kitty.

Спек и план: см. `windows-mqtt/docs/superpowers/`.

    npm test
```

- [ ] **Step 2: Написать падающий тест**

`test/state-shape.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { validateState } = require('../frontend-src/state-shape');

const good = {
  generated: 1785858452.9,
  sessions: [{
    id: '89e04faa-04fb-4828-96e2-21249b41fca3',
    cwd: '/home/popstas/projects/x',
    title: 'b2b-kpi',
    gist: 'что-то',
    mtime: 1785858452.9,
    live: true,
    frozen: false,
    kind: 'interactive',
    parent: '',
    pid: 1626189,
    tty: '/dev/pts/1',
    tmux: null,
    agent: null,
  }],
};

test('форма без претензий проходит', () => {
  assert.deepStrictEqual(validateState(good), []);
});

test('отсутствие sessions — претензия', () => {
  assert.deepStrictEqual(validateState({ generated: 1 }), ['sessions is not an array']);
});

test('сессия без id названа по индексу', () => {
  const bad = { generated: 1, sessions: [{ cwd: '/x' }] };
  assert.ok(validateState(bad).some(m => m.includes('sessions[0]') && m.includes('id')));
});

test('лишние поля не считаются ошибкой', () => {
  const extra = JSON.parse(JSON.stringify(good));
  extra.sessions[0].projects = ['/home/popstas/projects/x'];
  assert.deepStrictEqual(validateState(extra), []);
});

test('agent проверяется только когда он не null', () => {
  const withAgent = JSON.parse(JSON.stringify(good));
  withAgent.sessions[0].agent = { updated: 'вчера' };
  assert.ok(validateState(withAgent).some(m => m.includes('agent.updated')));
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `cd ~/projects/js/ccfzf-picker && npm test`
Expected: FAIL — `Cannot find module '../frontend-src/state-shape'`

- [ ] **Step 4: Реализовать validateState**

`frontend-src/state-shape.js`:

```js
// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// The project has no bundler, and duplicating this logic to make it testable
// would be worse than this shim.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StateShape = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Проверяются только те поля, на которые опирается пикер. Лишние поля
  // агрегатора — не ошибка: ccfzf отдаёт и то, что нужно другим читателям.
  const SESSION_FIELDS = [
    ['id', 'string'],
    ['cwd', 'string'],
    ['title', 'string'],
    ['mtime', 'number'],
    ['live', 'boolean'],
    ['kind', 'string'],
  ];

  function validateState(obj) {
    const out = [];
    if (!obj || !Array.isArray(obj.sessions)) return ['sessions is not an array'];
    if (typeof obj.generated !== 'number') out.push('generated is not a number');
    obj.sessions.forEach((s, i) => {
      for (const [key, type] of SESSION_FIELDS) {
        if (typeof (s || {})[key] !== type) out.push(`sessions[${i}].${key} is not a ${type}`);
      }
      // pid и tty есть только у живой сессии: у остальных процесса нет.
      if (s && s.live && typeof s.pid !== 'number') out.push(`sessions[${i}].pid is not a number`);
      // agent отсутствует, пока хук ни разу не сработал, — это нормально.
      if (s && s.agent && typeof s.agent.updated !== 'number') {
        out.push(`sessions[${i}].agent.updated is not a number`);
      }
    });
    return out;
  }

  return { validateState };
});
```

- [ ] **Step 5: Запустить тесты**

Run: `npm test`
Expected: PASS, 5 тестов

- [ ] **Step 6: Написать обёртку для проверки живого агрегатора**

`scripts/check-state.js`:

```js
// Прогон живого ответа агрегатора через ту же проверку, что и тесты:
//   ccfzf --state | node scripts/check-state.js
const { validateState } = require('../frontend-src/state-shape');

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    console.error(`not json: ${e.message}`);
    process.exit(1);
  }
  const problems = validateState(obj);
  if (problems.length) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`ok: ${obj.sessions.length} sessions`);
});
```

- [ ] **Step 7: Проверить, что обёртка ловит мусор**

```bash
echo '{"generated":1}' | node scripts/check-state.js; echo "exit=$?"
```

Expected: `sessions is not an array` в stderr, `exit=1`

- [ ] **Step 8: Перенести отчёт об опыте и закоммитить**

```bash
mv ~/reptyr-experiment.md docs/reptyr-experiment.md
git add -A
git commit -m "feat: скелет репозитория и валидатор формы ccfzf --state"
```

---

### Task 3: `ccfzf --state` — список сессий с данными агента

Режим `dump` не трогается: от него зависит работающий пикер на Windows.

**Files:**
- Modify: `/home/popstas/bin/ccfzf` (bash-разбор аргументов ~строки 56–94 и
  ~650; python-блок `PY`: новая функция рядом с `usage_of` ~строка 234, новая
  ветка `mode` после `elif mode == "dump"` ~строка 645)

**Interfaces:**
- Consumes: `validateState()` из Task 2 — через `scripts/check-state.js`
- Produces: `ccfzf --state` печатает в stdout JSON вида
  `{generated: number, sessions: [{id, cwd, file, title, gist, doing, mtime, age, live, frozen, kind, parent, agent}]}`,
  где `agent` — объект или `null`

- [ ] **Step 1: Проверить, что базовая форма пока не набирается**

```bash
cd ~/projects/js/ccfzf-picker && ccfzf --state | node scripts/check-state.js; echo "exit=$?"
```

Expected: `ccfzf: unknown option --state` или подобная ошибка, `exit` не 0.

- [ ] **Step 2: Добавить чтение записи агента в python-блок**

В `/home/popstas/bin/ccfzf`, сразу после функции `usage_of` (заканчивается на
строке 248 `return int(num(o.get("contextPct"))), int(num(o.get("costUsd")))`),
вставить:

```python
def agent_of(sid):
    """Склеенные <id>.state.json и <id>.status.json, или None.

    Склейка живёт здесь, а не у читателя: файлы локальные, а читатель —
    на другой машине через ssh. Числа из статуслайна перекрывают те, что
    хук успел положить в state.json: status.json пишется чаще.
    """
    def load(suffix):
        try:
            with open(os.path.join(STATUS_DIR, sid + suffix), encoding="utf-8") as fh:
                o = json.load(fh)
                return o if isinstance(o, dict) else {}
        except (OSError, ValueError):
            return {}

    state = load(".state.json")
    status = load(".status.json")
    if not state and not status:
        return None

    out = {
        "state": state.get("state", ""),
        "event": state.get("event", ""),
        "summary": state.get("summary", ""),
        "lastSummary": state.get("lastSummary", ""),
        "prompt": state.get("prompt", ""),
        "branch": state.get("branch", ""),
        "pr_url": state.get("pr_url", ""),
        "costUsd": status.get("costUsd", state.get("costUsd", 0)) or 0,
        "contextPct": status.get("contextPct", state.get("contextPct", 0)) or 0,
        "updated": max(state.get("updated", 0) or 0, status.get("updated", 0) or 0),
    }
    return out
```

- [ ] **Step 3: Добавить режим `state` в python-блок**

В том же файле, между концом ветки `elif mode == "dump":` (последняя её строка —
`})` на строке 645) и закрывающим `PYEOF` (строка 646), вставить:

```python
elif mode == "state":
    # Всё, что нужно удалённому пикеру, одним JSON в stdout: на диск ничего
    # не пишется, потому что читатель на другой машине и файл ему всё равно
    # недоступен. Форма намеренно сырая — kind, parent и agent уходят как
    # есть, а склейку «кто на самом деле работает» делает читатель.
    marks = read_marks(sys.argv[2])
    now = time.time()

    dirs = scan_dirs()
    live, agents = running_sessions()
    frozen = frozen_ids()

    files = []
    for entry in dirs:
        files += [(f, mt, entry["cwd"]) for f, mt in entry["files"]]
    files.sort(key=lambda x: -x[1])

    sessions = []
    for path, mtime, cwd in files[:DUMP_SESSIONS]:
        sid = os.path.basename(path)[:-6]
        title, doing = tail_facts(path)
        agent = agents.get(sid) or {}
        sessions.append({
            "id": sid, "cwd": cwd, "file": path,
            "projects": sorted(owners_of(cwd, marks)),
            "title": clean(title), "gist": (head_gist(path) or doing)[:200],
            "doing": doing,
            "mtime": mtime, "age": ago(mtime, now),
            "live": sid in live, "frozen": sid in frozen,
            "kind": agent.get("kind", "interactive"),
            "parent": agent.get("parent", ""),
            "agent": agent_of(sid),
        })

    json.dump({"generated": now, "sessions": sessions},
              sys.stdout, ensure_ascii=False)
```

- [ ] **Step 4: Добавить флаг `--state` в bash-часть**

Три правки в `/home/popstas/bin/ccfzf`:

1. После строки 58 (`dump_only=0`) добавить:

```bash
state_only=0
```

2. В `case` разбора аргументов, после строки 67 (`--dump) dump_only=1; shift ;;`)
   добавить:

```bash
    --state) state_only=1; shift ;;
```

3. Перед блоком `if ((dump_only)); then` на строке 650 вставить:

```bash
# Читателю на другой машине нужен ответ в stdout, а не файл на диске.
if ((state_only)); then
  python3 -c "$PY" state "$MARKS"
  exit 0
fi
```

Также в проверку зависимостей: строку 86 `if ((dump_only)); then` заменить на

```bash
if ((dump_only || state_only)); then
```

и в проверку взаимоисключения после строки 79 добавить:

```bash
((state_only && (kiosk || print_mode || dump_only || ${#session_id} || ${#project}))) && {
  echo "ccfzf: --state takes no other mode flags" >&2; exit 2;
}
```

- [ ] **Step 5: Проверить форму на живых данных**

```bash
cd ~/projects/js/ccfzf-picker && ccfzf --state | node scripts/check-state.js; echo "exit=$?"
```

Expected: `ok: N sessions`, `exit=0`. Претензии про `pid` ожидаемы и снимаются в
Task 4 — на этом шаге можно временно проверить без них:

```bash
ccfzf --state | node -e "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{const o=JSON.parse(r);const s=o.sessions.find(x=>x.agent);console.log('sessions',o.sessions.length,'with agent',o.sessions.filter(x=>x.agent).length);console.log(JSON.stringify(s&&s.agent,null,1))})"
```

Expected: ненулевое число сессий с `agent`, у одной видно `summary`/`lastSummary`
и `updated`.

- [ ] **Step 6: Убедиться, что режим dump не сломан**

```bash
ccfzf --dump && node -e "const j=require('/home/popstas/.ccfzf.sessions.json');console.log('dump ok',j.sessions.length)"
```

Expected: `dump ok 200`

- [ ] **Step 7: Проверить взаимоисключение флагов**

```bash
ccfzf --state --dump; echo "exit=$?"
```

Expected: `ccfzf: --state takes no other mode flags`, `exit=2`

- [ ] **Step 8: Commit**

`ccfzf` лежит вне репозитория, поэтому в репозиторий кладётся его копия для
истории правок:

```bash
cd ~/projects/js/ccfzf-picker
mkdir -p vendor && cp /home/popstas/bin/ccfzf vendor/ccfzf
git add -A
git commit -m "feat: ccfzf --state отдаёт список сессий с данными агента"
```

---

### Task 4: pid, tty и tmux в `--state`

Без этих трёх полей нельзя выбрать стратегию открытия: они отвечают на вопрос
«чем сессия занята прямо сейчас».

**Files:**
- Modify: `/home/popstas/bin/ccfzf` (python-блок: `running_sessions()` ~строки
  349–423, ветка `mode == "state"` из Task 3)
- Modify: `~/projects/js/ccfzf-picker/vendor/ccfzf`

**Interfaces:**
- Consumes: `ccfzf --state` из Task 3
- Produces: у каждой живой сессии в ответе появляются `pid: number`,
  `tty: string` (например `/dev/pts/1`, пустая строка если tty нет) и
  `tmux: string|null` (например `work:2.0`)

- [ ] **Step 1: Убедиться, что полей пока нет**

```bash
ccfzf --state | node -e "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{const s=JSON.parse(r).sessions.find(x=>x.live);console.log(JSON.stringify({id:s.id,pid:s.pid,tty:s.tty,tmux:s.tmux}))})"
```

Expected: `pid`, `tty`, `tmux` — `undefined`

- [ ] **Step 2: Научить running_sessions() возвращать процессы**

В `/home/popstas/bin/ccfzf`, в функции `running_sessions()`:

1. Строку 364 `live, fresh, agents = set(), [], {}` заменить на:

```python
    live, fresh, agents, procs = set(), [], {}, {}
```

2. Строку 368 `        return live, agents` заменить на:

```python
        return live, agents, procs
```

3. После строки 401 (`live.add(sid)`) вставить:

```python
        # Чем сессия занята: без pid её нельзя ни перехватить, ни хотя бы
        # честно показать человеку, что открытие будет не тихим resume.
        procs[sid] = {"pid": int(pid), "tty": proc_tty(pid), "tmux": proc_tmux(pid)}
```

4. Строку 423 `    return live, agents` заменить на:

```python
    return live, agents, procs
```

- [ ] **Step 3: Добавить чтение tty и tmux**

Перед функцией `running_sessions()` (то есть после `is_claude`, которая
заканчивается на строке 346) вставить:

```python
def proc_tty(pid):
    """Управляющий терминал процесса — из fd 0, а не из /proc/<pid>/stat.

    tty_nr в stat — это номер устройства, который ещё надо разворачивать в
    путь; fd 0 у интерактивной сессии и так указывает прямо на /dev/pts/N.
    """
    try:
        target = os.readlink("/proc/%s/fd/0" % pid)
    except OSError:
        return ""
    return target if target.startswith("/dev/") else ""


def proc_tmux(pid):
    """`session:window.pane`, если процесс живёт внутри tmux, иначе None.

    TMUX_PANE в окружении — это id панели (%3), а не адрес, по которому к ней
    можно присоединиться. Разворачивает его сам tmux; делается это здесь, а не
    у читателя, потому что читатель на другой машине и tmux ему недоступен.
    """
    try:
        with open("/proc/%s/environ" % pid, "rb") as fh:
            env = fh.read().decode("utf-8", "ignore").split("\0")
    except OSError:
        return None
    pane = ""
    for item in env:
        if item.startswith("TMUX_PANE="):
            pane = item[len("TMUX_PANE="):]
            break
    if not pane:
        return None
    try:
        out = subprocess.run(
            ["tmux", "display", "-p", "-t", pane,
             "#{session_name}:#{window_index}.#{pane_index}"],
            capture_output=True, text=True, timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    target = out.stdout.strip()
    return target or None
```

- [ ] **Step 4: Добавить импорт subprocess**

В шапке python-блока найти строку `import glob, json, os, re, sys, time`
(около строки 105) и заменить на:

```python
import glob, json, os, re, subprocess, sys, time
```

- [ ] **Step 5: Поправить три вызова running_sessions()**

Функция теперь возвращает три значения. Найти все вызовы:

```bash
grep -n "running_sessions()" /home/popstas/bin/ccfzf
```

Ожидаются вызовы в ветках `projects`, `sessions`, `dump` и `state`. В первых
трёх — заменить `live, agents = running_sessions()` на:

```python
    live, agents, _ = running_sessions()
```

В ветке `state` — на:

```python
    live, agents, procs = running_sessions()
```

- [ ] **Step 6: Отдать поля наружу в ветке state**

В ветке `mode == "state"` в словаре сессии, после строки
`"parent": agent.get("parent", ""),` вставить:

```python
            "pid": (procs.get(sid) or {}).get("pid", 0),
            "tty": (procs.get(sid) or {}).get("tty", ""),
            "tmux": (procs.get(sid) or {}).get("tmux"),
```

- [ ] **Step 7: Проверить на живых данных**

```bash
cd ~/projects/js/ccfzf-picker && ccfzf --state | node scripts/check-state.js
```

Expected: `ok: N sessions`, exit 0 — теперь и проверка `pid` у живых проходит.

```bash
ccfzf --state | node -e "let r='';process.stdin.on('data',c=>r+=c).on('end',()=>{for(const s of JSON.parse(r).sessions.filter(x=>x.live))console.log(s.pid,s.tty,s.tmux,s.title)})"
```

Expected: по строке на каждую живую сессию, `tty` вида `/dev/pts/N`, `tmux`
равен `null` у сессий вне tmux.

- [ ] **Step 8: Проверить tmux-ветку**

```bash
tmux new-session -d -s probe 'sleep 300' && tmux list-panes -t probe -F '#{pane_id} #{session_name}:#{window_index}.#{pane_index}'
```

Затем убедиться, что `proc_tmux` разворачивает pane в адрес: взять pid процесса
внутри панели и проверить напрямую:

```bash
python3 -c "
import subprocess
out = subprocess.run(['tmux','display','-p','-t','%<pane_id>','#{session_name}:#{window_index}.#{pane_index}'],capture_output=True,text=True)
print(repr(out.stdout.strip()))"
```

Expected: `'probe:0.0'`. Убрать за собой: `tmux kill-session -t probe`

- [ ] **Step 9: Убедиться, что dump и интерактивный режим не сломаны**

```bash
ccfzf --dump && node -e "const j=require('/home/popstas/.ccfzf.sessions.json');console.log('dump ok',j.sessions.length,'live',j.sessions.filter(s=>s.live).length)"
```

Expected: `dump ok 200 live N`, где N совпадает с числом живых из Step 7.

- [ ] **Step 10: Commit**

```bash
cd ~/projects/js/ccfzf-picker && cp /home/popstas/bin/ccfzf vendor/ccfzf
git add -A
git commit -m "feat: pid, tty и tmux в ccfzf --state"
```

---

### Task 5: Запись агента — состояние, сводка, прочитанность

Перенос чистых функций из `windows11-manager/src/claude-wt/progress-helpers.js`
и `view-helpers.js` в UMD-шим. Логика та же, источник другой: не файлы с
сетевого диска, а поле `agent` из ответа агрегатора.

**Files:**
- Create: `~/projects/js/ccfzf-picker/frontend-src/session-agent.js`
- Test: `~/projects/js/ccfzf-picker/test/session-agent.test.js`
- Reference: `windows11-manager/src/claude-wt/progress-helpers.js:84-133`,
  `windows11-manager/src/claude-wt/view-helpers.js:36-46`

**Interfaces:**
- Consumes: поле `agent` из ответа `ccfzf --state` (Task 3)
- Produces:
  - `sessionDescription(agent) -> string`
  - `lastActivityAt(agent) -> number|null`
  - `seenSinceUpdate(agent, focusedAt) -> boolean`
  - `activeAgent(session, byId) -> { id, agent, background }`

- [ ] **Step 1: Написать падающие тесты**

`test/session-agent.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  sessionDescription, lastActivityAt, seenSinceUpdate, activeAgent,
} = require('../frontend-src/session-agent');

test('сводка берётся из summary, а у работающей сессии — из lastSummary', () => {
  assert.strictEqual(sessionDescription({ summary: ' готово ', lastSummary: 'старое' }), 'готово');
  assert.strictEqual(sessionDescription({ summary: '', lastSummary: ' работаю ' }), 'работаю');
  assert.strictEqual(sessionDescription(null), '');
});

test('последняя активность — из отметки хука', () => {
  assert.strictEqual(lastActivityAt({ updated: 1785858452 }), 1785858452);
  assert.strictEqual(lastActivityAt({ updated: 0 }), null);
  assert.strictEqual(lastActivityAt(null), null);
});

test('без записи агента вопрос о прочитанности не имеет смысла', () => {
  assert.strictEqual(seenSinceUpdate(null, 999999), false);
  assert.strictEqual(seenSinceUpdate({ updated: 0 }, 999999), false);
});

test('просмотр в ту же секунду считается просмотром', () => {
  assert.strictEqual(seenSinceUpdate({ updated: 100 }, 100), true);
  assert.strictEqual(seenSinceUpdate({ updated: 100 }, 99), false);
  assert.strictEqual(seenSinceUpdate({ updated: 100 }, undefined), false);
});

test('работу сессии говорит тот, чья запись свежее', () => {
  const parent = { id: 'p', agent: { updated: 100 } };
  const byId = {
    p: { id: 'p', kind: 'interactive', parent: '', agent: { updated: 100 } },
    c: { id: 'c', kind: 'background', parent: 'p', agent: { updated: 200 } },
  };
  const active = activeAgent(parent, byId);
  assert.strictEqual(active.id, 'c');
  assert.strictEqual(active.background, true);
  assert.strictEqual(active.agent.updated, 200);
});

test('родитель со свежей записью забирает голос обратно', () => {
  const byId = {
    p: { id: 'p', kind: 'interactive', parent: '', agent: { updated: 300 } },
    c: { id: 'c', kind: 'background', parent: 'p', agent: { updated: 200 } },
  };
  const active = activeAgent(byId.p, byId);
  assert.strictEqual(active.id, 'p');
  assert.strictEqual(active.background, false);
});

test('сессия без фоновых агентов говорит сама за себя', () => {
  const s = { id: 'p', kind: 'interactive', parent: '', agent: null };
  assert.deepStrictEqual(activeAgent(s, { p: s }), { id: 'p', agent: null, background: false });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `cd ~/projects/js/ccfzf-picker && npm test`
Expected: FAIL — `Cannot find module '../frontend-src/session-agent'`

- [ ] **Step 3: Реализовать**

`frontend-src/session-agent.js`:

```js
// Loaded twice: as a <script> in sessions.html and as a module in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionAgent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Строка, которую показывают все читатели.
   *
   * Считается в одном месте, чтобы не расходилась: `summary` пуст, пока ход
   * не закончен, и у работающей сессии годится только `lastSummary`.
   */
  function sessionDescription(agent) {
    const summary = typeof (agent || {}).summary === 'string' ? agent.summary.trim() : '';
    if (summary) return summary;
    return typeof (agent || {}).lastSummary === 'string' ? agent.lastSummary.trim() : '';
  }

  /** Когда сессия последний раз подавала признаки жизни, epoch-секунды. */
  function lastActivityAt(agent) {
    const updated = (agent || {}).updated || 0;
    return updated || null;
  }

  /**
   * Видел ли человек то состояние, в котором сессия находится сейчас.
   *
   * На маке отметку ставит не трекер окон, а само открытие сессии, но правило
   * то же: переход в ту же секунду, что и запись состояния, — это переход
   * после неё, поэтому сравнение нестрогое.
   */
  function seenSinceUpdate(agent, focusedAt) {
    const updated = (agent || {}).updated || 0;
    if (!updated) return false;
    const seen = Number.isFinite(focusedAt) ? focusedAt : 0;
    return seen >= updated;
  }

  /**
   * Кто на самом деле работает в этой сессии: она сама или её фоновый агент.
   *
   * `claude agents` уводит работу в форк: интерактивный процесс уходит, окно
   * остаётся с прежним заголовком, а хуки с этого момента пишет форк — под
   * своим id. Берётся тот, чья запись свежее; родитель может ожить обратно.
   */
  function activeAgent(session, byId) {
    let best = { id: session.id, agent: session.agent || null, background: false };
    for (const key of Object.keys(byId || {})) {
      const child = byId[key];
      if (!child || child.kind !== 'background' || child.parent !== session.id) continue;
      if (!child.agent) continue;
      if ((child.agent.updated || 0) <= ((best.agent || {}).updated || 0)) continue;
      best = { id: child.id, agent: child.agent, background: true };
    }
    return best;
  }

  return { sessionDescription, lastActivityAt, seenSinceUpdate, activeAgent };
});
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: PASS — 7 тестов в этом файле, 12 всего

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: запись агента — сводка, активность, прочитанность"
```

---

### Task 6: Сборка строк списка

`buildSessionList()` из windows11-manager строится вокруг `slots` — состояния
оконного трекера. Здесь источник другой: сессии из ответа агрегатора. Поэтому
функция пишется заново, а не переносится, но правила внутри те же.

**Files:**
- Create: `~/projects/js/ccfzf-picker/frontend-src/session-list.js`
- Test: `~/projects/js/ccfzf-picker/test/session-list.test.js`
- Reference: `windows11-manager/src/claude-wt/view-helpers.js:48-90`

**Interfaces:**
- Consumes: `sessionDescription`, `lastActivityAt`, `seenSinceUpdate`,
  `activeAgent` (Task 5); ответ `ccfzf --state` (Task 4)
- Produces: `buildSessionList({ sessions, seen }) -> Row[]`, где `Row` =
  `{ id, title, cwd, live, frozen, pid, tty, tmux, kind, branch, prUrl, state,
  event, summary, prompt, cost, contextPct, updated, unread, background,
  agentSessionId }`

- [ ] **Step 1: Написать падающие тесты**

`test/session-list.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSessionList } = require('../frontend-src/session-list');

function state(extra) {
  return Object.assign({
    id: 'a', cwd: '/home/popstas/x', title: 'Тема', gist: '', doing: '',
    mtime: 100, live: false, frozen: false, kind: 'interactive', parent: '',
    pid: 0, tty: '', tmux: null, agent: null,
  }, extra || {});
}

test('строка собирается из сессии и её записи агента', () => {
  const rows = buildSessionList({
    sessions: [state({ agent: {
      state: 'question', event: 'stop', summary: 'Готово', lastSummary: '',
      prompt: 'сделай', branch: 'feat/x', pr_url: 'https://github.com/o/r/pull/3',
      costUsd: 2, contextPct: 10, updated: 500,
    } })],
    seen: {},
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].summary, 'Готово');
  assert.strictEqual(rows[0].branch, 'feat/x');
  assert.strictEqual(rows[0].prUrl, 'https://github.com/o/r/pull/3');
  assert.strictEqual(rows[0].cost, 2);
  assert.strictEqual(rows[0].contextPct, 10);
  assert.strictEqual(rows[0].updated, 500);
});

test('фоновые агенты не занимают своей строки', () => {
  const rows = buildSessionList({
    sessions: [
      state({ id: 'p', agent: { updated: 100, summary: 'ушёл в фон' } }),
      state({ id: 'c', kind: 'background', parent: 'p',
              agent: { updated: 200, summary: 'работаю' } }),
    ],
    seen: {},
  });
  assert.deepStrictEqual(rows.map(r => r.id), ['p']);
  assert.strictEqual(rows[0].summary, 'работаю');
  assert.strictEqual(rows[0].background, true);
  assert.strictEqual(rows[0].agentSessionId, 'c');
});

test('непрочитанность считается по отметке открытия', () => {
  const sessions = [state({ id: 'a', agent: { updated: 500, summary: 'ответ' } })];
  assert.strictEqual(buildSessionList({ sessions, seen: {} })[0].unread, true);
  assert.strictEqual(buildSessionList({ sessions, seen: { a: 499 } })[0].unread, true);
  assert.strictEqual(buildSessionList({ sessions, seen: { a: 500 } })[0].unread, false);
});

test('сессия без записи агента не бывает непрочитанной', () => {
  const rows = buildSessionList({ sessions: [state({ agent: null })], seen: {} });
  assert.strictEqual(rows[0].unread, false);
  assert.strictEqual(rows[0].summary, '');
});

test('поля процесса переносятся как есть', () => {
  const rows = buildSessionList({
    sessions: [state({ live: true, pid: 42, tty: '/dev/pts/1', tmux: 'work:2.0' })],
    seen: {},
  });
  assert.strictEqual(rows[0].live, true);
  assert.strictEqual(rows[0].pid, 42);
  assert.strictEqual(rows[0].tty, '/dev/pts/1');
  assert.strictEqual(rows[0].tmux, 'work:2.0');
});

test('пустой список сессий даёт пустой список строк', () => {
  assert.deepStrictEqual(buildSessionList({ sessions: [], seen: {} }), []);
  assert.deepStrictEqual(buildSessionList({}), []);
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../frontend-src/session-list'`

- [ ] **Step 3: Реализовать**

`frontend-src/session-list.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionList = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // globalThis, а не `root`: тот виден только внешней функции шима, а внутрь
  // factory не передаётся.
  const agentApi = typeof module === 'object' && module.exports
    ? require('./session-agent')
    : globalThis.SessionAgent;

  /**
   * Строки списка из ответа агрегатора.
   *
   * Фоновый агент своей строки не получает: у него нет ни терминала, ни
   * заголовка — он форкнут от родителя и работает вместо него. Его поля
   * подставляются в строку родителя, а сам он из списка исключается.
   */
  function buildSessionList({ sessions, seen } = {}) {
    const list = Array.isArray(sessions) ? sessions : [];
    const byId = {};
    for (const s of list) if (s && s.id) byId[s.id] = s;
    const marks = seen || {};

    return list
      .filter(s => s && s.id && s.kind !== 'background')
      .map(s => {
        const active = agentApi.activeAgent(s, byId);
        const agent = active.agent;
        const focusedAt = marks[s.id];
        return {
          id: s.id,
          title: s.title || '',
          cwd: s.cwd || '',
          live: Boolean(s.live),
          frozen: Boolean(s.frozen),
          pid: s.pid || 0,
          tty: s.tty || '',
          tmux: s.tmux || null,
          kind: s.kind || 'interactive',
          mtime: s.mtime || 0,
          gist: s.gist || '',
          branch: (agent || {}).branch || '',
          prUrl: (agent || {}).pr_url || '',
          state: (agent || {}).state || '',
          event: (agent || {}).event || '',
          summary: agentApi.sessionDescription(agent),
          prompt: (agent || {}).prompt || '',
          cost: (agent || {}).costUsd || 0,
          contextPct: (agent || {}).contextPct || 0,
          updated: agentApi.lastActivityAt(agent) || 0,
          unread: Boolean(agent) && !agentApi.seenSinceUpdate(agent, focusedAt),
          background: active.background,
          agentSessionId: active.id,
        };
      });
  }

  return { buildSessionList };
});
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: PASS — 6 тестов в этом файле, 18 всего

- [ ] **Step 5: Проверить на живых данных**

```bash
ccfzf --state > /tmp/state.json && node -e "
const { buildSessionList } = require('./frontend-src/session-list');
const rows = buildSessionList({ sessions: require('/tmp/state.json').sessions, seen: {} });
console.log('rows', rows.length, 'unread', rows.filter(r => r.unread).length, 'live', rows.filter(r => r.live).length);
console.log(rows.filter(r => r.summary).slice(0, 3).map(r => r.title + ' :: ' + r.summary.slice(0, 60)).join('\n'));
"
```

Expected: непустой список, у нескольких строк заполнена сводка.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: сборка строк списка из ответа агрегатора"
```

---

### Task 7: Выбор стратегии открытия и сборка команды

**Files:**
- Create: `~/projects/js/ccfzf-picker/frontend-src/open-strategy.js`
- Test: `~/projects/js/ccfzf-picker/test/open-strategy.test.js`
- Modify: `~/projects/js/ccfzf-picker/docs/reptyr-experiment.md` (ссылка на
  `caps.reptyr`)

**Interfaces:**
- Consumes: `Row` из `buildSessionList` (Task 6); вердикт из Task 1
- Produces:
  - `chooseOpenStrategy(row, caps) -> 'attach'|'reptyr'|'takeover'|'resume'`
  - `buildOpenCommand(row, strategy, opts) -> { argv: string[], destructive: boolean }`,
    где `opts` = `{ sshHost, terminal }`, `terminal` = `{ file, args }`

- [ ] **Step 1: Написать падающие тесты**

`test/open-strategy.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { chooseOpenStrategy, buildOpenCommand } = require('../frontend-src/open-strategy');

const OPTS = {
  sshHost: 'popstas@pc-virt.popstas.pro',
  terminal: { file: 'open', args: ['-na', 'kitty', '--args'] },
};

function row(extra) {
  return Object.assign({
    id: 'aaaa-bbbb', cwd: '/home/popstas/projects/x',
    live: false, pid: 0, tty: '', tmux: null,
  }, extra || {});
}

test('сессия в tmux открывается присоединением', () => {
  assert.strictEqual(chooseOpenStrategy(row({ live: true, tmux: 'work:2.0' }), { reptyr: true }), 'attach');
});

test('tmux выигрывает у reptyr даже у мёртвой сессии', () => {
  assert.strictEqual(chooseOpenStrategy(row({ live: false, tmux: 'work:2.0' }), { reptyr: true }), 'attach');
});

test('живая сессия вне tmux переносится через reptyr, когда он есть', () => {
  assert.strictEqual(chooseOpenStrategy(row({ live: true, pid: 42 }), { reptyr: true }), 'reptyr');
});

test('без reptyr живая сессия требует перехвата', () => {
  assert.strictEqual(chooseOpenStrategy(row({ live: true, pid: 42 }), { reptyr: false }), 'takeover');
});

test('живая сессия без pid перехватить нечего — идёт resume', () => {
  assert.strictEqual(chooseOpenStrategy(row({ live: true, pid: 0 }), { reptyr: true }), 'resume');
});

test('мёртвая сессия просто возобновляется', () => {
  assert.strictEqual(chooseOpenStrategy(row(), { reptyr: true }), 'resume');
  assert.strictEqual(chooseOpenStrategy(row(), {}), 'resume');
});

test('команда attach ведёт в панель tmux', () => {
  const cmd = buildOpenCommand(row({ tmux: 'work:2.0' }), 'attach', OPTS);
  assert.strictEqual(cmd.destructive, false);
  assert.deepStrictEqual(cmd.argv, [
    'open', '-na', 'kitty', '--args',
    'ssh', '-t', 'popstas@pc-virt.popstas.pro',
    "tmux attach -t 'work:2.0'",
  ]);
});

test('команда reptyr забирает процесс по pid', () => {
  const cmd = buildOpenCommand(row({ live: true, pid: 42 }), 'reptyr', OPTS);
  assert.strictEqual(cmd.destructive, false);
  assert.strictEqual(cmd.argv[cmd.argv.length - 1], 'reptyr -T 42');
});

test('команда resume заходит в каталог сессии', () => {
  const cmd = buildOpenCommand(row(), 'resume', OPTS);
  assert.strictEqual(cmd.destructive, false);
  assert.strictEqual(
    cmd.argv[cmd.argv.length - 1],
    "cd '/home/popstas/projects/x' && claude --resume 'aaaa-bbbb'",
  );
});

test('перехват помечен необратимым и убивает мягко', () => {
  const cmd = buildOpenCommand(row({ live: true, pid: 42 }), 'takeover', OPTS);
  assert.strictEqual(cmd.destructive, true);
  const remote = cmd.argv[cmd.argv.length - 1];
  assert.ok(remote.startsWith('kill -HUP 42'), remote);
  assert.ok(!remote.includes('-9'), remote);
  assert.ok(remote.includes("claude --resume 'aaaa-bbbb'"), remote);
});

test('кавычки в пути не разрывают команду', () => {
  const cmd = buildOpenCommand(row({ cwd: "/home/popstas/it's" }), 'resume', OPTS);
  assert.ok(cmd.argv[cmd.argv.length - 1].includes("/home/popstas/it'\\''s"));
});

test('незнакомая стратегия не даёт команды', () => {
  assert.strictEqual(buildOpenCommand(row(), 'нет такой', OPTS), null);
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../frontend-src/open-strategy'`

- [ ] **Step 3: Реализовать**

`frontend-src/open-strategy.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OpenStrategy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /** Одинарные кавычки в POSIX-строке: закрыть, экранировать, открыть заново. */
  function q(s) {
    return `'${String(s == null ? '' : s).replace(/'/g, `'\\''`)}'`;
  }

  /**
   * Чем открывать сессию.
   *
   * Порядок ветвей — по убыванию сохранности: tmux ничего не трогает, reptyr
   * переносит живой процесс, перехват его убивает, resume нужен только когда
   * трогать уже нечего. tmux проверяется первым и у мёртвой сессии тоже: если
   * панель существует, зайти в неё лучше, чем поднимать процесс заново.
   */
  function chooseOpenStrategy(row, caps) {
    if (!row) return 'resume';
    if (row.tmux) return 'attach';
    // Перехватывать нечего без pid: живой сессию мог назвать и эвристический
    // разбор /proc, который процесс так и не нашёл.
    if (row.live && row.pid) return (caps || {}).reptyr ? 'reptyr' : 'takeover';
    return 'resume';
  }

  /**
   * argv для запуска терминала. Ввод-вывод делает вызывающий.
   *
   * `destructive` поднимается только у перехвата: это единственная ветка, где
   * чужой процесс умирает, и подтверждение спрашивается по этому признаку, а
   * не по имени стратегии.
   */
  function buildOpenCommand(row, strategy, opts) {
    const { sshHost, terminal } = opts || {};
    let remote = null;
    let destructive = false;

    if (strategy === 'attach') {
      remote = `tmux attach -t ${q(row.tmux)}`;
    } else if (strategy === 'reptyr') {
      remote = `reptyr -T ${Number(row.pid)}`;
    } else if (strategy === 'resume') {
      remote = `cd ${q(row.cwd)} && claude --resume ${q(row.id)}`;
    } else if (strategy === 'takeover') {
      destructive = true;
      // SIGHUP, а не -9: агент успевает закрыть транскрипт. Ожидание — до 10
      // секунд с проверкой раз в полсекунды; если процесс всё же жив, resume
      // не запускается, иначе получилось бы два процесса на одном файле.
      const pid = Number(row.pid);
      remote = [
        `kill -HUP ${pid}`,
        `for i in $(seq 20); do kill -0 ${pid} 2>/dev/null || break; sleep 0.5; done`,
        `kill -0 ${pid} 2>/dev/null && { echo "ccfzf-picker: process ${pid} is still alive" >&2; exit 1; }`,
        `cd ${q(row.cwd)} && claude --resume ${q(row.id)}`,
      ].join('; ');
    }

    if (remote === null) return null;
    const term = terminal || { file: 'open', args: [] };
    return {
      argv: [term.file, ...(term.args || []), 'ssh', '-t', String(sshHost || ''), remote],
      destructive,
    };
  }

  return { chooseOpenStrategy, buildOpenCommand };
});
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: PASS — 12 тестов в этом файле, 30 всего

- [ ] **Step 5: Свериться с результатом опыта**

Открыть `docs/reptyr-experiment.md` и убедиться, что вердикт записан. Он станет
значением `caps.reptyr` в конфиге (Task 14). Если вердикт «непригоден» —
дописать в `open-strategy.js` над `chooseOpenStrategy` строку комментария с
датой и причиной, чтобы ветка не выглядела мёртвым кодом без объяснения.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: выбор стратегии открытия и сборка команды"
```

---

### Task 8: Перенос отрисовки списка

Файлы из windows-mqtt переносятся почти дословно: они уже написаны в UMD-шиме и
уже покрыты тестами. Меняется только то, что относится к слотам и окнам.

**Files:**
- Create: `~/projects/js/ccfzf-picker/frontend-src/session-glyph.js` (копия
  `windows-mqtt/frontend-src/session-glyph.js`)
- Create: `~/projects/js/ccfzf-picker/frontend-src/session-info.js` (копия)
- Create: `~/projects/js/ccfzf-picker/frontend-src/picker-list-sync.js` (копия)
- Create: `~/projects/js/ccfzf-picker/frontend-src/picker-filter.js` (копия)
- Create: `~/projects/js/ccfzf-picker/frontend-src/session-groups.js` (из
  `windows-mqtt/src/picker/session-groups.js`, переведён в UMD-шим)
- Create: `~/projects/js/ccfzf-picker/sessions.html` (копия
  `windows-mqtt/sessions.html`)
- Create: `~/projects/js/ccfzf-picker/scripts/prepare-frontend.js`
- Test: копии `windows-mqtt/test/session-glyph.test.js`,
  `session-info.test.js`; новый `test/session-groups.test.js`

**Interfaces:**
- Consumes: `Row` из Task 6
- Produces: `groupSessions(rows, sort) -> Group[]`, `normalizeSort(mode)`,
  `cycleSort(mode)` — глобали `SessionGlyph`, `SessionInfo`, `PickerListSync`,
  `PickerFilter`, `SessionGroups` в браузере

- [ ] **Step 1: Скопировать файлы, которые переносятся без правок**

С Windows-машины (или через смонтированный `V:`), из
`D:\projects\js\windows-mqtt`:

```bash
scp frontend-src/session-glyph.js frontend-src/session-info.js \
    frontend-src/picker-list-sync.js frontend-src/picker-filter.js \
    popstas@pc-virt.popstas.pro:~/projects/js/ccfzf-picker/frontend-src/
scp test/session-glyph.test.js test/session-info.test.js \
    popstas@pc-virt.popstas.pro:~/projects/js/ccfzf-picker/test/
scp sessions.html popstas@pc-virt.popstas.pro:~/projects/js/ccfzf-picker/
```

- [ ] **Step 2: Проверить, что перенесённые тесты проходят**

Run: `cd ~/projects/js/ccfzf-picker && npm test`
Expected: PASS. Если тест ссылается на `require('../src/picker/...')` — поправить
путь на `../frontend-src/...`; других расхождений быть не должно.

- [ ] **Step 3: Написать падающий тест группировки**

`test/session-groups.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeSort, cycleSort, groupSessions } = require('../frontend-src/session-groups');

function row(extra) {
  return Object.assign({
    id: 'a', title: 'T', cwd: '/home/popstas/x', live: false,
    cost: 0, updated: 0, unread: false,
  }, extra || {});
}

test('незнакомый режим сортировки сводится к предусмотренному', () => {
  assert.strictEqual(normalizeSort('чепуха'), 'cost');
  assert.strictEqual(normalizeSort('newest'), 'newest');
});

test('перебор режимов зациклен', () => {
  const first = normalizeSort();
  let mode = first;
  for (let i = 0; i < 20; i++) mode = cycleSort(mode);
  assert.strictEqual(normalizeSort(mode), normalizeSort(mode));
});

test('живые сессии идут отдельной группой впереди', () => {
  const groups = groupSessions([
    row({ id: 'dead', live: false, updated: 200 }),
    row({ id: 'alive', live: true, updated: 100 }),
  ], 'newest');
  assert.strictEqual(groups[0].sessions[0].id, 'alive');
});

test('пустой список даёт пустой результат', () => {
  assert.deepStrictEqual(groupSessions([], 'cost'), []);
});
```

- [ ] **Step 4: Запустить и убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../frontend-src/session-groups'`

- [ ] **Step 5: Перенести session-groups в UMD-шим**

Скопировать `windows-mqtt/src/picker/session-groups.js` в
`frontend-src/session-groups.js` и внести три правки:

1. Обернуть содержимое в шим — заменить `const { prNumber } = require('./pr-url');`
   и `module.exports = {...}` на:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionGroups = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // …тело файла без изменений…
  return {
    DEFAULT_SORT, normalizeSort, cycleSort, labelSessions,
    groupSessions, sortGroupSessions, buildSessionsPayload,
  };
});
```

2. Удалить `desktopLabel()`, `chooseAction()` и `resolveDesktopSwitch()` — они
   про виртуальные столы и фокус окна, чего на маке нет. Убрать их и из
   возвращаемого объекта.

3. В `labelSessions()` заменить признак группы «открыта» с `session.open` на
   `session.live`: на маке нет окон, и «открыта» здесь означает «процесс жив».

Затем проверить, не опирается ли на `open` отрисовка:

```bash
grep -n ".open" frontend-src/*.js sessions.html
```

Каждое найденное место заменить на `.live`. Именно эта замена и даёт пометку
живой сессии в списке, обещанную в Task 11.

- [ ] **Step 6: Запустить тесты**

Run: `npm test`
Expected: PASS — 4 теста в этом файле

- [ ] **Step 7: Написать prepare-frontend**

`scripts/prepare-frontend.js`:

```js
// Tauri собирает статику из frontend/. Копирование, а не сборщик: файлы уже
// готовы к загрузке тегом <script>, и бандлер здесь ничего бы не улучшил.
const fs = require('fs');

const FILES = [
  'frontend-src/state-shape.js',
  'frontend-src/session-agent.js',
  'frontend-src/session-list.js',
  'frontend-src/session-groups.js',
  'frontend-src/session-glyph.js',
  'frontend-src/session-info.js',
  'frontend-src/picker-filter.js',
  'frontend-src/picker-list-sync.js',
  'frontend-src/open-strategy.js',
];

fs.mkdirSync('frontend', { recursive: true });
fs.copyFileSync('sessions.html', 'frontend/index.html');
for (const src of FILES) {
  fs.copyFileSync(src, 'frontend/' + src.split('/').pop());
}
console.log(`prepared ${FILES.length + 1} files`);
```

- [ ] **Step 8: Поправить sessions.html под новый набор файлов**

В `sessions.html` заменить блок тегов `<script src=…>` (в оригинале строки
234–238) на:

```html
<script src="state-shape.js"></script>
<script src="session-agent.js"></script>
<script src="session-list.js"></script>
<script src="session-groups.js"></script>
<script src="session-glyph.js"></script>
<script src="session-info.js"></script>
<script src="picker-filter.js"></script>
<script src="picker-list-sync.js"></script>
<script src="open-strategy.js"></script>
```

Удалить из разметки и скрипта всё, относящееся к снимкам раскладки
(`picker-snapshots.js` и его вызовы), к номеру монитора и виртуальному столу:
на маке этих данных нет.

- [ ] **Step 9: Проверить сборку статики**

```bash
node scripts/prepare-frontend.js && ls frontend/
```

Expected: `prepared 10 files`, в каталоге `index.html` и девять js-файлов.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: перенос отрисовки списка и группировки"
```

---

### Task 9: Скелет Tauri, окно пикера и глобальный хоткей

**Выполняется на macOS.** Дальше все задачи требуют мака: собрать Tauri для
macOS можно только там.

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `frontend/` из Task 8
- Produces: приложение с окном пикера, поднимаемым по `Cmd+Shift+T`

- [ ] **Step 1: Клонировать репозиторий на мак**

```bash
git clone popstas@pc-virt.popstas.pro:projects/js/ccfzf-picker ~/projects/ccfzf-picker
cd ~/projects/ccfzf-picker && npm test
```

Expected: PASS — все тесты из задач 2–8.

- [ ] **Step 2: Проверить, что есть чем собирать**

```bash
rustc --version && cargo --version && command -v kitty
```

Если Rust нет: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`.
Если kitty нет: `brew install --cask kitty`.

- [ ] **Step 3: Создать Cargo.toml**

`src-tauri/Cargo.toml`:

```toml
[package]
name = "ccfzf-picker"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-global-shortcut = "2"

[profile.release]
lto = true
codegen-units = 1
```

- [ ] **Step 4: Создать tauri.conf.json**

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "ccfzf-picker",
  "version": "0.1.0",
  "identifier": "pro.popstas.ccfzf-picker",
  "build": {
    "beforeBuildCommand": "node scripts/prepare-frontend.js",
    "beforeDevCommand": "node scripts/prepare-frontend.js",
    "frontendDist": "../frontend"
  },
  "app": {
    "windows": [{
      "label": "picker",
      "title": "claude sessions",
      "width": 900,
      "height": 640,
      "center": true,
      "resizable": true,
      "decorations": false,
      "alwaysOnTop": true,
      "visible": false
    }],
    "security": { "csp": null }
  },
  "bundle": { "active": true, "targets": ["app"] }
}
```

`"visible": false` — окно поднимается хоткеем, а не стартом приложения.

- [ ] **Step 5: Создать build.rs и capabilities**

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "picker window",
  "windows": ["picker"],
  "permissions": ["core:default", "shell:allow-execute"]
}
```

- [ ] **Step 6: Написать main.rs**

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
// GlobalShortcutExt — тот самый трейт, без которого `app.global_shortcut()`
// не резолвится.
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Кнопка, снятая неровно, даёт две посылки подряд, и вторая закрывала бы
/// только что открытое окно. Тот же ограничитель стоит в windows-mqtt.
const DEBOUNCE: Duration = Duration::from_millis(400);

struct LastToggle(Mutex<Option<Instant>>);

fn toggle_picker(app: &tauri::AppHandle) {
    let state = app.state::<LastToggle>();
    {
        let mut last = state.0.lock().unwrap();
        let now = Instant::now();
        if let Some(prev) = *last {
            if now.duration_since(prev) < DEBOUNCE {
                return;
            }
        }
        *last = Some(now);
    }

    let Some(window) = app.get_webview_window("picker") else { return };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_focus();
        // Список обновляется на показе: между открытиями он устаревает, а
        // опрашивать закрытый пикер незачем.
        let _ = app.emit("picker-shown", ());
    }
}

#[tauri::command]
fn hide_picker(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("picker") {
        let _ = window.hide();
    }
}

fn main() {
    let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyT);

    tauri::Builder::default()
        .manage(LastToggle(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_picker(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![hide_picker])
        .setup(move |app| {
            app.global_shortcut().register(shortcut)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running ccfzf-picker");
}
```

- [ ] **Step 7: Собрать и запустить**

```bash
cd src-tauri && cargo build && cd .. && npm run tauri dev
```

Если команды `tauri` нет — `cargo install tauri-cli --version '^2'` и запускать
`cargo tauri dev` из `src-tauri`.

Expected: приложение запускается, окна не видно.

- [ ] **Step 8: Проверить хоткей**

Нажать `Cmd+Shift+T`. macOS спросит разрешение на мониторинг ввода — выдать в
System Settings → Privacy & Security → Accessibility.

Expected: окно появляется по нажатию, исчезает по повторному; двойное быстрое
нажатие не мигает окном.

- [ ] **Step 9: Добавить закрытие по Esc**

В `sessions.html`, в блоке `<script>`, добавить:

```js
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window.__TAURI__.core.invoke('hide_picker');
});
```

Пересобрать (`npm run tauri dev`), нажать Esc в открытом окне.

Expected: окно скрывается.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: скелет Tauri, окно пикера и глобальный хоткей"
git push
```

---

### Task 10: Транспорт до pc-virt

**Files:**
- Create: `src-tauri/src/state_source.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `~/.ssh/config` (правка секции хоста)

**Interfaces:**
- Consumes: `ccfzf --state` (Task 4)
- Produces: команда Tauri `fetch_state() -> Result<serde_json::Value, String>`,
  вызываемая из фронтенда через `window.__TAURI__.core.invoke('fetch_state')`

- [ ] **Step 1: Настроить переиспользуемое ssh-соединение**

В `~/.ssh/config` на маке:

```
Host pc-virt
  HostName pc-virt.popstas.pro
  User popstas
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 5m
  ServerAliveInterval 15
```

- [ ] **Step 2: Замерить, сколько стоит вызов**

```bash
ssh pc-virt ccfzf --state > /dev/null   # первый: поднимает канал
time ssh pc-virt ccfzf --state > /tmp/state.json
node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/state.json')).sessions.length)"
```

Expected: второй вызов заметно быстрее первого, число сессий ненулевое. Если
второй не быстрее — `ControlPath` не подхватился, проверить права на `~/.ssh`.

- [ ] **Step 3: Написать модуль транспорта**

`src-tauri/src/state_source.rs`:

```rust
use std::process::Command;

/// Один вызов агрегатора на pc-virt.
///
/// Ответ не разбирается и не чинится: форму проверяет фронтенд той же
/// функцией, что и тесты. Здесь важно только отличить «не смогли спросить» от
/// «спросили, ответили не тем».
pub fn fetch(ssh_host: &str) -> Result<serde_json::Value, String> {
    let out = Command::new("ssh")
        .arg(ssh_host)
        .arg("ccfzf --state")
        .output()
        .map_err(|e| format!("ssh failed to start: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("ssh exited with {}: {}", out.status, err.trim()));
    }

    serde_json::from_slice(&out.stdout).map_err(|e| format!("bad json from ccfzf --state: {e}"))
}
```

- [ ] **Step 4: Подключить модуль и команду**

В `src-tauri/src/main.rs`:

1. После строк `use tauri::…` добавить:

```rust
mod state_source;
```

2. Перед `fn main()` добавить:

```rust
#[tauri::command]
fn fetch_state() -> Result<serde_json::Value, String> {
    // Хост зашит до Task 14, где появляется конфиг.
    state_source::fetch("pc-virt")
}
```

3. В `invoke_handler` заменить строку на:

```rust
        .invoke_handler(tauri::generate_handler![hide_picker, fetch_state])
```

- [ ] **Step 5: Проверить вызов из окна**

Пересобрать, открыть пикер, в консоли webview (правая кнопка → Inspect Element)
выполнить:

```js
await window.__TAURI__.core.invoke('fetch_state').then(r => r.sessions.length)
```

Expected: число, совпадающее со Step 2.

- [ ] **Step 6: Проверить, что ошибка доезжает читаемой**

Временно заменить `"pc-virt"` на `"pc-virt-нет-такого"`, пересобрать, повторить
вызов.

Expected: отказ с текстом `ssh exited with …`, а не молчаливый `null`. Вернуть
хост обратно.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: транспорт до pc-virt через ssh"
```

---

### Task 11: Отрисовка списка в окне

**Files:**
- Modify: `sessions.html` (блок `<script>`)

**Interfaces:**
- Consumes: `fetch_state` (Task 10), `buildSessionList` (Task 6),
  `groupSessions` (Task 8), `syncList` из `picker-list-sync.js`
- Produces: событие окна `sessions-updated` с массивом строк — на него
  подписывается Task 12

- [ ] **Step 1: Заменить источник данных в скрипте окна**

В `sessions.html`, в блоке `<script>`, найти место, где список получал данные из
windows-mqtt (вызовы к MQTT/websocket), и заменить на:

```js
// Прочитанное живёт на этой машине: трекера окон здесь нет, отметку ставит
// само открытие сессии. Чтение из файла добавляется в Task 12; пока пусто —
// список от этого только показывает всё непрочитанным.
let seen = {};
let rows = [];

async function refresh() {
  let state;
  try {
    state = await window.__TAURI__.core.invoke('fetch_state');
  } catch (e) {
    document.getElementById('statusline').textContent = String(e);
    return;
  }
  const problems = StateShape.validateState(state);
  if (problems.length) {
    document.getElementById('statusline').textContent = problems[0];
    return;
  }
  rows = SessionList.buildSessionList({ sessions: state.sessions, seen });
  const groups = SessionGroups.groupSessions(rows, SessionGroups.normalizeSort(sort));
  syncList(groups);
  window.dispatchEvent(new CustomEvent('sessions-updated', { detail: rows }));
}
```

- [ ] **Step 2: Завести опрос только на время показа**

Там же:

```js
// Опрос идёт, только пока окно на экране: закрытый пикер спрашивать незачем,
// а каждый вызов — это ssh на другую машину.
let timer = null;

function startPolling() {
  refresh();
  if (timer === null) timer = setInterval(refresh, 1000);
}

function stopPolling() {
  if (timer !== null) { clearInterval(timer); timer = null; }
}

window.__TAURI__.event.listen('picker-shown', startPolling);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling(); else startPolling();
});
```

- [ ] **Step 3: Убедиться, что список не мигает на открытии**

Проверить, что `syncList()` вызывается вместо присваивания `list.innerHTML`, и
что при открытии окна старые строки не стираются до прихода первого ответа —
`refresh()` только заменяет строки, но не чистит контейнер.

- [ ] **Step 4: Собрать и посмотреть**

```bash
npm run tauri dev
```

Открыть пикер по `Cmd+Shift+T`.

Expected: список сессий с заголовками, возрастом, сводками; живые сессии
помечены; строки обновляются раз в секунду без мигания и без прыжков скролла.

- [ ] **Step 5: Проверить, что опрос прекращается**

Закрыть пикер по Esc, на pc-virt посмотреть:

```bash
ssh pc-virt 'ps -eo etimes,args | grep "ccfzf --state" | grep -v grep'
```

Expected: пусто — при закрытом пикере агрегатор не запускается.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: отрисовка списка сессий в окне пикера"
```

---

### Task 12: Открытие сессии в kitty и отметка прочитанного

**Files:**
- Modify: `src-tauri/src/main.rs`
- Modify: `sessions.html`

**Interfaces:**
- Consumes: `chooseOpenStrategy`, `buildOpenCommand` (Task 7), `rows` (Task 11)
- Produces: команды Tauri `spawn_detached(argv: Vec<String>) -> Result<(), String>`,
  `load_seen() -> Result<serde_json::Value, String>`,
  `save_seen(seen: serde_json::Value) -> Result<(), String>`

- [ ] **Step 1: Добавить запуск процесса в Rust**

В `src-tauri/src/main.rs`, перед `fn main()`:

```rust
/// Запуск терминала. Открепляется сразу: пикер не ждёт, пока человек
/// закончит работать в сессии, и не держит его вывод.
#[tauri::command]
fn spawn_detached(argv: Vec<String>) -> Result<(), String> {
    let Some((file, args)) = argv.split_first() else {
        return Err("empty argv".into());
    };
    std::process::Command::new(file)
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("failed to spawn {file}: {e}"))
}
```

И в `invoke_handler`:

```rust
        .invoke_handler(tauri::generate_handler![hide_picker, fetch_state, spawn_detached])
```

- [ ] **Step 2: Хранить отметки просмотра в файле**

Рядом с конфигом, а не в localStorage: файл виден и правится руками, а
webview-хранилище живёт внутри бандла и теряется при переустановке.

В `src-tauri/src/main.rs`, перед `fn main()`:

```rust
fn seen_path() -> Result<std::path::PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("HOME is not set")?;
    Ok(std::path::Path::new(&home).join(".config/ccfzf-picker/seen.json"))
}

/// Отметки «эту сессию человек уже видел», id -> epoch-секунды.
/// Отсутствующий файл — это пустая карта, а не отказ: до первого открытия
/// сессии его и не должно быть.
#[tauri::command]
fn load_seen() -> Result<serde_json::Value, String> {
    let path = seen_path()?;
    match std::fs::read_to_string(&path) {
        Ok(t) => serde_json::from_str(&t).map_err(|e| format!("bad json in {}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(serde_json::json!({})),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}

/// Запись через временный файл и переименование: читатель никогда не видит
/// половину карты.
#[tauri::command]
fn save_seen(seen: serde_json::Value) -> Result<(), String> {
    let path = seen_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string(&seen).map_err(|e| format!("cannot serialize seen: {e}"))?;
    std::fs::write(&tmp, text).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("cannot rename onto {}: {e}", path.display()))
}
```

И в `invoke_handler`:

```rust
        .invoke_handler(tauri::generate_handler![
            hide_picker, fetch_state, spawn_detached, load_seen, save_seen
        ])
```

- [ ] **Step 3: Привязать открытие к выбору строки**

В `sessions.html`, в блоке `<script>` заменить заглушку `let seen = {};` из
Task 11 на чтение файла и добавить открытие:

```js
let seen = {};
window.__TAURI__.core.invoke('load_seen')
  .then(v => { seen = v || {}; })
  .catch(e => { document.getElementById('statusline').textContent = String(e); });

const OPEN_OPTS = {
  sshHost: 'pc-virt',
  terminal: { file: 'open', args: ['-na', 'kitty', '--args'] },
};
// Заполняется из конфига в Task 14; до тех пор берётся вердикт опыта.
const CAPS = { reptyr: false };

function markSeen(id, at) {
  seen[id] = at;
  return window.__TAURI__.core.invoke('save_seen', { seen });
}

async function openSession(row) {
  const strategy = OpenStrategy.chooseOpenStrategy(row, CAPS);
  const cmd = OpenStrategy.buildOpenCommand(row, strategy, OPEN_OPTS);
  if (!cmd) return;
  if (cmd.destructive) {
    const ok = confirm(
      `Перехватить сессию «${row.title}»?\n\n`
      + `Процесс ${row.pid} на pc-virt получит SIGHUP и завершится, окно на Windows закроется.\n`
      + `Фоновые задачи, запущенные в её шелле, умрут вместе с ней.`,
    );
    if (!ok) return;
  }
  await window.__TAURI__.core.invoke('spawn_detached', { argv: cmd.argv });
  // Отметка «посмотрел» ставится здесь: другого повода на маке нет.
  await markSeen(row.id, Math.floor(Date.now() / 1000));
  window.__TAURI__.core.invoke('hide_picker');
}
```

Привязать `openSession` к Enter и к клику по строке — там, где в оригинале
`sessions.html` вызывал фокус окна через `claude-focus`.

- [ ] **Step 4: Проверить открытие мёртвой сессии**

Открыть пикер, выбрать сессию без пометки «живая», нажать Enter.

Expected: открывается окно kitty, в нём ssh на pc-virt и продолженная сессия
claude; пикер закрылся; кружок непрочитанного у этой строки погас при следующем
открытии пикера.

- [ ] **Step 5: Проверить, что перехват спрашивает**

Выбрать живую сессию (при `CAPS.reptyr === false`), нажать Enter.

Expected: диалог с pid и предупреждением. Отказ — ничего не происходит, сессия
жива:

```bash
ssh pc-virt 'ps -p <pid> -o pid,args'
```

- [ ] **Step 6: Проверить перехват до конца**

Согласиться в диалоге на сессии, которую не жалко.

Expected: окно kitty открылось, старый процесс ушёл (`ps -p <pid>` пуст),
сессия продолжается в новом окне, окно WT на Windows закрылось само.

- [ ] **Step 7: Проверить путь с кавычкой в имени**

Создать каталог с апострофом и запустить в нём сессию:

```bash
ssh pc-virt "mkdir -p \"/home/popstas/tmp/it's\" && cd \"/home/popstas/tmp/it's\" && ls"
```

После появления сессии в списке открыть её из пикера.

Expected: kitty открывается в нужном каталоге, команда не разваливается.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: открытие сессии в kitty и отметка прочитанного"
```

---

### Task 13: Меню действий

**Files:**
- Modify: `sessions.html`
- Create: `~/projects/ccfzf-picker/frontend-src/session-actions.js`
- Test: `~/projects/ccfzf-picker/test/session-actions.test.js`

**Interfaces:**
- Consumes: `Row` (Task 6)
- Produces: `availableActions(row) -> [{ id, label }]` с идентификаторами
  `pr`, `unread`, `info`

- [ ] **Step 1: Написать падающий тест**

`test/session-actions.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { availableActions } = require('../frontend-src/session-actions');

test('информация о сессии есть всегда', () => {
  const ids = availableActions({ id: 'a' }).map(a => a.id);
  assert.deepStrictEqual(ids, ['info']);
});

test('PR предлагается, когда ссылка разбирается в номер', () => {
  const actions = availableActions({ id: 'a', prUrl: 'https://github.com/o/r/pull/42' });
  const pr = actions.find(a => a.id === 'pr');
  assert.strictEqual(pr.label, 'Open PR #42');
});

test('мусор вместо ссылки на PR пункта не даёт', () => {
  const ids = availableActions({ id: 'a', prUrl: 'не ссылка' }).map(a => a.id);
  assert.ok(!ids.includes('pr'));
});

test('вернуть в непрочитанное можно только то, что читали', () => {
  assert.ok(availableActions({ id: 'a', unread: false, updated: 5 }).some(x => x.id === 'unread'));
  assert.ok(!availableActions({ id: 'a', unread: true, updated: 5 }).some(x => x.id === 'unread'));
  assert.ok(!availableActions({ id: 'a', unread: false, updated: 0 }).some(x => x.id === 'unread'));
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../frontend-src/session-actions'`

- [ ] **Step 3: Реализовать**

`frontend-src/session-actions.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SessionActions = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Форма ссылки проверяется до того, как она попадёт в аргумент командной
  // строки: owner/repo без спецсимволов и номер.
  const PR_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)(?:[/?#].*)?$/;

  function prNumber(url) {
    const m = PR_RE.exec(String(url || ''));
    return m ? m[1] : '';
  }

  /**
   * Что пикер может предложить для этой строки.
   *
   * Информация есть всегда: она рисуется из той же строки и ничего не
   * запрашивает. Возврат в непрочитанное бессмыслен и без записи агента, и у
   * строки, которая и так непрочитана.
   */
  function availableActions(row) {
    const actions = [];
    const num = prNumber((row || {}).prUrl);
    if (num) actions.push({ id: 'pr', label: `Open PR #${num}` });
    if (row && row.updated && !row.unread) actions.push({ id: 'unread', label: 'Mark unread' });
    actions.push({ id: 'info', label: 'Session info' });
    return actions;
  }

  return { prNumber, availableActions };
});
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: PASS — 4 теста в этом файле

- [ ] **Step 5: Подключить меню в окне**

В `sessions.html` добавить `session-actions.js` в список тегов `<script>` и в
`scripts/prepare-frontend.js` в массив `FILES`. Привязать Ctrl+K к показу меню
из `availableActions(row)` и обработку выбора:

```js
function runAction(row, id) {
  if (id === 'pr') {
    window.__TAURI__.core.invoke('spawn_detached', { argv: ['open', row.prUrl] });
  } else if (id === 'unread') {
    // Отматывается на секунду раньше записи агента: ровно настолько, чтобы
    // seenSinceUpdate снова сказал «не видел».
    markSeen(row.id, row.updated - 1).then(refresh);
    return;
  } else if (id === 'info') {
    // Имя функции показа карточки — то, что экспортирует перенесённый
    // frontend-src/session-info.js; свериться с его возвращаемым объектом.
    showSessionInfo(row);
    return;
  }
  window.__TAURI__.core.invoke('hide_picker');
}
```

- [ ] **Step 6: Проверить в приложении**

Пересобрать. На строке с PR нажать Ctrl+K.

Expected: в меню три пункта; выбор PR открывает браузер; Mark unread возвращает
кружок непрочитанного; Session info показывает карточку.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: меню действий — PR, непрочитанное, информация"
```

---

### Task 14: Конфиг и проектные хоткеи

**Files:**
- Create: `~/projects/ccfzf-picker/frontend-src/config-shape.js`
- Test: `~/projects/ccfzf-picker/test/config-shape.test.js`
- Modify: `src-tauri/src/main.rs`
- Create: `~/.config/ccfzf-picker/config.yaml`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: команда Tauri `load_config() -> Result<serde_json::Value, String>`;
  `normalizeConfig(raw) -> Config` с полями `sshHost`, `terminal`, `caps`,
  `hotkey`, `projects`

- [ ] **Step 1: Написать падающий тест**

`test/config-shape.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeConfig } = require('../frontend-src/config-shape');

test('пустой конфиг даёт рабочие значения по умолчанию', () => {
  const c = normalizeConfig(null);
  assert.strictEqual(c.sshHost, 'pc-virt');
  assert.strictEqual(c.hotkey, 'Cmd+Shift+T');
  assert.strictEqual(c.caps.reptyr, false);
  assert.deepStrictEqual(c.terminal, { file: 'open', args: ['-na', 'kitty', '--args'] });
  assert.deepStrictEqual(c.projects, []);
});

test('заданные значения перекрывают умолчания', () => {
  const c = normalizeConfig({ sshHost: 'other', caps: { reptyr: true } });
  assert.strictEqual(c.sshHost, 'other');
  assert.strictEqual(c.caps.reptyr, true);
});

test('проект без пути отбрасывается, а не роняет конфиг', () => {
  const c = normalizeConfig({ projects: [
    { path: '/home/popstas/x', hotkey: 'Cmd+Shift+1' },
    { hotkey: 'Cmd+Shift+2' },
    'мусор',
  ] });
  assert.deepStrictEqual(c.projects, [{ path: '/home/popstas/x', hotkey: 'Cmd+Shift+1' }]);
});

test('проект без хоткея остаётся в списке', () => {
  const c = normalizeConfig({ projects: [{ path: '/home/popstas/y' }] });
  assert.deepStrictEqual(c.projects, [{ path: '/home/popstas/y', hotkey: '' }]);
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../frontend-src/config-shape'`

- [ ] **Step 3: Реализовать**

`frontend-src/config-shape.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ConfigShape = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULTS = {
    sshHost: 'pc-virt',
    hotkey: 'Cmd+Shift+T',
    terminal: { file: 'open', args: ['-na', 'kitty', '--args'] },
    caps: { reptyr: false },
  };

  /**
   * Конфиг с проставленными умолчаниями.
   *
   * Правило одно: испорченная запись выбрасывается, а не роняет весь файл.
   * Пикер без одного проектного хоткея работает; пикер, который не открылся
   * из-за опечатки в yaml, — нет.
   */
  function normalizeConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const projects = (Array.isArray(src.projects) ? src.projects : [])
      .filter(p => p && typeof p === 'object' && typeof p.path === 'string' && p.path)
      .map(p => ({ path: p.path, hotkey: typeof p.hotkey === 'string' ? p.hotkey : '' }));

    return {
      sshHost: typeof src.sshHost === 'string' && src.sshHost ? src.sshHost : DEFAULTS.sshHost,
      hotkey: typeof src.hotkey === 'string' && src.hotkey ? src.hotkey : DEFAULTS.hotkey,
      terminal: src.terminal && typeof src.terminal === 'object' && src.terminal.file
        ? { file: src.terminal.file, args: Array.isArray(src.terminal.args) ? src.terminal.args : [] }
        : DEFAULTS.terminal,
      caps: { reptyr: Boolean((src.caps || {}).reptyr) },
      projects,
    };
  }

  return { DEFAULTS, normalizeConfig };
});
```

- [ ] **Step 4: Запустить тесты**

Run: `npm test`
Expected: PASS — 4 теста в этом файле

- [ ] **Step 5: Читать конфиг в Rust**

В `src-tauri/src/main.rs`, перед `fn main()`:

```rust
/// Конфиг читается сырым и разбирается во фронтенде той же функцией, что и
/// тесты. Отсутствующий файл — не ошибка: умолчания рассчитаны на работу без
/// него.
#[tauri::command]
fn load_config() -> Result<serde_json::Value, String> {
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(serde_json::Value::Null);
    };
    let path = std::path::Path::new(&home).join(".config/ccfzf-picker/config.yaml");
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(serde_json::Value::Null),
        Err(e) => return Err(format!("cannot read {}: {e}", path.display())),
    };
    serde_yaml::from_str(&text).map_err(|e| format!("bad yaml in {}: {e}", path.display()))
}
```

И в `invoke_handler`:

```rust
        .invoke_handler(tauri::generate_handler![
            hide_picker, fetch_state, spawn_detached, load_config
        ])
```

- [ ] **Step 6: Регистрировать проектные хоткеи**

В `main.rs`, в `setup`, после регистрации основного хоткея — прочитать конфиг и
зарегистрировать по хоткею на проект, отправляя во фронтенд событие с путём:

```rust
            // Проектный хоткей открывает новую сессию мимо списка, поэтому
            // окно пикера не поднимается: наружу уходит только событие.
            if let Ok(cfg) = load_config() {
                let projects = cfg.get("projects").and_then(|p| p.as_array()).cloned().unwrap_or_default();
                for item in projects {
                    let (Some(path), Some(hotkey)) = (
                        item.get("path").and_then(|v| v.as_str()),
                        item.get("hotkey").and_then(|v| v.as_str()),
                    ) else { continue };
                    if hotkey.is_empty() { continue }
                    let Ok(sc) = hotkey.parse::<Shortcut>() else {
                        eprintln!("ccfzf-picker: cannot parse hotkey {hotkey}");
                        continue;
                    };
                    let handle = app.handle().clone();
                    let path = path.to_string();
                    app.global_shortcut().on_shortcut(sc, move |_app, _sc, event| {
                        if event.state() == ShortcutState::Pressed {
                            let _ = handle.emit("project-hotkey", path.clone());
                        }
                    })?;
                }
            }
```

- [ ] **Step 7: Обработать событие во фронтенде**

В `sessions.html`:

```js
window.__TAURI__.event.listen('project-hotkey', e => {
  const path = e.payload;
  // Новая сессия, а не resume: у проектного хоткея нет сессии, которую
  // продолжать.
  const argv = [
    CONFIG.terminal.file, ...CONFIG.terminal.args,
    'ssh', '-t', CONFIG.sshHost,
    `cd '${String(path).replace(/'/g, "'\\''")}' && claude`,
  ];
  window.__TAURI__.core.invoke('spawn_detached', { argv });
});
```

И заменить зашитые `OPEN_OPTS` / `CAPS` из Task 12 на значения из конфига:

```js
let CONFIG = ConfigShape.normalizeConfig(null);
window.__TAURI__.core.invoke('load_config')
  .then(raw => { CONFIG = ConfigShape.normalizeConfig(raw); })
  .catch(e => { document.getElementById('statusline').textContent = String(e); });
```

Заменить использования `OPEN_OPTS` на `{ sshHost: CONFIG.sshHost, terminal: CONFIG.terminal }`
и `CAPS` на `CONFIG.caps`. Добавить `config-shape.js` в теги `<script>` и в
`scripts/prepare-frontend.js`.

- [ ] **Step 8: Написать конфиг**

`~/.config/ccfzf-picker/config.yaml`:

```yaml
sshHost: pc-virt
hotkey: Cmd+Shift+T
caps:
  # Значение — вердикт из docs/reptyr-experiment.md
  reptyr: false
terminal:
  file: open
  args: ['-na', 'kitty', '--args']
projects:
  - path: /home/popstas/projects/js/windows-mqtt
    hotkey: Cmd+Shift+1
  - path: /home/popstas/projects/js/windows11-manager
    hotkey: Cmd+Shift+2
```

- [ ] **Step 9: Проверить**

Пересобрать. Нажать `Cmd+Shift+1`.

Expected: открывается kitty с новой сессией claude в
`/home/popstas/projects/js/windows-mqtt`; окно пикера при этом не появляется.

Затем убрать файл конфига и запустить снова.

Expected: приложение работает на умолчаниях, `Cmd+Shift+T` открывает список.

- [ ] **Step 10: Прогнать всё и закоммитить**

```bash
npm test && git add -A && git commit -m "feat: конфиг и проектные хоткеи" && git push
```

Expected: PASS — все тесты задач 2–14.

---

## Проверка целиком

- [ ] `npm test` на маке — все тесты проходят
- [ ] `ssh pc-virt ccfzf --state | node scripts/check-state.js` — `ok: N sessions`
- [ ] `ssh pc-virt ccfzf --dump` и пикер на Windows работают как прежде
- [ ] `Cmd+Shift+T` открывает список, Esc закрывает, опрос при закрытом окне не идёт
- [ ] Мёртвая сессия открывается в kitty и продолжается
- [ ] Живая сессия требует подтверждения и после него переходит на мак
- [ ] Кружок непрочитанного гаснет после открытия и возвращается через Mark unread
- [ ] Проектный хоткей открывает новую сессию мимо списка
- [ ] `~/.config/ccfzf-picker/seen.json` появился и переживает перезапуск приложения
