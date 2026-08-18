import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { rotateFile } from '../src/log-rotate.js';

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-rotate-'));
  return path.join(dir, 'app.log');
}

test('rotates when the file grows past the cap', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'x'.repeat(100));
  let warned = false;
  rotateFile(file, 10, () => { warned = true; });
  assert.strictEqual(fs.existsSync(file), false, 'original renamed away');
  assert.strictEqual(fs.readFileSync(file + '.1', 'utf8'), 'x'.repeat(100));
  assert.strictEqual(warned, false, 'no warning on success');
});

test('does not rotate when under the cap', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'small');
  rotateFile(file, 1000, () => { throw new Error('should not warn'); });
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'small');
  assert.strictEqual(fs.existsSync(file + '.1'), false);
});

test('replaces an existing .1 backup', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'y'.repeat(100));
  fs.writeFileSync(file + '.1', 'old-backup');
  rotateFile(file, 10, () => { throw new Error('should not warn'); });
  assert.strictEqual(fs.readFileSync(file + '.1', 'utf8'), 'y'.repeat(100));
  assert.strictEqual(fs.existsSync(file), false);
});

test('is silent when the file does not exist yet', () => {
  const file = tmpFile();
  let warned = false;
  rotateFile(file, 10, () => { warned = true; });
  assert.strictEqual(warned, false, 'ENOENT is not reported');
  assert.strictEqual(fs.existsSync(file + '.1'), false);
});

test('calls onWarn when the rename fails', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'z'.repeat(100));
  // Make the .1 target a non-empty directory so rename fails.
  fs.mkdirSync(file + '.1');
  fs.writeFileSync(path.join(file + '.1', 'blocker'), 'x');
  let message = null;
  rotateFile(file, 10, (m) => { message = m; });
  assert.ok(message && /rotation failed/.test(message), `got: ${message}`);
  // Original left intact since rotation could not complete.
  assert.strictEqual(fs.existsSync(file), true);
});

test('onWarn is optional (no throw when omitted)', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'q'.repeat(100));
  fs.mkdirSync(file + '.1');
  fs.writeFileSync(path.join(file + '.1', 'blocker'), 'x');
  assert.doesNotThrow(() => rotateFile(file, 10));
});
