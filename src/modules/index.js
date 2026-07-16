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

module.exports = { registry, load };
