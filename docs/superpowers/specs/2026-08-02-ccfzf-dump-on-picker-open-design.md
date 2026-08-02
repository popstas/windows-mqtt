# ccfzf dump on picker open

## Problem

Дамп `~/.ccfzf.sessions.json` (с Windows — `V:/.ccfzf.sessions.json`) обновляется только при запуске ccfzf. Новая или переименованная сессия может минутами не попадать в индекс, пока кто-то не откроет ccfzf. Пикер windows-mqtt при открытии только читает уже лежащий файл.

## Solution

1. **ccfzf** — флаг `--dump`: синхронно пишет sessions/projects dump и выходит.
2. **windows-mqtt** — при `windows/claude-sessions-start` fire-and-forget `ssh <host> ccfzf --dump`. Пикер не ждёт. Когда файл обновится, `loadSessionIndex` и late-bind демона подхватывают сами.

## Details

- Хост: `sessionOpen.sshHost` (default `popstas@pc-virt.popstas.pro`).
- SSH без `wt.exe` — без окна терминала.
- Ошибки SSH только в лог.
- Существующий `dump_state` в интерактивном ccfzf остаётся фоновым (`&`); `--dump` — foreground, чтобы remote-вызов завершался после записи.
