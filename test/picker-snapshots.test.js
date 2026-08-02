const { test } = require('node:test');
const assert = require('node:assert');
const {
  isSnapshotsCommand,
  projectBasename,
  buildSnapshotRows,
} = require('../frontend-src/picker-snapshots');

test('recognises /s and /snapshots exactly', () => {
  assert.strictEqual(isSnapshotsCommand('/s'), true);
  assert.strictEqual(isSnapshotsCommand('/snapshots'), true);
  assert.strictEqual(isSnapshotsCommand(' /s '), true);
  assert.strictEqual(isSnapshotsCommand('/S'), true);
  assert.strictEqual(isSnapshotsCommand('/snapshots extra'), false);
  assert.strictEqual(isSnapshotsCommand('/session'), false);
  assert.strictEqual(isSnapshotsCommand('s'), false);
});

test('basename falls back to title when cwd is missing', () => {
  assert.strictEqual(projectBasename({ cwd: '/home/x/projects/foo', title: 'bar' }), 'foo');
  assert.strictEqual(projectBasename({ cwd: 'D:\\\\projects\\\\bar', title: 'x' }), 'bar');
  assert.strictEqual(projectBasename({ cwd: '', title: 'solo' }), 'solo');
  assert.strictEqual(projectBasename({ cwd: null, title: 'solo' }), 'solo');
});

test('builds three-line rows with missing sessions only', () => {
  const snapshots = [
    {
      id: '2026-08-02T20-21-11',
      created: 1785531153,
      sessions: [
        { id: 'a', title: 'alpha', cwd: '/home/x/alpha' },
        { id: 'b', title: 'beta', cwd: '/home/x/beta' },
        { id: 'c', title: 'gamma', cwd: '/home/x/gamma' },
      ],
    },
    {
      id: '2026-08-02T19-00-00',
      created: 1785526800,
      sessions: [
        { id: 'a', title: 'alpha', cwd: '/home/x/alpha' },
      ],
    },
  ];
  const rows = buildSnapshotRows(snapshots, new Set(['a', 'b']));
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].id, '2026-08-02T20-21-11');
  assert.strictEqual(rows[0].n, 0);
  assert.match(rows[0].line1, /3/);
  assert.strictEqual(rows[0].line2, 'alpha · beta · gamma');
  assert.strictEqual(rows[0].line3, 'restore 0: gamma');
  assert.strictEqual(rows[1].n, 1);
  assert.strictEqual(rows[1].line3, 'restore 1: —');
});
