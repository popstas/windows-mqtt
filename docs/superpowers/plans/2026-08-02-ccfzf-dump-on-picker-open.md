# ccfzf dump on picker open — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On every sessions-picker open, refresh `V:/.ccfzf.sessions.json` via `ssh … ccfzf --dump`.

**Architecture:** Add a sync `--dump` mode to ccfzf. From windows-mqtt `startSessionsFeed()`, spawn a non-interactive SSH dump once (fire-and-forget). Existing mtime/cache + daemon late-bind pick up the new file.

**Tech Stack:** bash (ccfzf), Node.js + child_process (windows-mqtt)

## Global Constraints

- Do not block the picker on SSH.
- No `wt.exe` for the dump call.
- SSH host from `sessionOpen.sshHost` / default.

---

## File map

| File | Role |
|---|---|
| `V:/projects/shell/ccfzf/ccfzf` | `--dump` flag, sync dump, exit |
| `windows-mqtt/src/picker/session-open-helpers.js` | pure `buildDumpRefreshCommand` |
| `windows-mqtt/test/session-open-helpers.test.js` | tests for that helper |
| `windows-mqtt/src/modules/windows.js` | call refresh from `startSessionsFeed` |

---

### Task 1: `ccfzf --dump`

- [ ] Add `--dump` to the arg parser (mutually exclusive with `--print`/`--kiosk`/`--session` is fine to ignore — just dump and exit).
- [ ] After deps check / before interactive setup, if dump-only: run python dump **synchronously** (no `&`), exit 0.
- [ ] Document in usage header / README one line.
- [ ] Verify: `ssh popstas@pc-virt.popstas.pro ccfzf --dump` updates `V:/.ccfzf.sessions.json` mtime.

### Task 2: windows-mqtt refresh helper (TDD)

- [ ] Failing test: `buildDumpRefreshCommand({ sshHost })` → `{ file: 'ssh', args: [host, 'ccfzf --dump'] }`, default host from DEFAULTS.
- [ ] Implement helper in `session-open-helpers.js`, export it.
- [ ] Tests pass.

### Task 3: Wire into `startSessionsFeed`

- [ ] On start: spawn dump command once (detached/stdio ignore), log errors, then existing `sendSessions` + interval.
- [ ] Do not await dump before first paint.
