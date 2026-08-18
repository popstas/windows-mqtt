import { test } from 'node:test';
import assert from 'node:assert';
import { isNetworkPath } from '../src/modules/filewatch-helpers.js';

const DRIVES = ['R', 'S', 'V'];

test('a UNC path is a network path', () => {
  assert.strictEqual(isNetworkPath('\\\\shome\\popstas\\file.yaml', DRIVES), true);
  assert.strictEqual(isNetworkPath('//shome/popstas/file.yaml', DRIVES), true);
});

test('a mapped drive is recognised by its letter', () => {
  // The letter alone says nothing, so the list of network letters comes from
  // the system; here it is injected so the check stays testable.
  assert.strictEqual(isNetworkPath('R:/projects/config.yaml', DRIVES), true);
  assert.strictEqual(isNetworkPath('r:\\projects\\config.yaml', DRIVES), true);
});

test('a local drive is not a network path', () => {
  assert.strictEqual(isNetworkPath('D:/projects/js/x.txt', DRIVES), false);
  assert.strictEqual(isNetworkPath('C:\\Users\\popstas\\x.txt', DRIVES), false);
});

test('a relative path is not a network path', () => {
  assert.strictEqual(isNetworkPath('data/commands.yml', DRIVES), false);
  assert.strictEqual(isNetworkPath('', DRIVES), false);
  assert.strictEqual(isNetworkPath(undefined, DRIVES), false);
});

test('with no known network drives only UNC counts', () => {
  // Reading the drive list can fail; falling back to "nothing is remote" keeps
  // the previous behaviour rather than turning polling on everywhere.
  assert.strictEqual(isNetworkPath('R:/x.yaml', []), false);
  assert.strictEqual(isNetworkPath('\\\\host\\share\\x.yaml', []), true);
});
