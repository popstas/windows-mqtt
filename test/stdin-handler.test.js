import { test } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import * as stdinHandler from '../src/stdin-handler.js';

test('stdin-handler dispatches actions from bridge events', async () => {
  let called = false;
  stdinHandler.register({ 'test/action': () => { called = true; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/action');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(called, 'registered handler must run when bridge emits action');
});

test('stdin-handler passes payload to handlers', async () => {
  let got = 'not called';
  stdinHandler.register({ 'test/payload': (payload) => { got = payload; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/payload', { id: 'abc' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(got, { id: 'abc' }, 'handler must receive the payload');
});

test('stdin-handler still calls handlers registered without payload', async () => {
  let calls = 0;
  stdinHandler.register({ 'test/legacy': () => { calls += 1; } });
  const fakeBridge = new EventEmitter();
  stdinHandler.init(fakeBridge);
  fakeBridge.emit('action', 'test/legacy');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 1, 'actions without a payload must keep working');
});
