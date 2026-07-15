const { test } = require('node:test');
const assert = require('node:assert');

const { safeCount } = require('../src/monitor');

test('counts entries when the introspection method exists', () => {
  const obj = { list: () => [1, 2, 3] };
  assert.strictEqual(safeCount(obj, 'list'), 3);
});

test('returns null when the method is missing (future Node removal)', () => {
  assert.strictEqual(safeCount({}, '_getActiveHandles'), null);
});

test('returns null when the property is not a function', () => {
  assert.strictEqual(safeCount({ list: 42 }, 'list'), null);
});

test('preserves the receiver so the real process APIs work', () => {
  assert.strictEqual(typeof safeCount(process, '_getActiveHandles'), 'number');
  assert.strictEqual(typeof safeCount(process, '_getActiveRequests'), 'number');
});
