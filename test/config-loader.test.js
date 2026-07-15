const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadConfig, SAFE_DEFAULT } = require('../src/config-loader');
const { resolveAppFile } = require('../src/paths');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wm-config-'));
}

test('loadConfig reads config.yml when present', () => {
  const dir = tmpDir();
  try {
    const cfgPath = path.join(dir, 'config.yml');
    fs.writeFileSync(cfgPath, 'mqtt:\n  base: home\nmodules:\n  foo: {}\n');
    const resolve = (name) =>
      name === 'config.yml' ? cfgPath : path.join(dir, 'missing');
    const cfg = loadConfig(resolve);
    assert.strictEqual(cfg.mqtt.base, 'home');
    assert.ok(cfg.modules.foo);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig falls back to config.example.yml when config.yml is missing', () => {
  const dir = tmpDir();
  try {
    const examplePath = path.join(dir, 'config.example.yml');
    fs.writeFileSync(examplePath, 'mqtt:\n  base: example-base\nmodules: {}\n');
    // config.yml resolves to a nonexistent path (readFileSync throws ENOENT).
    const resolve = (name) =>
      name === 'config.yml' ? path.join(dir, 'nope.yml') : examplePath;
    const cfg = loadConfig(resolve);
    assert.strictEqual(cfg.mqtt.base, 'example-base');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig returns a safe default (never null) when both files are missing', () => {
  const dir = tmpDir();
  try {
    const resolve = () => path.join(dir, 'does-not-exist.yml');
    const cfg = loadConfig(resolve);
    assert.notStrictEqual(cfg, null);
    assert.deepStrictEqual(cfg, SAFE_DEFAULT);
    // Consumers must be able to dereference these without throwing.
    assert.doesNotThrow(() => {
      const _ = cfg.mqtt.base;
      for (const _name in cfg.modules) { /* iterate safely */ }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadConfig maps an empty config document to the safe default shape', () => {
  const dir = tmpDir();
  try {
    const cfgPath = path.join(dir, 'config.yml');
    fs.writeFileSync(cfgPath, '');
    const resolve = () => cfgPath;
    const cfg = loadConfig(resolve);
    assert.notStrictEqual(cfg, null);
    assert.ok(cfg.mqtt);
    assert.ok(cfg.modules);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveAppFile honors an existing env-var path', () => {
  const dir = tmpDir();
  try {
    const filePath = path.join(dir, 'my-config.yml');
    fs.writeFileSync(filePath, 'ok');
    const prev = process.env.CONFIG_TEST_VAR;
    process.env.CONFIG_TEST_VAR = filePath;
    try {
      assert.strictEqual(
        resolveAppFile('config.yml', 'CONFIG_TEST_VAR'),
        filePath
      );
    } finally {
      if (prev === undefined) delete process.env.CONFIG_TEST_VAR;
      else process.env.CONFIG_TEST_VAR = prev;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveAppFile falls through when the env-var path does not exist', () => {
  const dir = tmpDir();
  try {
    const missing = path.join(dir, 'nonexistent.yml');
    const prev = process.env.CONFIG_TEST_VAR;
    process.env.CONFIG_TEST_VAR = missing;
    try {
      const resolved = resolveAppFile('config.yml', 'CONFIG_TEST_VAR');
      // Must NOT return the stale/missing env path; falls through to the
      // candidate list (which resolves to a real repo config.yml here).
      assert.notStrictEqual(resolved, missing);
    } finally {
      if (prev === undefined) delete process.env.CONFIG_TEST_VAR;
      else process.env.CONFIG_TEST_VAR = prev;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
