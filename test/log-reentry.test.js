import { test } from 'node:test';
import assert from 'node:assert';
import * as reentry from '../src/log-reentry.js';

test('снаружи вызова флаг опущен', () => {
  assert.strictEqual(reentry.isInside(), false);
});

test('внутри run() флаг поднят, после — опущен', () => {
  let inside = null;
  reentry.run(() => { inside = reentry.isInside(); });
  assert.strictEqual(inside, true);
  assert.strictEqual(reentry.isInside(), false);
});

test('вложенные вызовы не гасят флаг раньше времени', () => {
  const seen = [];
  reentry.run(() => {
    reentry.run(() => { seen.push(reentry.isInside()); });
    seen.push(reentry.isInside());
  });
  assert.deepStrictEqual(seen, [true, true]);
  assert.strictEqual(reentry.isInside(), false);
});

test('исключение внутри run() опускает флаг', () => {
  assert.throws(() => reentry.run(() => { throw new Error('boom'); }), /boom/);
  assert.strictEqual(reentry.isInside(), false);
});

test('run() возвращает значение обёрнутой функции', () => {
  assert.strictEqual(reentry.run(() => 42), 42);
});
