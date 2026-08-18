// Lazy module registry: a module's import() runs only when the module is
// enabled in config, so one broken/missing native dep can't kill the server.
const registry = {
  audio: './audio.js',
  clipboard: './clipboard.js',
  commands: './commands.js',
  dirwatch: './dirwatch.js',
  exec: './exec.js',
  filewatch: './filewatch.js',
  gpt: './gpt.js',
  keys: './keys.js',
  midi: './midi.js',
  mouse: './mouse.js',
  notify: './notify.js',
  obs: './obs.js',
  power: './power.js',
  reaper: './reaper.js',
  tabs: './tabs.js',
  tts: './tts.js',
};

async function load(name) {
  const modulePath = registry[name];
  if (!modulePath) throw new Error(`Unknown module: ${name}`);
  return (await import(modulePath)).default;
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

export { registry, load, isEnabled };
