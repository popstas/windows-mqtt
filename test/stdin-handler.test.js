const { test } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

test('stdin-handler dispatches actions from bridge events', async () => {
  const stdinHandler = require('../src/stdin-handler');
  let called = false;
  stdinHandler.register({ 'test/action': () => { called = true; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/action');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(called, 'registered handler must run when bridge emits action');
});
