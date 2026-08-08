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

test('config.yml вовсе без секции modules: не роняет getModulesEnabled()', () => {
  // Object.keys(config.modules) бросал TypeError, когда config.modules ===
  // undefined (секции `modules:` в файле нет вовсе). Раньше на её месте стоял
  // `for...in`, который на undefined молча не делал ничего, — регрессия
  // именно в этом переходе.
  const { helpers, config } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
  ]);
  assert.equal(config.modules, undefined, 'секции modules в конфиге действительно нет');
  assert.doesNotThrow(() => helpers.getModulesEnabled());
  const enabled = helpers.getModulesEnabled();
  assert.deepEqual(enabled, [], 'без секции modules ничего, включая power, не включается');
});

test('config.yml с modules: без ключа, но с закомментированным телом (config.modules === null) не роняет getModulesEnabled()/initModules()', () => {
  // Ловушка тоньше, чем «секции modules нет вовсе»: ключ `modules:` в файле
  // ЕСТЬ, но все его строки — комментарии, и yaml разбирает такое тело в
  // null, а не в undefined. `= {}` в сигнатуре isEnabled() на явный null не
  // срабатывает — default-параметр подставляется только вместо undefined, —
  // и `config.modules[name]`/`config.modules.windows` в initModules() падали
  // бы тем же TypeError. Именно эта форма уже используется в живом проекте:
  // блок `power:` в config.example.yml — ключ на месте, тело сплошь из
  // комментариев.
  const { helpers, config } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  # windows: {}',
  ]);
  assert.equal(config.modules, null, 'ключ modules есть, но тело целиком закомментировано — yaml даёт null');
  assert.doesNotThrow(() => helpers.getModulesEnabled());
  const enabled = helpers.getModulesEnabled();
  assert.deepEqual(enabled, [], 'при null-секции modules ничего, включая power, не включается');
  return assert.doesNotReject(() => helpers.initModules(enabled, fakeMqtt));
});

test('config.example.yml: windows.enabled: false включает power и выключает windows', async () => {
  const { helpers, config } = loadHelpersWithConfig(
    fs.readFileSync(path.join(__dirname, '..', 'config.example.yml'), 'utf8')
      .replace('    enabled: true\n    placeWindowOnOpen: true', '    enabled: false\n    placeWindowOnOpen: true')
      .split('\n')
  );
  assert.equal(config.modules.windows.enabled, false, 'подмена сработала — проверяем нужную ветку');
  const enabled = helpers.getModulesEnabled();
  assert.ok(enabled.includes('power'));
  assert.ok(!enabled.includes('windows'));

  // Ловушка наследования базы уже дважды ломала power в этой миграции: пример
  // из config.example.yml должен резолвиться на базу windows
  // (home/room/pc/windows), а не на отдельный ${mqtt.base}/power.
  //
  // initModules() вызывается только с ['power'], а не с полным `enabled`:
  // config.example.yml включает ещё audio, tabs и другие модули с реальными
  // побочными эффектами (audio заводит setInterval, который не снят и держит
  // процесс живым; tabs слушает порт) — грузить их тут ради проверки одного
  // поля base не нужно, а раньше это вешало `node --test` до внешнего таймаута.
  const modules = await helpers.initModules(['power'], fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.ok(power, 'power должен загрузиться из config.example.yml');
  assert.equal(power.base, 'home/room/pc/windows', 'база наследуется от windows, а не от ${mqtt.base}/power');
});
