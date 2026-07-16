const { test } = require('node:test');
const assert = require('node:assert');

const audio = require('../src/modules/audio');
const { isDeviceDisabled, parseWatcherLine, fallbackIntervalMs, shouldScheduleRestart } = audio;

test('isDeviceDisabled is false when device is unset or configured', () => {
  assert.strictEqual(isDeviceDisabled(undefined), false);
  assert.strictEqual(isDeviceDisabled({}), false);
  assert.strictEqual(isDeviceDisabled({ device: { stat: '/device' } }), false);
  assert.strictEqual(isDeviceDisabled({ device: { enabled: true } }), false);
});

test('isDeviceDisabled is true for device:false or device.enabled:false', () => {
  assert.strictEqual(isDeviceDisabled({ device: false }), true);
  assert.strictEqual(isDeviceDisabled({ device: { enabled: false } }), true);
});

test('parseWatcherLine splits kind and trimmed value', () => {
  assert.deepStrictEqual(parseWatcherLine('volume\t42'), { kind: 'volume', value: '42' });
  assert.deepStrictEqual(parseWatcherLine('mute\t1\r'), { kind: 'mute', value: '1' });
  assert.deepStrictEqual(parseWatcherLine('playback\tSpeakers (Realtek) '), {
    kind: 'playback',
    value: 'Speakers (Realtek)',
  });
});

test('parseWatcherLine returns null for malformed or empty-value lines', () => {
  assert.strictEqual(parseWatcherLine('no-tab-here'), null);
  assert.strictEqual(parseWatcherLine('volume\t   '), null);
  assert.strictEqual(parseWatcherLine('volume\t'), null);
});

test('fallbackIntervalMs defaults to 5s and honours config.interval', () => {
  assert.strictEqual(fallbackIntervalMs(undefined), 5000);
  assert.strictEqual(fallbackIntervalMs({}), 5000);
  assert.strictEqual(fallbackIntervalMs({ interval: 10 }), 10000);
});

test('shouldScheduleRestart guards stopping and double-restart', () => {
  assert.strictEqual(shouldScheduleRestart({ stopping: false, timerActive: false }), true);
  // stopping: never restart
  assert.strictEqual(shouldScheduleRestart({ stopping: true, timerActive: false }), false);
  // a timer is already pending (e.g. 'exit' after 'error'): don't double-schedule
  assert.strictEqual(shouldScheduleRestart({ stopping: false, timerActive: true }), false);
  assert.strictEqual(shouldScheduleRestart({ stopping: true, timerActive: true }), false);
});
