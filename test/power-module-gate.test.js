/**
 * windows и power делят один флаг windows.enabled, а не по одному каждый —
 * и это должно работать на нетронутом config.yml, где блока `power:` ещё нет
 * вовсе (он появился только в этой задаче; на живой машине его пока нет).
 *
 * getModulesEnabled()/initModules() читают глобальный src/config.js, а не
 * инжектируемый параметр, поэтому каждый тест подставляет свой config.yml
 * через переменную CONFIG и перечитывает src/config.js и src/helpers.js
 * заново через require.cache — иначе все тесты в файле видели бы конфиг,
 * загруженный первым.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadHelpersWithConfig(yamlLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-power-gate-'));
  const configPath = path.join(dir, 'config.yml');
  fs.writeFileSync(configPath, yamlLines.join('\n') + '\n');

  const prevConfig = process.env.CONFIG;
  process.env.CONFIG = configPath;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/helpers')];
  const helpers = require('../src/helpers');
  const config = require('../src/config');
  if (prevConfig === undefined) delete process.env.CONFIG;
  else process.env.CONFIG = prevConfig;

  return { helpers, config };
}

// Заглушка mqtt-клиента для initModules(): power ничего не публикует и не
// подписывается на реальном брокере при простой загрузке модуля, поэтому
// достаточно пустых методов.
const fakeMqtt = { publish: () => {}, subscribe: () => {}, on: () => {} };

test('старый config.yml без блока power: windows.enabled: false всё равно включает power', () => {
  const { helpers, config } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  windows:',
    '    enabled: false',
  ]);
  assert.ok(!('power' in config.modules), 'в конфиге нет ключа power — так и есть на живой машине сейчас');
  const enabled = helpers.getModulesEnabled();
  assert.ok(enabled.includes('power'), 'power должен включиться по windows.enabled: false, даже без своего ключа');
  assert.ok(!enabled.includes('windows'), 'windows и power не должны работать вместе');
});

test('старый config.yml с windows.enabled: true (или не заданным) power не включает', () => {
  const { helpers } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  windows: {}',
  ]);
  const enabled = helpers.getModulesEnabled();
  assert.ok(enabled.includes('windows'));
  assert.ok(!enabled.includes('power'));
});

test('без своего блока power наследует базу windows, а не ${mqtt.base}/power', async () => {
  const { helpers } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  windows:',
    '    enabled: false',
  ]);
  const enabled = helpers.getModulesEnabled();
  const modules = await helpers.initModules(enabled, fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.ok(power, 'power должен загрузиться');
  assert.equal(power.base, 'home/room/pc/windows', 'база — та же, что была у windows, не ${mqtt.base}/power');
  assert.ok(
    power.subscriptions.some((s) => s.topics.includes('home/room/pc/windows/restart')),
    'подписка идёт на старый топик windows/restart'
  );
});

test('явный windows.base учитывается при наследовании базы power', async () => {
  const { helpers } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  windows:',
    '    enabled: false',
    '    base: custom/windows/base',
  ]);
  const enabled = helpers.getModulesEnabled();
  const modules = await helpers.initModules(enabled, fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.equal(power.base, 'custom/windows/base');
});

test('явный power.base в конфиге не переопределяется базой windows', async () => {
  const { helpers } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  windows:',
    '    enabled: false',
    '  power:',
    '    base: some/custom/base',
  ]);
  const enabled = helpers.getModulesEnabled();
  const modules = await helpers.initModules(enabled, fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.ok(power);
  assert.equal(power.base, 'some/custom/base');
});

test('config.example.yml: windows.enabled: false включает power и выключает windows', () => {
  const { helpers, config } = loadHelpersWithConfig(
    fs.readFileSync(path.join(__dirname, '..', 'config.example.yml'), 'utf8')
      .replace('    enabled: true\n    placeWindowOnOpen: true', '    enabled: false\n    placeWindowOnOpen: true')
      .split('\n')
  );
  assert.equal(config.modules.windows.enabled, false, 'подмена сработала — проверяем нужную ветку');
  const enabled = helpers.getModulesEnabled();
  assert.ok(enabled.includes('power'));
  assert.ok(!enabled.includes('windows'));
});
