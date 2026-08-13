/** Чистые помощники filewatch. Без I/O. */

const os = require('node:os');

/**
 * Путь лежит на сетевом ресурсе?
 *
 * UNC (`\\host\share`) виден сразу. Подключённые диски приходится определять
 * иначе: буква сама по себе ничего не говорит, поэтому спрашиваем систему,
 * какие буквы сетевые. Список берётся снаружи, чтобы функция осталась чистой и
 * проверяемой; в бою его отдаёт netUseDrives().
 */
function isNetworkPath(filePath, networkDrives = defaultNetworkDrives()) {
  const p = String(filePath ?? '');
  if (/^\\\\/.test(p) || /^\/\//.test(p)) return true;
  const m = p.match(/^([A-Za-z]):/);
  if (!m) return false;
  return networkDrives.includes(m[1].toUpperCase());
}

// Сетевые буквы кэшируются на время работы процесса: пути в конфиге
// разбираются один раз при старте, а спрашивать систему на каждый файл незачем.
let cached = null;

function defaultNetworkDrives() {
  if (cached) return cached;
  cached = os.platform() === 'win32' ? readNetworkDrives() : [];
  return cached;
}

/**
 * Буквы сетевых дисков по данным Windows.
 *
 * Ошибка тут не повод падать: без списка мы просто не включим опрос там, где он
 * нужен, и получим прежнее поведение.
 */
function readNetworkDrives() {
  try {
    const { execSync } = require('node:child_process');
    const out = execSync(
      'wmic logicaldisk where drivetype=4 get deviceid',
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    return [...out.matchAll(/([A-Z]):/g)].map(m => m[1]);
  } catch {
    return [];
  }
}

module.exports = { isNetworkPath, readNetworkDrives };
