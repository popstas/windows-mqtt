import { test } from 'node:test';
import assert from 'node:assert';
import { createDelayedSlotOff } from '../src/modules/delayed-slot-off.js';

function fakeTimers() {
  let nextId = 1;
  const pending = new Map();
  let now = 0;
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    tick(ms) {
      now += ms;
      for (const [id, job] of [...pending]) {
        if (job.at <= now) {
          pending.delete(id);
          job.fn();
        }
      }
    },
  };
}

test('publishes off after the delay, not immediately', () => {
  const seen = [];
  const t = fakeTimers();
  const schedule = createDelayedSlotOff({
    delayMs: 500,
    publish: (slot) => seen.push(slot),
    setTimeoutFn: t.setTimeout,
    clearTimeoutFn: t.clearTimeout,
  });
  schedule(3);
  assert.deepStrictEqual(seen, []);
  t.tick(499);
  assert.deepStrictEqual(seen, []);
  t.tick(1);
  assert.deepStrictEqual(seen, [3]);
});

test('a second press on the same slot restarts the timer', () => {
  const seen = [];
  const t = fakeTimers();
  const schedule = createDelayedSlotOff({
    delayMs: 500,
    publish: (slot) => seen.push(slot),
    setTimeoutFn: t.setTimeout,
    clearTimeoutFn: t.clearTimeout,
  });
  schedule(3);
  t.tick(400);
  schedule(3);
  t.tick(400);
  assert.deepStrictEqual(seen, []);
  t.tick(100);
  assert.deepStrictEqual(seen, [3]);
});

test('different slots keep independent timers', () => {
  const seen = [];
  const t = fakeTimers();
  const schedule = createDelayedSlotOff({
    delayMs: 500,
    publish: (slot) => seen.push(Number(slot)),
    setTimeoutFn: t.setTimeout,
    clearTimeoutFn: t.clearTimeout,
  });
  schedule(1);
  t.tick(200);
  schedule(2);
  t.tick(300);
  assert.deepStrictEqual(seen, [1]);
  t.tick(200);
  assert.deepStrictEqual(seen, [1, 2]);
});
