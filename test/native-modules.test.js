const { test } = require('node:test');
const assert = require('node:assert');

// These modules require native addons (@hurdlegroup/robotjs, @julusian/midi)
// that are only installed/buildable on the target Windows machine. Skip on any
// checkout where they can't be resolved so `npm test` stays green off-Windows;
// the loader contract is still asserted wherever the natives are present.
function nativesAvailable() {
  for (const dep of ['@hurdlegroup/robotjs', '@julusian/midi']) {
    try {
      require.resolve(dep);
    } catch (e) {
      return false;
    }
  }
  return true;
}

test('modules with native deps load on Node 24', { skip: !nativesAvailable() }, async () => {
  const { load } = require('../src/modules');
  assert.strictEqual(typeof await load('keys'), 'function');
  assert.strictEqual(typeof await load('mouse'), 'function');
  assert.strictEqual(typeof await load('midi'), 'function');
});
