const mqtt = require('./mqtt');
const config = require('./config');

const os = require('os');
const isWindows = os.platform == 'win32';
let windowsLogger;
if (isWindows) {
  const EventLogger = require('node-windows').EventLogger;
  windowsLogger = new EventLogger('windows-mqtt');
}

start();

function log(msg, type = 'info') {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
  const d = new Date(Date.now() - tzoffset).
    toISOString().
    replace(/T/, ' ').      // replace T with a space
    replace(/\..+/, '')     // delete the dot and everything after

  console[type](`${d} ${msg}`);
  if (isWindows && process.env.NODE_ENV == 'production') windowsLogger[type](msg);
}

async function start() {
  log('windows-mqtt started');

  const modulesEnabled = getModulesEnabled();

  const modules = await initModules(modulesEnabled);

  subscribeToModuleTopics(modules);

  listenModulesMQTT(modules);
}

function listenModulesMQTT(modules) {
  mqtt.on('message', async (topic, message) => {
    const handler = getHandler(topic, modules);
    if (!handler) {
      log(`Cannot find handler for topic ${topic}`);
      return;
    }
    // log(`< ${topic}: ${message}`);
    handler(topic, message);
  });
}

function getModulesEnabled() {
  const modulesEnabled = [];
  for (let name in config.modules) {
    const mod = config.modules[name];
    const isEnabled = mod.enabled !== undefined ? !!mod.enabled : true;
    if (isEnabled)
      modulesEnabled.push(name);
  }
  return modulesEnabled;
}

async function initModules(modulesEnabled) {
  const modules = [];
  for (let name of modulesEnabled) {
    const opts = config.modules[name] || {};
    const mod = require('./modules/' + name);

    // default mqtt base
    if (!opts.base)
      opts.base = `${config.mqtt.base}/${name}`;

    log('load module: ' + name);
    const modInited = await mod(mqtt, opts, log);
    modules.push(modInited);
  };
  return modules;
}

function subscribeToModuleTopics(modules) {
  let topics = [];
  for (let mod of modules) {
    const modTopics = mod.subscriptions.map(sub => Array.isArray(sub.topics) ? sub.topics : [sub.topics]).flat();
    topics = [...topics, ...modTopics];
  }
  log(`\nSubscribe to topics:\n- ${topics.flat().join('\n- ')}\n`);
  mqtt.subscribe(topics.flat());
}

function getHandler(topic, modules) {
  let handler;
  for (let mod of modules) {
    const sub = mod.subscriptions.find(sub => sub.topics.includes(topic))
    if (sub) handler = sub.handler;
  }
  return handler;
}
