const config = require("./config");
const { load: loadModule } = require('./modules');
const os = require("os");
const fs = require("fs");
const path = require("path");
const { settingsDir, resolveUserDataFile } = require("./paths");
const isWindows = os.platform() === 'win32';

let windowsLogger;
if (isWindows) {
  const EventLogger = require('node-windows').EventLogger;
  windowsLogger = new EventLogger('windows-mqtt');
}

// Persistent on-disk log. In Tauri bridge mode console output only reaches the
// webview and is lost when the app dies, so crashes left no trace. This file
// survives the process — uncaughtException/unhandledRejection stacks land here.
const LOG_MAX_BYTES = 5 * 1024 * 1024;
let logFilePath;
function getLogFilePath() {
  if (logFilePath === undefined) {
    // Honor the documented `log.path` config key; relative paths resolve into
    // the writable settings dir. Fall back to the default settings-dir file.
    const configured = config.log && config.log.path;
    logFilePath = configured
      ? resolveUserDataFile(configured)
      : settingsDir('windows-mqtt.log');
    try {
      fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    } catch {
      logFilePath = null; // disable file logging if the dir can't be created
    }
  }
  return logFilePath;
}

function stringifyMsg(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function writeToLogFile(line) {
  if (config.log && config.log.enabled === false) return;
  const file = getLogFilePath();
  if (!file) return;
  try {
    // Rotate to a single .1 backup once the log grows past the cap. Windows
    // renameSync fails if the target exists, so drop the old backup first.
    try {
      const { size } = fs.statSync(file);
      if (size > LOG_MAX_BYTES) {
        try { fs.rmSync(file + '.1', { force: true }); } catch {}
        fs.renameSync(file, file + '.1');
      }
    } catch {
      // File doesn't exist yet — nothing to rotate.
    }
    fs.appendFileSync(file, line + '\n');
  } catch {
    // Never let logging crash the process.
  }
}

function log(msg, logLevel = 'info') {
  const logLevels = ['debug',  'info', 'warn', 'error'];
  const currentLogLevel = logLevels.indexOf(config.debug ? 'debug' : (config.logLevel || 'info'));
  const messageLogLevel = logLevels.indexOf(logLevel);

  if (messageLogLevel >= currentLogLevel) {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
    const d = new Date(Date.now() - tzoffset).
    toISOString().
    replace(/T/, ' ').      // replace T with a space
      replace(/\..+/, '')     // delete the dot and everything after

    console[logLevel](`${d} ${msg}`);
    // Full timestamp with ms + level tag on disk for crash forensics.
    const fileTs = new Date(Date.now() - tzoffset).toISOString().replace(/T/, ' ').replace(/Z$/, '');
    writeToLogFile(`${fileTs} [${logLevel}] ${stringifyMsg(msg)}`);
  }

  if (isWindows && process.env.NODE_ENV === 'production') {
    // EventLogger has info/warn/error only — map debug to info
    const method = logLevel === 'debug' ? 'info' : logLevel;
    if (typeof windowsLogger[method] === 'function') windowsLogger[method](msg);
  }
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
      const mod = loadModule(name);

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
