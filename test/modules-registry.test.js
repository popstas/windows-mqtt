import { test } from 'node:test';
import assert from 'node:assert';
import { registerHooks } from 'node:module';

import * as mods from '../src/modules/index.js';

test('registry exposes load() and module names, without deleted vad', () => {
  assert.strictEqual(typeof mods.load, 'function');
  assert.ok(Object.keys(mods.registry).includes('audio'));
  assert.ok(!Object.keys(mods.registry).includes('vad'), 'vad.js was deleted, must not be referenced');
});

test('load() rejects for unknown module name', async () => {
  const { load } = mods;
  await assert.rejects(load('nope'), /Unknown module/);
});

test('импорт реестра не грузит реализации модулей (ленивость)', async () => {
  const loaded = [];
  const hook = registerHooks({
    load(url, context, nextLoad) {
      loaded.push(url);
      return nextLoad(url, context);
    },
  });
  try {
    // Строка запроса обязательна: реестр уже импортирован статически выше и
    // лежит в кэше модулей, а хук видит только НОВЫЕ загрузки. `?lazy-probe`
    // даёт свежий инстанс, за загрузкой которого хук и наблюдает.
    await import('../src/modules/index.js?lazy-probe');
  } finally {
    hook.deregister();
  }
  const paths = loaded.map((u) => u.replace(/\\/g, '/'));
  assert.ok(paths.some((p) => p.includes('src/modules/index.js')),
    'хук обязан увидеть сам реестр — иначе тест ничего не проверяет');
  assert.ok(!paths.some((p) => p.includes('src/modules/tts')), 'tts (sherpa-onnx) must not load eagerly');
  assert.ok(!paths.some((p) => p.includes('src/modules/midi')), 'midi must not load eagerly');
});
