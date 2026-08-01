const { test } = require('node:test');
const assert = require('node:assert');
const { labelSessions, groupSessions, buildSessionsPayload, chooseAction, resolveDesktopSwitch } = require('../src/picker/session-groups');

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

test('groupSessions puts every live session in one group above the closed ones', () => {
  const groups = groupSessions([
    s({ id: 'closed1', open: false, desktop: 2 }),
    s({ id: 'live2', open: true, desktop: 2, bounds: { x: 200, y: 0, width: 10, height: 10 } }),
    s({ id: 'closed2', open: false, desktop: 1 }),
    s({ id: 'live1', open: true, desktop: 1, bounds: { x: 100, y: 0, width: 10, height: 10 } }),
  ]);
  assert.deepStrictEqual(groups.map(g => g.label), ['Active sessions', 'Desktop 1', 'Desktop 2']);
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
  assert.deepStrictEqual(groups.map(g => g.label), ['Active sessions']);
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

test('groupSessions sorts null bounds correctly when comparing with multiple sessions', () => {
  const [group] = groupSessions([
    s({ id: 'c', bounds: { x: 200, y: 50, width: 10, height: 10 } }),
    s({ id: 'a', bounds: null }),
    s({ id: 'b', bounds: { x: 100, y: 100, width: 10, height: 10 } }),
  ]);
  assert.deepStrictEqual(group.sessions.map(x => x.id), ['a', 'b', 'c']);
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
  // groupSessions ran: two closed sessions on different desktops became two
  // groups, sorted ascending (2 before 1 in the input, 1 before 2 in output).
  assert.deepStrictEqual(payload.groups.map(g => g.label), ['Desktop 1', 'Desktop 2']);
  // labelSessions ran: the duplicate title+cwd pair got disambiguated with an id
  // prefix rather than passing the raw sessions through untouched.
  assert.strictEqual(payload.groups[0].sessions[0].label, 'agent (bbbb)');
  assert.strictEqual(payload.groups[1].sessions[0].label, 'agent (aaaa)');
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
