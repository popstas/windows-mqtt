const { test } = require('node:test');
const assert = require('node:assert');

test('modules with native deps load on Node 24', () => {
  const { load } = require('../src/modules');
  assert.strictEqual(typeof load('keys'), 'function');
  assert.strictEqual(typeof load('mouse'), 'function');
  assert.strictEqual(typeof load('midi'), 'function');
});
