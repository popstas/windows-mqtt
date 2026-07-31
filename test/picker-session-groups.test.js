const { test } = require('node:test');
const assert = require('node:assert');
const { labelSessions, groupSessions, buildSessionsPayload } = require('../src/picker/session-groups');

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
    s({ id: 'c', desktop: 2, monitor: 1 }),
    s({ id: 'b', desktop: 1, monitor: 2 }),
    s({ id: 'a', desktop: 1, monitor: 1 }),
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
    s({ id: 'aaaa1111', title: 'agent', cwd: '/p/agent', desktop: 2, monitor: 1 }),
    s({ id: 'bbbb2222', title: 'agent', cwd: '/p/agent', desktop: 1, monitor: 1 }),
  ];
  const payload = buildSessionsPayload({ ok: true, sessions });

  assert.strictEqual(payload.ok, true);
  // groupSessions ran: two distinct (desktop, monitor) pairs became two groups,
  // sorted by desktop ascending (2 before 1 in the input, 1 before 2 in output).
  assert.deepStrictEqual(payload.groups.map(g => g.label), [
    'Desktop 1 · Monitor 1',
    'Desktop 2 · Monitor 1',
  ]);
  // labelSessions ran: the duplicate title+cwd pair got disambiguated with an id
  // prefix rather than passing the raw sessions through untouched.
  assert.strictEqual(payload.groups[0].sessions[0].label, 'agent (bbbb)');
  assert.strictEqual(payload.groups[1].sessions[0].label, 'agent (aaaa)');
});

test('buildSessionsPayload carries the reason through unchanged on the failure path', () => {
  const payload = buildSessionsPayload({ ok: false, reason: 'claudeWt.enabled is false in config' });
  assert.deepStrictEqual(payload, { ok: false, reason: 'claudeWt.enabled is false in config' });
});
