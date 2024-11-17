const config = require("./config");
const fs = require("fs");
const os = require("os");
const isWindows = os.platform() === 'win32';
const electronLog = require('electron-log');

let windowsLogger;
if (isWindows) {
  const EventLogger = require('node-windows').EventLogger;
  windowsLogger = new EventLogger('windows-mqtt');
}

if (config.log && config.log.path) {
  electronLog.transports.file.resolvePathFn = () => config.log.path;
  electronLog.transports.console.format = '{y}-{m}-{d} {h}:{i}:{s} {text}';
}

function log(msg, logLevel = 'info') {
  const logLevels = ['debug',  'info', 'warn', 'error'];
  const currentLogLevel = logLevels.indexOf(config.debug ? 'debug' : (config.logLevel || 'info'));
  const messageLogLevel = logLevels.indexOf(logLevel);

  if (messageLogLevel >= currentLogLevel) {
    if (electronLog) {
      electronLog[logLevel](msg);
    }
    else {
      const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
      const d = new Date(Date.now() - tzoffset).
      toISOString().
      replace(/T/, ' ').      // replace T with a space
        replace(/\..+/, '')     // delete the dot and everything after
      console[logLevel](`${d} ${msg}`);
    }
  }

  if (isWindows && process.env.NODE_ENV === 'production') {
    windowsLogger[logLevel](msg);
  }

  /* if (config.log && config.log.path) {
    fs.appendFileSync(config.log.path, `${d} [${logLevel}] ${msg}\n`);
  } */
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

async function initModules(modulesEnabled, mqtt) {
  const modules = [];
  for (let name of modulesEnabled) {
    log('load module: ' + name);

    const opts = config.modules[name] || {};

    // default mqtt base
    if (!opts.base)
      opts.base = `${config.mqtt.base}/${name}`;

    try {
      const mod = require('./modules/' + name);

      const modInited = {
        ...{
          name: name,
        },
        ...opts,
        ...await mod(mqtt, opts, log),
      };
      modules.push(modInited);
    } catch (e) {
      log(`Failed to load module ${name}`, 'error');
      if (!config.debug) log(e.message, 'error');
      if (config.debug) log(e.stack, 'error');
    }
  }
  return modules;
}

module.exports = {
  log,
  getModulesEnabled,
  initModules,
};