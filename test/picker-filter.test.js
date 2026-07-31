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
