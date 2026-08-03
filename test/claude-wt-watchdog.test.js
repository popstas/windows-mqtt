const { test } = require('node:test');
const assert = require('node:assert');
const {
  createClaudeWtWatchdog,
  CHECK_INTERVAL_MS,
  RESTART_COOLDOWN_MS,
} = require('../src/modules/claude-wt-watchdog');

function harness({ healthy, reason = 'stale', ageMs = 70000 }) {
  const logs = [];
  let restarts = 0;
  let now = 1000000;
  const check = createClaudeWtWatchdog({
    status: () => ({
      running: true, startedAt: 0, lastTickAt: 1, tickFailures: 7, lastTickError: 'EBUSY',
    }),
    health: () => ({ healthy, reason, ageMs }),
    restart: () => { restarts += 1; },
    log: (msg) => { logs.push(msg); },
    now: () => now,
  });
  return {
    check,
    logs,
    restarts: () => restarts,
    advance: (ms) => { now += ms; },
  };
}

test('здоровый демон не даёт ни строки, ни перезапуска', () => {
  const h = harness({ healthy: true, reason: 'ok', ageMs: 500 });
  assert.strictEqual(h.check(), false);
  assert.deepStrictEqual(h.logs, []);
  assert.strictEqual(h.restarts(), 0);
});

test('больной демон логируется и поднимается', () => {
  const h = harness({ healthy: false });
  assert.strictEqual(h.check(), true);
  assert.strictEqual(h.restarts(), 1);
  assert.ok(h.logs.some(m => m.includes('stale')));
  assert.ok(h.logs.some(m => m.includes('EBUSY')));
  assert.ok(h.logs.some(m => m.includes('7')));
});

test('внутри кулдауна демон не поднимается, но диагноз пишется каждый раз', () => {
  const h = harness({ healthy: false });
  h.check();
  const afterFirst = h.logs.length;
  h.advance(CHECK_INTERVAL_MS);
  assert.strictEqual(h.check(), false);
  assert.strictEqual(h.restarts(), 1);
  assert.ok(h.logs.length > afterFirst);
});

test('после кулдауна демон поднимается снова', () => {
  const h = harness({ healthy: false });
  h.check();
  h.advance(RESTART_COOLDOWN_MS + 1);
  assert.strictEqual(h.check(), true);
  assert.strictEqual(h.restarts(), 2);
});
