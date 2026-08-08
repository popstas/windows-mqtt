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
  windows: './windows',
};

function load(name) {
  const modulePath = registry[name];
  if (!modulePath) throw new Error(`Unknown module: ${name}`);
  return require(modulePath);
}

/**
 * Грузить ли модуль `name` при данном config.modules.
 *
 * windows и power — два взаимоисключающих обработчика питания за одним
 * флагом windows.enabled: при true (по умолчанию) перезагрузку обслуживает
 * старый windows.js, при false — новый power. У power нет собственного
 * enabled — иначе оба слушали бы windows/restart и отвечали дважды.
 */
function isEnabled(name, modulesConfig = {}) {
  if (name === 'power') return (modulesConfig.windows || {}).enabled === false;
  const mod = modulesConfig[name] || {};
  return mod.enabled !== undefined ? !!mod.enabled : true;
}

module.exports = { registry, load, isEnabled };
