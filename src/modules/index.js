// Lazy module registry: a module's require() runs only when the module is
// enabled in config, so one broken/missing native dep can't kill the server.
const registry = {
  audio: './audio',
  clipboard: './clipboard',
  commands: './commands',
  dirwatch: './dirwatch',
  exec: './exec',
  filewatch: './filewatch',
  gpt: './gpt',
  keys: './keys',
  midi: './midi',
  mouse: './mouse',
  notify: './notify',
  obs: './obs',
  power: './power',
  reaper: './reaper',
  tabs: './tabs',
  tts: './tts',
};

function load(name) {
  const modulePath = registry[name];
  if (!modulePath) throw new Error(`Unknown module: ${name}`);
  return require(modulePath);
}

/**
 * Грузить ли модуль `name` при данном config.modules.
 *
 * power раньше делил windows/restart со старым windows.js за флагом
 * windows.enabled — своего enabled ему нарочно не давали, иначе оба слушали
 * бы один топик и отвечали дважды. Второго обработчика больше нет
 * (windows.js уехал в windows11-manager), и power стал обычным модулем со
 * своим enabled, по умолчанию включён.
 */
function isEnabled(name, modulesConfig = {}) {
  const mod = modulesConfig[name] || {};
  return mod.enabled !== undefined ? !!mod.enabled : true;
}

module.exports = { registry, load, isEnabled };
