const { test } = require('node:test');
const assert = require('node:assert');
const {
  labelSessions, groupSessions, buildSessionsPayload, chooseAction, resolveDesktopSwitch,
  cycleSort, normalizeSort, DEFAULT_SORT, SORT_MODES,
} = require('../src/picker/session-groups');

const s = (over) => ({
  id: 'x', title: 't', cwd: '/p', bounds: { x: 0, y: 0, width: 10, height: 10 },
  desktop: 1, monitor: 1, monitorBounds: null, open: true, windowId: 1,
  agentCostUsd: 0, agentStarted: 0, lastActivity: null, ...over,
});

test('labelSessions leaves a unique name alone', () => {
  const out = labelSessions([s({ id: 'aaaa1111', title: 'ccfzf' })]);
  assert.strictEqual(out[0].label, 'ccfzf');
});

// Двойников — переоткрытую сессию или пару «живая и протухшая» — раньше
// различал хвост из четырёх знаков id прямо в имени. Теперь это делает колонка
// короткого id со своим чекбоксом, а имя остаётся именем: тот же хвост тянулся
// в заголовки диалогов и в текст слота на панели, где он не нужен вовсе.
test('labelSessions leaves duplicates to the id column', () => {
  const out = labelSessions([
    s({ id: 'aaaa1111', title: 'agent', cwd: '/p/agent' }),
    s({ id: 'bbbb2222', title: 'agent', cwd: '/p/agent' }),
  ]);
  assert.strictEqual(out[0].label, 'agent');
  assert.strictEqual(out[1].label, 'agent');
});

test('labelSessions leaves same name in different projects alone', () => {
  const out = labelSessions([
    s({ id: 'a', title: 'agent', cwd: '/one' }),
    s({ id: 'b', title: 'agent', cwd: '/two' }),
  ]);
  assert.strictEqual(out[0].label, 'agent');
  assert.strictEqual(out[1].label, 'agent');
});

test('normalizeSort falls back to cost', () => {
  assert.strictEqual(normalizeSort('nope'), DEFAULT_SORT);
  assert.strictEqual(normalizeSort('recent'), 'recent');
});

test('cycleSort walks cost → oldest → newest → recent → name → cost', () => {
  assert.deepStrictEqual(
    SORT_MODES.reduce((acc, _) => [...acc, cycleSort(acc[acc.length - 1])], ['cost']),
    ['cost', 'oldest', 'newest', 'recent', 'name', 'cost'],
  );
});

test('groupSessions sorts by cost desc by default', () => {
  const [group] = groupSessions([
    s({ id: 'cheap', agentCostUsd: 1 }),
    s({ id: 'pricey', agentCostUsd: 40 }),
    s({ id: 'mid', agentCostUsd: 12 }),
  ]);
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['pricey', 'mid', 'cheap']);
});

test('groupSessions oldest puts earliest started first', () => {
  const [group] = groupSessions([
    s({ id: 'new', agentStarted: 300 }),
    s({ id: 'old', agentStarted: 100 }),
    s({ id: 'mid', agentStarted: 200 }),
  ], 'oldest');
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['old', 'mid', 'new']);
});

test('groupSessions newest puts latest started first', () => {
  const [group] = groupSessions([
    s({ id: 'old', agentStarted: 100 }),
    s({ id: 'new', agentStarted: 300 }),
  ], 'newest');
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['new', 'old']);
});

test('groupSessions recent sorts by lastActivity desc', () => {
  const [group] = groupSessions([
    s({ id: 'stale', lastActivity: 10 }),
    s({ id: 'fresh', lastActivity: 90 }),
  ], 'recent');
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['fresh', 'stale']);
});

test('groupSessions name sorts by label ascending', () => {
  const [group] = groupSessions([
    s({ id: 'b', title: 'zeta' }),
    s({ id: 'a', title: 'alpha' }),
  ], 'name');
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['a', 'b']);
});

test('groupSessions sinks sessions with no sort key to the end', () => {
  const [group] = groupSessions([
    s({ id: 'known', agentCostUsd: 5 }),
    s({ id: 'blank', agentCostUsd: 0 }),
  ], 'cost');
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['known', 'blank']);
});

test('groupSessions puts every live session in one group above the closed ones', () => {
  const groups = groupSessions([
    s({ id: 'closed1', open: false, desktop: 2 }),
    s({ id: 'live2', open: true, desktop: 2, title: 'b' }),
    s({ id: 'closed2', open: false, desktop: 1 }),
    s({ id: 'live1', open: true, desktop: 1, title: 'a' }),
  ], 'name');
  assert.deepStrictEqual(groups.map(g => g.label), ['Active sessions - 2', 'Desktop 1', 'Desktop 2']);
  // Live sessions are not split by desktop: 'live1' and 'live2' sit on
  // different desktops and still share the top group.
  assert.deepStrictEqual(groups[0].sessions.map(x => x.id), ['live1', 'live2']);
  assert.deepStrictEqual(groups[1].sessions.map(x => x.id), ['closed2']);
  assert.deepStrictEqual(groups[2].sessions.map(x => x.id), ['closed1']);
});

test('groupSessions omits the active group entirely when nothing is open', () => {
  const groups = groupSessions([s({ id: 'a', open: false, desktop: 1 })]);
  assert.deepStrictEqual(groups.map(g => g.label), ['Desktop 1']);
});

test('groupSessions omits the desktop groups when everything is open', () => {
  const groups = groupSessions([s({ id: 'a', open: true, desktop: 1 })]);
  assert.deepStrictEqual(groups.map(g => g.label), ['Active sessions - 1']);
});

test('groupSessions ignores the monitor when splitting closed sessions', () => {
  // Monitors get switched far more often than slots live, so a monitor number
  // on a closed session says little — and splitting by it scattered the past
  // across twice as many groups.
  const groups = groupSessions([
    s({ id: 'a', open: false, desktop: 1, monitor: 1 }),
    s({ id: 'b', open: false, desktop: 1, monitor: 2 }),
  ]);
  assert.deepStrictEqual(groups.map(g => g.label), ['Desktop 1']);
  assert.strictEqual(groups[0].sessions.length, 2);
});

test('groupSessions puts an unknown desktop before the real ones', () => {
  const groups = groupSessions([
    s({ id: 'a', open: false, desktop: 1 }),
    s({ id: 'c', open: false, desktop: null }),
  ]);
  assert.deepStrictEqual(groups.map(g => g.label), ['Desktop —', 'Desktop 1']);
});

test('groupSessions tolerates a session with no bounds', () => {
  const [group] = groupSessions([s({ id: 'a', bounds: null })]);
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['a']);
});

test('groupSessions returns an empty list for an empty input', () => {
  const groups = groupSessions([]);
  assert.deepStrictEqual(groups, []);
});

test('buildSessionsPayload labels and groups sessions on the ok path', () => {
  const sessions = [
    s({ id: 'aaaa1111', title: 'agent', cwd: '/p/agent', desktop: 2, monitor: 1, open: false }),
    s({ id: 'bbbb2222', title: 'agent', cwd: '/p/agent', desktop: 1, monitor: 1, open: false }),
  ];
  const payload = buildSessionsPayload({ ok: true, sessions });

  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.sort, 'cost');
  // groupSessions ran: two closed sessions on different desktops became two
  // groups, sorted ascending (2 before 1 in the input, 1 before 2 in output).
  assert.deepStrictEqual(payload.groups.map(g => g.label), ['Desktop 1', 'Desktop 2']);
  // labelSessions ran: у каждой строки есть label, а не только заголовок окна.
  assert.strictEqual(payload.groups[0].sessions[0].label, 'agent');
  assert.strictEqual(payload.groups[1].sessions[0].label, 'agent');
});

test('buildSessionsPayload carries the chosen sort mode', () => {
  const payload = buildSessionsPayload({ ok: true, sessions: [] }, 'name');
  assert.strictEqual(payload.sort, 'name');
});

test('buildSessionsPayload carries the reason through unchanged on the failure path', () => {
  const payload = buildSessionsPayload({ ok: false, reason: 'claudeWt.enabled is false in config' });
  assert.deepStrictEqual(payload, { ok: false, reason: 'claudeWt.enabled is false in config' });
});

test('chooseAction focuses a session that is open', () => {
  assert.strictEqual(chooseAction({ open: true, windowId: 5 }, () => true), 'focus');
});

test('chooseAction restores a session that is closed', () => {
  assert.strictEqual(chooseAction({ open: false, windowId: null }, () => true), 'restore');
});

test('chooseAction restores when the handle died since the list was drawn', () => {
  assert.strictEqual(chooseAction({ open: true, windowId: 5 }, () => false), 'restore');
});

test('chooseAction restores a closed session even when isAlive would say no', () => {
  // Completes the 2x2 matrix: open=false, isAlive=false. Same outcome as the
  // open=false/isAlive=true case, but only a distinct isAlive call proves the
  // 'open' check, not the liveness check, is what drove the 'restore' result.
  assert.strictEqual(chooseAction({ open: false, windowId: null }, () => false), 'restore');
});

test('chooseAction never calls isAlive for a closed session', () => {
  let called = false;
  chooseAction({ open: false, windowId: null }, () => { called = true; return true; });
  assert.strictEqual(called, false);
});

test('chooseAction restores an open session with no window id without checking liveness', () => {
  assert.strictEqual(chooseAction({ open: true, windowId: null }, () => true), 'restore');
});

test('resolveDesktopSwitch targets the live desktop', () => {
  assert.strictEqual(resolveDesktopSwitch(5), 5);
});

test('resolveDesktopSwitch returns null when the live desktop is undefined', () => {
  assert.strictEqual(resolveDesktopSwitch(undefined), null);
});

test('resolveDesktopSwitch returns null when the live desktop is null', () => {
  assert.strictEqual(resolveDesktopSwitch(null), null);
});

test('resolveDesktopSwitch converts the live number as-is, no off-by-one', () => {
  // Pins the exact off-by-one bug: GoToDesktopNumber is 0-based. Desktop 0
  // (the very first desktop) must resolve to 0, not be treated as falsy/unknown.
  assert.strictEqual(resolveDesktopSwitch(0), 0);
});

// windows11-manager's GetWindowDesktopNumber (virtual-desktop.js) regex-matches
// "desktop number (\d+)" out of CLI text output and returns the capture group
// unconverted — a string, not a number. This is the real-world shape the
// helper's Number() coercion exists to handle; nothing above pins it.
test('resolveDesktopSwitch coerces a string desktop number to a number', () => {
  const result = resolveDesktopSwitch('3');
  assert.strictEqual(result, 3);
  assert.strictEqual(typeof result, 'number');
});

test('resolveDesktopSwitch coerces the string "0" to numeric 0, not "unknown"', () => {
  // '0' is truthy as a string but must resolve to the number 0, and must NOT
  // be confused with the null/undefined "unknown" sentinels.
  const result = resolveDesktopSwitch('0');
  assert.strictEqual(result, 0);
  assert.strictEqual(typeof result, 'number');
  assert.notStrictEqual(result, null);
});
