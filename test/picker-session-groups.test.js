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
