const { test } = require('node:test');
const assert = require('node:assert');
const {
  createClaudeWtWatchdog,
  CHECK_INTERVAL_MS,
  RESTART_COOLDOWN_MS,
  DEFAULT_SILENCE_MS,
  DEFAULT_GRACE_MS,
} = require('../src/modules/claude-wt-watchdog');

function harness({ healthy, reason = 'stale', ageMs = 70000, ...over }) {
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
    ...over,
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
  // Именно счётчик падений, а не любая семёрка: «70s назад» в той же строке
  // делал прежнюю проверку на '7' истинной сам по себе.
  assert.ok(h.logs.some(m => m.includes('падений подряд 7')), h.logs.join(' | '));
  assert.ok(h.logs.some(m => m.includes('последний тик 70s назад')), h.logs.join(' | '));
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

test('без возраста тика строка не врёт про «0s назад»', () => {
  // Остановленный демон: startedAt обнулён, возраста у последнего тика нет.
  const h = harness({ healthy: false, reason: 'not running', ageMs: 0 });
  h.check();
  const line = h.logs[0];
  assert.ok(line.includes('not running'), line);
  assert.ok(!line.includes('назад'), line);
  assert.ok(line.includes('падений подряд 7'), line);
});

test('диагноз получает те самые поля статуса и пороги', () => {
  // Опечатка в имени поля (lastTick вместо lastTickAt) или потерянный порог
  // проходили мимо всех прежних проверок: health() их просто игнорировал.
  const seen = [];
  const check = createClaudeWtWatchdog({
    status: () => ({
      running: true, startedAt: 111, lastTickAt: 222, tickFailures: 0, lastTickError: '',
    }),
    health: (args) => { seen.push(args); return { healthy: true, reason: 'ok', ageMs: 1 }; },
    restart: () => {},
    log: () => {},
    now: () => 999,
    silenceMs: 1234,
    graceMs: 5678,
  });
  check();
  assert.deepStrictEqual(seen, [{
    running: true,
    lastTickAt: 222,
    startedAt: 111,
    nowMs: 999,
    silenceMs: 1234,
    graceMs: 5678,
  }]);
});

test('пороги от библиотеки без них подменяются запасными', () => {
  // Так выглядит старая windows11-manager: TICK_SILENCE_MS/TICK_GRACE_MS
  // отсутствуют, и без запасных значений сравнения с undefined всегда ложны —
  // сторож считал бы демона здоровым вечно.
  const seen = [];
  const check = createClaudeWtWatchdog({
    status: () => ({ running: true, startedAt: 0, lastTickAt: 0, tickFailures: 0, lastTickError: '' }),
    health: (args) => { seen.push(args); return { healthy: true, reason: 'ok', ageMs: 0 }; },
    restart: () => {},
    log: () => {},
    silenceMs: undefined,
    graceMs: undefined,
  });
  check();
  assert.strictEqual(seen[0].silenceMs, DEFAULT_SILENCE_MS);
  assert.strictEqual(seen[0].graceMs, DEFAULT_GRACE_MS);
  assert.ok(DEFAULT_SILENCE_MS > 0 && DEFAULT_GRACE_MS > 0);
});

test('упавший status() не роняет сторожа и попадает в лог', () => {
  const logs = [];
  const check = createClaudeWtWatchdog({
    status: () => { throw new Error('config gone'); },
    health: () => ({ healthy: false, reason: 'stale', ageMs: 1 }),
    restart: () => { throw new Error('restart must not be reached'); },
    log: (msg, level) => { logs.push([msg, level]); },
  });
  assert.strictEqual(check(), false);
  assert.ok(logs.some(([m]) => m.includes('config gone')), JSON.stringify(logs));
  assert.strictEqual(logs[0][1], 'error');
});

test('упавший health() тоже перехватывается', () => {
  const logs = [];
  const check = createClaudeWtWatchdog({
    status: () => ({ running: true, startedAt: 0, lastTickAt: 0, tickFailures: 0, lastTickError: '' }),
    health: () => { throw new TypeError('winMan.claudeWtHealth is not a function'); },
    restart: () => { throw new Error('restart must not be reached'); },
    log: (msg) => { logs.push(msg); },
  });
  assert.strictEqual(check(), false);
  assert.ok(logs.some(m => m.includes('claudeWtHealth')), logs.join(' | '));
});
