const { test } = require('node:test');
const assert = require('node:assert');

const { listPortNames, formatMidiPortHelp, shouldLogOnce } = require('../src/modules/midi-utils');

// Fake midi.Input exposing only the port-enumeration surface used by the helper.
function fakeInput(names) {
  return {
    getPortCount: () => names.length,
    getPortName: (p) => names[p],
  };
}

test('listPortNames enumerates all port names in order', () => {
  assert.deepStrictEqual(listPortNames(fakeInput([])), []);
  assert.deepStrictEqual(
    listPortNames(fakeInput(['LPK25 0', 'nanoKONTROL2 1'])),
    ['LPK25 0', 'nanoKONTROL2 1']
  );
});

test('formatMidiPortHelp lists ports and portName candidates', () => {
  const lines = formatMidiPortHelp(['LPK25 0', 'nanoKONTROL2 1']);
  assert.deepStrictEqual(lines, [
    'midi ports:',
    '  0: LPK25 0',
    '  1: nanoKONTROL2 1',
    'add one of these to the midi device config:',
    "portName: 'LPK25 0',",
    "portName: 'nanoKONTROL2 1',",
  ]);
});

test('formatMidiPortHelp guides reconnect when no ports detected', () => {
  assert.deepStrictEqual(formatMidiPortHelp([]), [
    'midi ports: none detected yet, reconnect the device',
  ]);
});

test('shouldLogOnce returns true only the first time per key', () => {
  const seen = new Set();
  assert.strictEqual(shouldLogOnce(seen, 'LPK25'), true);
  assert.strictEqual(shouldLogOnce(seen, 'LPK25'), false);
  assert.strictEqual(shouldLogOnce(seen, 'LPK25'), false);
  // a different key logs once on its own
  assert.strictEqual(shouldLogOnce(seen, 'nanoKONTROL2'), true);
  assert.strictEqual(shouldLogOnce(seen, 'nanoKONTROL2'), false);
});

test('shouldLogOnce re-enables a log after its key is deleted (open succeeds then fails)', () => {
  const seen = new Set();
  assert.strictEqual(shouldLogOnce(seen, 3), true);
  assert.strictEqual(shouldLogOnce(seen, 3), false);
  seen.delete(3); // e.g. openPort succeeded, clearing the dedupe
  assert.strictEqual(shouldLogOnce(seen, 3), true);
});

test('shouldLogOnce keys numeric portNum independently from portName strings', () => {
  const seen = new Set();
  assert.strictEqual(shouldLogOnce(seen, 0), true);
  assert.strictEqual(shouldLogOnce(seen, '0'), true); // distinct key type
  assert.strictEqual(shouldLogOnce(seen, 0), false);
  assert.strictEqual(shouldLogOnce(seen, '0'), false);
});
