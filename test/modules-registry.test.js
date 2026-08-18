const { test } = require('node:test');
const assert = require('node:assert');

test('registry exposes load() and module names, without deleted vad', () => {
  const mods = require('../src/modules');
  assert.strictEqual(typeof mods.load, 'function');
  assert.ok(Object.keys(mods.registry).includes('audio'));
  assert.ok(!Object.keys(mods.registry).includes('vad'), 'vad.js was deleted, must not be referenced');
});

test('load() rejects for unknown module name', async () => {
  const { load } = require('../src/modules');
  await assert.rejects(load('nope'), /Unknown module/);
});

test('requiring the registry loads no module implementations (lazy)', () => {
  require('../src/modules');
  const loaded = Object.keys(require.cache).map(p => p.replace(/\\/g, '/'));
  assert.ok(!loaded.some(p => p.includes('src/modules/tts')), 'tts (sherpa-onnx) must not load eagerly');
  assert.ok(!loaded.some(p => p.includes('src/modules/midi')), 'midi must not load eagerly');
});
