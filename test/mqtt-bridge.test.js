const { test } = require('node:test');
const assert = require('node:assert');

// mqttInit() wires a readline interface onto process.stdin (it is the JS side
// of the Rust IPC pipe). That keeps the event loop alive in a test process
// that never sends stdin EOF, so unref it once tests are done reading from it.
process.stdin.unref?.();

// mqtt-bridge.js is the JS side of the Rust<->Node IPC: it writes one JSON
// object per line to stdout for Rust to parse. sendEvent() is the new method
// that lets a module push arbitrary named data (e.g. the claude-wt session
// list) to the picker webview via Rust's IpcFromJs::Event -> emit_to.
test('sendEvent writes a type:event line with name and payload to stdout', () => {
  const { mqttInit } = require('../src/mqtt-bridge');
  const bridge = mqttInit();

  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { writes.push(chunk); return true; };
  try {
    bridge.sendEvent('claude-wt-sessions', { ok: true, groups: [{ label: 'g' }] });
  } finally {
    process.stdout.write = original;
  }

  assert.strictEqual(writes.length, 1, 'sendEvent must write exactly one line');
  assert.ok(writes[0].endsWith('\n'), 'the line must be newline-terminated for the line-JSON protocol');
  const parsed = JSON.parse(writes[0]);
  assert.deepStrictEqual(parsed, {
    type: 'event',
    name: 'claude-wt-sessions',
    payload: { ok: true, groups: [{ label: 'g' }] },
  }, 'the emitted object must carry type, name and payload verbatim');
});

test('sendEvent passes the failure payload through unchanged', () => {
  const { mqttInit } = require('../src/mqtt-bridge');
  const bridge = mqttInit();

  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => { writes.push(chunk); return true; };
  try {
    bridge.sendEvent('claude-wt-sessions', { ok: false, reason: 'not running' });
  } finally {
    process.stdout.write = original;
  }

  const parsed = JSON.parse(writes[0]);
  assert.strictEqual(parsed.payload.ok, false);
  assert.strictEqual(parsed.payload.reason, 'not running', 'the reason string must survive the round trip');
});

test('a broken stdout pipe does not throw out of sendEvent', () => {
  const { mqttInit } = require('../src/mqtt-bridge');
  const bridge = mqttInit();

  const original = process.stdout.write;
  process.stdout.write = () => { throw new Error('EPIPE'); };
  try {
    assert.doesNotThrow(() => bridge.sendEvent('claude-wt-sessions', { ok: true, groups: [] }));
  } finally {
    process.stdout.write = original;
  }
});
