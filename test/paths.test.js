const { test } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');

const { settingsDir, appDataDir } = require('../src/paths');

test('settingsDir joins the windows-mqtt segment and extra segments', () => {
  assert.strictEqual(settingsDir(), path.join(appDataDir(), 'windows-mqtt'));
  assert.strictEqual(
    settingsDir('crash.log'),
    path.join(appDataDir(), 'windows-mqtt', 'crash.log')
  );
  assert.strictEqual(
    settingsDir('sub', 'file.json'),
    path.join(appDataDir(), 'windows-mqtt', 'sub', 'file.json')
  );
});

test('settingsDir respects XDG_CONFIG_HOME override on non-Windows', (t) => {
  if (process.platform === 'win32') return t.skip('non-Windows only');
  const prev = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = '/tmp/xdg-test-home';
  try {
    assert.strictEqual(
      settingsDir('config.yml'),
      path.join('/tmp/xdg-test-home', 'windows-mqtt', 'config.yml')
    );
  } finally {
    if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prev;
  }
});

test('settingsDir respects APPDATA override on Windows', (t) => {
  if (process.platform !== 'win32') return t.skip('Windows only');
  const prev = process.env.APPDATA;
  process.env.APPDATA = path.join(os.tmpdir(), 'appdata-test');
  try {
    assert.strictEqual(
      settingsDir('config.yml'),
      path.join(process.env.APPDATA, 'windows-mqtt', 'config.yml')
    );
  } finally {
    if (prev === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prev;
  }
});
