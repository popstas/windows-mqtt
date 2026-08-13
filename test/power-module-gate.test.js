/**
 * power отвечает на исторической базе ${mqtt.base}/windows, а не заводит
 * свою — это намеренно, не огрызок модуля windows.js (тот целиком уехал в
 * windows11-manager): кнопки, панель и физические выключатели адресованы
 * старому топику windows/restart, и менять его — отдельная работа, которая
 * затрагивает конфиг панели в другом репозитории. Раньше это наследование
 * было частью прощания с одним из двух взаимоисключающих обработчиков
 * (windows.js слушал тот же флаг, что и power); второго обработчика больше
 * нет, `power` — обычный модуль, включённый по умолчанию, но база всё ещё
 * наследуется от windows нарочно, и именно это здесь и проверяется — теперь
 * единственный сторож кнопки перезагрузки на панели.
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

test('power включается по умолчанию даже без единого упоминания modules в конфиге', () => {
  // Живая машина сегодня: windows.js уже уехал, и modules.windows в конфиге
  // может не быть вовсе — power не должен зависеть от его присутствия ни в
  // каком виде.
  const { helpers, config } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
  ]);
  assert.equal(config.modules, undefined, 'секции modules в конфиге нет вовсе');
  const enabled = helpers.getModulesEnabled();
  assert.ok(enabled.includes('power'), 'power включается по умолчанию, без своего ключа и без modules.windows');
});

test('без блока modules.windows power всё равно наследует базу ${mqtt.base}/windows, а не ${mqtt.base}/power', async () => {
  const { helpers } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
  ]);
  const enabled = helpers.getModulesEnabled();
  const modules = await helpers.initModules(enabled, fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.ok(power, 'power должен загрузиться');
  assert.equal(power.base, 'home/room/pc/windows', 'база — историческая windows, не ${mqtt.base}/power');
  assert.ok(
    power.subscriptions.some((s) => s.topics.includes('home/room/pc/windows/restart')),
    'подписка идёт на старый топик windows/restart — на него адресованы кнопки и панель'
  );
});

test('явный modules.windows.base по-прежнему учитывается при наследовании базы power', async () => {
  // modules.windows как блок в конфиге может и не быть, но если он есть —
  // например, у кого-то остался свой override базы — power обязан его
  // уважать, а не молча откатываться на топик по умолчанию. enabled: false
  // здесь — как на живой машине: без него getModulesEnabled() попытался бы
  // ещё и грузить сам windows, которого в реестре модулей больше нет.
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
    '  power:',
    '    base: some/custom/base',
  ]);
  const enabled = helpers.getModulesEnabled();
  const modules = await helpers.initModules(enabled, fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.ok(power);
  assert.equal(power.base, 'some/custom/base');
});

test('config.yml вовсе без секции modules: не роняет getModulesEnabled(), power всё равно включён', () => {
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
  assert.deepEqual(enabled, ['power'], 'без секции modules включён только power — он не требует своего ключа');
});

test('config.yml с modules: без ключа, но с закомментированным телом (config.modules === null) не роняет getModulesEnabled()/initModules(), power всё равно включён', () => {
  // Ловушка тоньше, чем «секции modules нет вовсе»: ключ `modules:` в файле
  // ЕСТЬ, но все его строки — комментарии, и yaml разбирает такое тело в
  // null, а не в undefined. `= {}` в сигнатуре isEnabled() на явный null не
  // срабатывает — default-параметр подставляется только вместо undefined, —
  // и `config.modules[name]` в initModules() падали бы тем же TypeError.
  // Именно эта форма уже используется в живом проекте: блок `power:` в
  // config.example.yml — ключ на месте, тело сплошь из комментариев.
  const { helpers, config } = loadHelpersWithConfig([
    'mqtt:',
    '  base: home/room/pc',
    'modules:',
    '  # power: {}',
  ]);
  assert.equal(config.modules, null, 'ключ modules есть, но тело целиком закомментировано — yaml даёт null');
  assert.doesNotThrow(() => helpers.getModulesEnabled());
  const enabled = helpers.getModulesEnabled();
  assert.deepEqual(enabled, ['power'], 'при null-секции modules включён только power');
  return assert.doesNotReject(() => helpers.initModules(enabled, fakeMqtt));
});

test('config.example.yml: power загружается на исторической базе windows без единого упоминания modules.windows', async () => {
  const { helpers, config } = loadHelpersWithConfig(
    fs.readFileSync(path.join(__dirname, '..', 'config.example.yml'), 'utf8').split('\n')
  );
  assert.equal(config.modules.windows, undefined, 'modules.windows в config.example.yml больше нет вовсе');
  const enabled = helpers.getModulesEnabled();
  assert.ok(enabled.includes('power'));

  // Ловушка наследования базы уже дважды ломала power в этой миграции: пример
  // из config.example.yml должен резолвиться на базу windows
  // (home/room/pc/windows), а не на отдельный ${mqtt.base}/power, хотя блока
  // modules.windows в этом самом файле давно нет.
  //
  // initModules() вызывается только с ['power'], а не с полным `enabled`:
  // config.example.yml включает ещё audio, tabs и другие модули с реальными
  // побочными эффектами (audio заводит setInterval, который не снят и держит
  // процесс живым; tabs слушает порт) — грузить их тут ради проверки одного
  // поля base не нужно, а раньше это вешало `node --test` до внешнего таймаута.
  const modules = await helpers.initModules(['power'], fakeMqtt);
  const power = modules.find((m) => m.name === 'power');
  assert.ok(power, 'power должен загрузиться из config.example.yml');
  assert.equal(power.base, 'home/room/pc/windows', 'база наследуется от исторической windows, а не от ${mqtt.base}/power');
});
