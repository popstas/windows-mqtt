const config = require("./config");
const { load: loadModule, isEnabled: isModuleEnabled } = require('./modules');
const os = require("os");
const fs = require("fs");
const path = require("path");
const { settingsDir, resolveUserDataFile } = require("./paths");
const { rotateFile } = require("./log-rotate");
const reentry = require('./log-reentry');
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
    // Rotate to a single .1 backup once the log grows past the cap. Report
    // failures via console.warn (not log()) to avoid recursing back here.
    rotateFile(file, LOG_MAX_BYTES, (m) => console.warn(m));
    fs.appendFileSync(file, line + '\n');
  } catch {
    // Never let logging crash the process.
  }
}

/**
 * Собрать строку для файлового лога: таймстамп + уровень + сообщение.
 * `now` по умолчанию — свежий Date.now(), но log() передаёт свой момент явно,
 * чтобы строка в консоли и строка в файле описывали один и тот же момент,
 * а не два отдельных вызова Date.now().
 */
function fileLine(level, msg, now = Date.now()) {
  const tzoffset = (new Date(now)).getTimezoneOffset() * 60000; //offset in milliseconds
  const local = new Date(now - tzoffset).toISOString();
  // Full timestamp with ms + level tag on disk for crash forensics.
  const fileTs = local.replace(/T/, ' ').replace(/Z$/, '');
  return `${fileTs} [${level}] ${stringifyMsg(msg)}`;
}

/**
 * Проходит ли строка этого уровня текущий порог.
 *
 * Один порог на оба входа в файл: строка из console идёт мимо log(), но
 * оседает в том же пятимегабайтном файле, и без общей проверки весь
 * console.debug приложения попадал туда независимо от logLevel.
 */
function passesLogLevel(level) {
  const logLevels = ['debug', 'info', 'warn', 'error'];
  const currentLogLevel = logLevels.indexOf(config.debug ? 'debug' : (config.logLevel || 'info'));
  return logLevels.indexOf(level) >= currentLogLevel;
}

function log(msg, logLevel = 'info') {
  if (passesLogLevel(logLevel)) {
    // Compute the instant once so console and file timestamps can't drift.
    const now = Date.now();
    const tzoffset = (new Date(now)).getTimezoneOffset() * 60000; //offset in milliseconds
    const local = new Date(now - tzoffset).toISOString();
    const d = local.
    replace(/T/, ' ').      // replace T with a space
      replace(/\..+/, '')     // delete the dot and everything after

    // Под защитой целиком: console отсюда уходит в stderrWrite, который теперь
    // тоже пишет в файл, а writeToLogFile при сбое ротации зовёт console.warn.
    reentry.run(() => {
      console[logLevel](`${d} ${msg}`);
      writeToLogFile(fileLine(logLevel, msg, now));
    });
  }

  if (isWindows && process.env.NODE_ENV === 'production') {
    // EventLogger has info/warn/error only — map debug to info
    const method = logLevel === 'debug' ? 'info' : logLevel;
    if (typeof windowsLogger[method] === 'function') windowsLogger[method](msg);
  }
}

/**
 * Строка, пришедшая из console мимо log(), — в файловый лог.
 *
 * Console в bridge-режиме переопределён на запись в stderr, откуда её забирает
 * Rust и показывает в server-log окна приложения. В файл она не попадала
 * никогда, и `[claude-wt] tick failed: …` вместе со всей диагностикой
 * библиотеки терялась вместе с закрытым окном.
 *
 * Порог тот же, что у log(): иначе console.debug из любой библиотеки крутил бы
 * ротацию файла вне зависимости от logLevel.
 */
function logConsoleLine(level, msg) {
  if (reentry.isInside()) return;
  if (!passesLogLevel(level)) return;
  reentry.run(() => {
    writeToLogFile(fileLine(level, msg));
  });
}

function getModulesEnabled() {
  const modulesEnabled = [];
  // power не заводит собственного ключа в старых config.yml — до этой задачи
  // такого блока не существовало. Включает его флаг windows.enabled, а не
  // собственная запись, поэтому проверить нужно и тогда, когда ключа power в
  // конфиге вообще нет — иначе на нетронутом config.yml флаг молча ничего не
  // переключает.
  const names = new Set(Object.keys(config.modules));
  names.add('power');
  for (const name of names) {
    if (isModuleEnabled(name, config.modules))
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
    if (!opts.base) {
      opts.base = name === 'power'
        // power продолжает топики windows, а не заводит свои: кнопки, панель
        // и физические выключатели адресованы старой базе, и после флага она
        // не должна смениться. Общий шаблон ${mqtt.base}/power дал бы другой
        // топик — ту самую поломку, которую однажды уже поймали здесь.
        ? (config.modules.windows || {}).base || `${config.mqtt.base}/windows`
        : `${config.mqtt.base}/${name}`;
    }

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
  logConsoleLine,
  getModulesEnabled,
  initModules,
};
