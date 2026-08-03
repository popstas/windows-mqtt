/**
 * Файловый лог: строка не двоится и не теряется.
 *
 * Спека требует «одна строка через log() оказывается в файле ровно один раз».
 * Проверять это можно только на настоящем helpers.js: тесты счётчика
 * повторного входа проходят и тогда, когда log() забыл обернуть console, и
 * тогда, когда logConsoleLine выходит сразу и в файл не попадает ничего.
 *
 * Лог уводится во временный файл через config.log.path: настоящий лог
 * приложения трогать нельзя.
 */
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-helpers-log-'));
const logPath = path.join(dir, 'test.log');
const configPath = path.join(dir, 'config.yml');
fs.writeFileSync(configPath, [
  'mqtt: {}',
  'modules: {}',
  'logLevel: info',
  'log:',
  `  path: ${JSON.stringify(logPath)}`,
  '',
].join('\n'));
// Читается config-loader'ом через resolveAppFile('config.yml', 'CONFIG'), а
// абсолютный log.path resolveUserDataFile отдаёт как есть.
process.env.CONFIG = configPath;

const helpers = require('../src/helpers');

// Так console выглядит в bridge-режиме (см. src/index.js): каждая строка,
// помимо stderr, уезжает в файловый лог мимо log().
const realConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
const consoleCalls = [];
function installBridgeConsole() {
  consoleCalls.length = 0;
  const write = (level) => (...args) => {
    consoleCalls.push([level, args.join(' ')]);
    helpers.logConsoleLine(level, args.join(' '));
  };
  console.log = write('info');
  console.info = write('info');
  console.warn = write('warn');
  console.error = write('error');
  console.debug = write('debug');
}
function restoreConsole() {
  Object.assign(console, realConsole);
}

after(restoreConsole);

function readLog() {
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

function countLines(needle) {
  return readLog().split('\n').filter(line => line.includes(needle)).length;
}

test('строка через log() попадает в файл ровно один раз', () => {
  installBridgeConsole();
  try {
    helpers.log('маркер-log-один-раз', 'warn');
  } finally {
    restoreConsole();
  }
  // Обе половины сразу: строка ушла в console (то есть в bridge-режиме — в
  // stderr и в файл) и при этом в файле лежит один раз. Без проверки на
  // console «ровно один раз» выполнялось бы и у log(), вовсе не зовущего его.
  assert.strictEqual(consoleCalls.length, 1, JSON.stringify(consoleCalls));
  assert.strictEqual(consoleCalls[0][0], 'warn');
  assert.ok(consoleCalls[0][1].includes('маркер-log-один-раз'), consoleCalls[0][1]);
  assert.strictEqual(countLines('маркер-log-один-раз'), 1, readLog());
  assert.match(readLog(), /\[warn\] маркер-log-один-раз/);
});

test('строка из console мимо log() всё же доезжает до файла', () => {
  installBridgeConsole();
  try {
    console.error('[claude-wt] маркер-из-библиотеки');
  } finally {
    restoreConsole();
  }
  assert.strictEqual(countLines('маркер-из-библиотеки'), 1, readLog());
  assert.match(readLog(), /\[error\] \[claude-wt\] маркер-из-библиотеки/);
});

test('console.debug вне режима отладки в файл не пишется', () => {
  // Иначе весь отладочный вывод любой библиотеки крутит пятимегабайтную
  // ротацию независимо от logLevel.
  installBridgeConsole();
  try {
    console.debug('маркер-отладки');
  } finally {
    restoreConsole();
  }
  assert.strictEqual(countLines('маркер-отладки'), 0, readLog());
});

test('log() уровня ниже порога не пишет ни в консоль, ни в файл', () => {
  let printed = 0;
  const realDebug = console.debug;
  console.debug = () => { printed += 1; };
  try {
    helpers.log('маркер-log-debug', 'debug');
  } finally {
    console.debug = realDebug;
  }
  assert.strictEqual(printed, 0);
  assert.strictEqual(countLines('маркер-log-debug'), 0, readLog());
});
