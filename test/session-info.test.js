const { test } = require('node:test');
const assert = require('node:assert');
const { buildSessionInfoRows } = require('../frontend-src/session-info');

const session = {
  id: 'abc-123',
  label: 'ccfzf',
  cwd: '/home/popstas/projects/shell/ccfzf',
  open: true,
  windowId: 42,
  desktop: 2,
  monitor: 1,
  bounds: { x: 0, y: 0, width: 1600, height: 900 },
  agentState: 'review',
  agentEvent: 'stop',
  agentMessage: '',
  agentPrompt: 'почини сборку',
  agentDescription: 'Готово — сборка зелёная',
  agentCostUsd: 3,
  agentContextPct: 41,
  agentStarted: 1000,
  agentBackground: false,
  agentSessionId: 'abc-123',
  lastActivity: 3400,
  focusedAt: 3000,
  agentSeen: false,
  branch: 'feat/x',
  pr_url: 'https://github.com/popstas/ccfzf/pull/3',
};

function valueOf(rows, label) {
  return rows.find(r => r.label === label)?.value;
}

test('buildSessionInfoRows shows the fields a row cannot fit', () => {
  const rows = buildSessionInfoRows(session, 3460);
  assert.strictEqual(valueOf(rows, 'id'), 'abc-123');
  assert.strictEqual(valueOf(rows, 'desktop'), '2');
  assert.strictEqual(valueOf(rows, 'monitor'), '1');
  assert.strictEqual(valueOf(rows, 'bounds'), '1600×900 @ 0,0');
  assert.strictEqual(valueOf(rows, 'event'), 'stop');
  assert.strictEqual(valueOf(rows, 'branch'), 'feat/x');
  assert.strictEqual(valueOf(rows, 'pr_url'), 'https://github.com/popstas/ccfzf/pull/3');
});

test('buildSessionInfoRows prints timestamps as clock plus age', () => {
  const rows = buildSessionInfoRows(session, 3460);
  // 3400 — минута назад относительно 3460.
  assert.match(valueOf(rows, 'last activity'), /^\d{2}:\d{2} · 1m$/);
});

test('buildSessionInfoRows skips fields the session does not have', () => {
  const rows = buildSessionInfoRows(
    { id: 'x', label: 'x', cwd: '', open: false },
    100,
  );
  const labels = rows.map(r => r.label);
  assert.ok(!labels.includes('pr_url'));
  assert.ok(!labels.includes('branch'));
  assert.ok(!labels.includes('bounds'));
  assert.ok(labels.includes('id'));
});

test('buildSessionInfoRows names the background agent that answers for the session', () => {
  const rows = buildSessionInfoRows(
    { ...session, agentBackground: true, agentSessionId: 'fork-9' },
    3460,
  );
  assert.strictEqual(valueOf(rows, 'agent'), 'background · fork-9');
});

test('buildSessionInfoRows reports whether the state was seen', () => {
  assert.strictEqual(valueOf(buildSessionInfoRows(session, 3460), 'seen'), 'no');
  assert.strictEqual(
    valueOf(buildSessionInfoRows({ ...session, agentSeen: true }, 3460), 'seen'),
    'yes',
  );
});

test('buildSessionInfoRows spells recent activity in seconds', () => {
  const rows = buildSessionInfoRows(
    { ...session, lastActivity: 3459 }, // 1 сек назад
    3460,
  );
  assert.match(valueOf(rows, 'last activity'), /^\d{2}:\d{2} · 1s$/);
});

test('buildSessionInfoRows skips explicit null bounds and zero timestamps', () => {
  const rows = buildSessionInfoRows(
    {
      id: 'x',
      label: 'x',
      cwd: '/p',
      open: false,
      bounds: null,
      agentStarted: 0,
      lastActivity: 0,
      focusedAt: 0,
    },
    100,
  );
  const labels = rows.map(r => r.label);
  assert.ok(!labels.includes('bounds'));
  assert.ok(!labels.includes('started'));
  assert.ok(!labels.includes('last activity'));
  assert.ok(!labels.includes('focused'));
});

test('buildSessionInfoRows omits agent field when background is true but sessionId is missing', () => {
  const rows = buildSessionInfoRows(
    { ...session, agentBackground: true, agentSessionId: undefined },
    3460,
  );
  const labels = rows.map(r => r.label);
  assert.ok(!labels.includes('agent'));
});
