import { config } from "./config.js";
import { load as loadModule, isEnabled as isModuleEnabled } from './modules/index.js';
import os from "os";
import fs from "fs";
import path from "path";
import { settingsDir, resolveUserDataFile } from "./paths.js";
import { rotateFile } from "./log-rotate.js";
import * as reentry from './log-reentry.js';
const isWindows = os.platform() === 'win32';

let windowsLogger;
if (isWindows) {
  const { default: nodeWindows } = await import('node-windows');
  const { EventLogger } = nodeWindows;
  // @types/node-windows описывает только объектную форму, рантайм принимает
  // и строку (node_modules/node-windows/lib/eventlog.js:81).
  windowsLogger = new EventLogger(/** @type {any} */ ('windows-mqtt'));
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
  // Обычный модуль попадает в перебор, только если у него есть свой ключ в
  // config.modules — Object.keys(modulesConfig) и решает, кого вообще
  // проверять. power — исключение: его ключ в старых config.yml может
  // отсутствовать вовсе (до этой задачи такого блока не существовало), а
  // включён он должен быть по умолчанию, как любой модуль без явного
  // enabled: false. Без names.add('power') модуль без ключа в конфиге в
  // Object.keys() не попал бы и isModuleEnabled() для него не вызвался бы
  // никогда — тогда default-true внутри isEnabled() до него просто не
  // доходил бы. Секции `modules:` целиком тоже может не быть (config.modules
  // === undefined), а если ключ `modules:` есть, но всё его тело закомментировано
  // (так уже сделано с `power:` в config.example.yml), yaml даёт config.modules
  // === null — `= {}` в сигнатуре isEnabled() на явный null не срабатывает,
  // default-параметр подставляется только вместо undefined. Раньше `for...in`
  // по undefined/null молча ничего не делал, Object.keys() и любое обращение
  // к свойству на них бросает TypeError, поэтому modulesConfig нормализуем
  // здесь один раз и используем везде ниже вместо сырого config.modules.
  const modulesConfig = config.modules || {};
  const names = new Set(Object.keys(modulesConfig));
  names.add('power');
  for (const name of names) {
    if (isModuleEnabled(name, modulesConfig))
      modulesEnabled.push(name);
  }
  return modulesEnabled;
}

async function initModules(modulesEnabled, mqtt) {
  const modules = [];
  // Та же нормализация null/undefined, что и в getModulesEnabled(): initModules()
  // может быть вызван отдельно (см. тесты), и config.modules[name] на null упал
  // бы раньше, чем цикл дойдёт до первого модуля.
  const modulesConfig = config.modules || {};
  for (let name of modulesEnabled) {
    log('load module: ' + name);

    const opts = modulesConfig[name] || {};

    // default mqtt base
    if (!opts.base) {
      opts.base = name === 'power'
        // power отвечает на исторической базе windows, а не заводит свою, —
        // и это нарочно, не огрызок модуля windows.js (тот уехал в
        // windows11-manager целиком). Кнопки, панель и физические
        // выключатели адресованы ${mqtt.base}/windows/restart; общий шаблон
        // ${mqtt.base}/power молча погасил бы кнопку перезагрузки на панели —
        // эту поломку здесь уже однажды ловили. Сменить адрес — отдельная
        // работа, и она затрагивает конфиг панели в другом репозитории.
        // Явный modules.windows.base в конфиге по-прежнему выигрывает: он
        // может быть задан и без остального блока windows.
        ? (modulesConfig.windows || {}).base || `${config.mqtt.base}/windows`
        : `${config.mqtt.base}/${name}`;
    }

    try {
      const mod = await loadModule(name);

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

export {
  log,
  logConsoleLine,
  getModulesEnabled,
  initModules,
};
