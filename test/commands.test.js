const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const commands = require('../src/modules/commands');
const { writeScriptFile, removeScriptFile, parseCommandsFile } = commands;

test('writeScriptFile writes the script under os.tmpdir()', () => {
  const filePath = writeScriptFile('echo hello');
  try {
    assert.ok(
      filePath.startsWith(os.tmpdir()),
      `expected ${filePath} to be under ${os.tmpdir()}`
    );
    assert.ok(fs.existsSync(filePath), 'temp script file should exist');
    assert.strictEqual(fs.readFileSync(filePath, 'utf8'), 'echo hello');
  } finally {
    removeScriptFile(filePath);
  }
});

test('removeScriptFile cleans up the temp file', () => {
  const filePath = writeScriptFile('cleanup me');
  assert.ok(fs.existsSync(filePath));
  removeScriptFile(filePath);
  assert.ok(!fs.existsSync(filePath), 'temp file should be removed');
});

test('removeScriptFile does not throw on an already-missing file', () => {
  const missing = path.join(os.tmpdir(), 'windows-mqtt-script-does-not-exist');
  assert.doesNotThrow(() => removeScriptFile(missing));
});

test('parseCommandsFile parses a commands.yml from a temp dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-commands-'));
  try {
    const cmdPath = path.join(dir, 'commands.yml');
    fs.writeFileSync(cmdPath, '- name: test\n  mqtt_topic: actions/test\n');
    const parsed = parseCommandsFile(cmdPath);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed[0].name, 'test');
    assert.strictEqual(parsed[0].mqtt_topic, 'actions/test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseCommandsFile returns [] for a missing file', () => {
  const missing = path.join(os.tmpdir(), 'wm-commands-missing.yml');
  const parsed = parseCommandsFile(missing);
  assert.deepStrictEqual(parsed, []);
});

test('parseCommandsFile returns [] for an empty document', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-commands-'));
  try {
    const cmdPath = path.join(dir, 'commands.yml');
    fs.writeFileSync(cmdPath, '');
    assert.deepStrictEqual(parseCommandsFile(cmdPath), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
