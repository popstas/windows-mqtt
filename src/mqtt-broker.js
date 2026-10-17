import fs from 'fs';
import path from 'path';

// Адрес брокера из mqtt.host / mqtt.port / mqtt.ca.
//
// Правило общее для трёх репозиториев связки (ccfzf-picker, windows11-manager,
// windows-mqtt) и для двух клиентов здесь: этого, безоконного (`npm start`,
// служба Windows), и Rust-моста Tauri (`parse_broker` в
// src-tauri/src/mqtt_bridge.rs). config.yml у них один — разбирать его они
// обязаны одинаково, и тесты у них один и тот же набор случаев.
//
// `mqtt.host` — голый хост, `mqtt://h[:port][/]` или `mqtts://h[:port][/]`.
// TLS — только при схеме mqtts, голый хост остаётся прежним mqtt. Порт:
// из адреса > ключ `mqtt.port` > умолчание схемы. Всё прочее — ошибка конфига,
// а не догадка: подключиться не туда хуже, чем не подключиться.

const PLAIN_PORT = 1883;
const TLS_PORT = 8883;
const PEM_CERT = '-----BEGIN CERTIFICATE-----';

/**
 * @typedef {{ host: string, port: number, tls: boolean }} Broker
 */

/** @param {unknown} port */
function validPort(port) {
  return Number.isInteger(port) && /** @type {number} */ (port) >= 1 && /** @type {number} */ (port) <= 65535;
}

/**
 * Разобрать `mqtt.host` и `mqtt.port`. Бросает Error с понятным текстом.
 *
 * Текст ошибки не цитирует исходную строку целиком: в userinfo
 * (`mqtts://user:pass@h`) мог стоять пароль, а ошибка уходит в лог.
 *
 * @param {unknown} raw значение mqtt.host
 * @param {unknown} [portKey] значение mqtt.port
 * @returns {Broker}
 */
function parseBroker(raw, portKey) {
  if (typeof raw !== 'string') throw new Error('mqtt.host: must be a string');
  const trimmed = raw.trim();

  let tls = false;
  let authority = trimmed;
  const hasScheme = trimmed.includes('://');
  if (hasScheme) {
    const idx = trimmed.indexOf('://');
    const scheme = trimmed.slice(0, idx);
    const rest = trimmed.slice(idx + 3);
    switch (scheme.toLowerCase()) {
      case 'mqtt': tls = false; break;
      case 'mqtts': tls = true; break;
      default:
        throw new Error(`mqtt.host: unsupported scheme '${scheme}://', use mqtt:// or mqtts://`);
    }
    authority = rest.endsWith('/') ? rest.slice(0, -1) : rest;
  }

  if (authority.includes('@')) {
    throw new Error('mqtt.host: credentials in the address are not supported, use mqtt.user and mqtt.password');
  }
  const bad = authority.match(/[/?#\s]/);
  if (bad) {
    throw new Error(`mqtt.host: unexpected '${bad[0]}' — the address takes only a host and a port`);
  }

  let host = authority;
  let urlPort;
  const colon = authority.indexOf(':');
  if (colon !== -1) {
    if (!hasScheme) throw new Error('mqtt.host: a port needs a scheme, e.g. mqtt://host:1884');
    host = authority.slice(0, colon);
    const portText = authority.slice(colon + 1);
    const port = /^[0-9]+$/.test(portText) ? Number(portText) : NaN;
    if (!validPort(port)) throw new Error(`mqtt.host: invalid port '${portText}'`);
    urlPort = port;
  }
  if (!host) throw new Error('mqtt.host: empty host');

  let port;
  if (urlPort !== undefined) {
    port = urlPort;
  } else if (portKey !== undefined && portKey !== null) {
    if (!validPort(portKey)) throw new Error(`mqtt.port: ${portKey} is out of range 1..65535`);
    port = /** @type {number} */ (portKey);
  } else {
    port = tls ? TLS_PORT : PLAIN_PORT;
  }

  return { host, port, tls };
}

/**
 * `scheme://host:port` для логов — без логина и пароля.
 * @param {Broker} broker
 */
function endpoint(broker) {
  return `${broker.tls ? 'mqtts' : 'mqtt'}://${broker.host}:${broker.port}`;
}

/**
 * Аргументы для `mqtt.connect(url, options)`.
 *
 * Порт вшивается в URL, а `port` в опции не кладётся: mqtt.js v4 кладёт опции
 * поверх разобранного URL, и `port` оттуда молча перебил бы порт из адреса.
 *
 * `ca` читается только при mqtts; относительный путь — от `baseDir` (каталога
 * config.yml, как и в Rust-мосте). Без `ca` в опции не передаётся ничего:
 * вшитые в Node корни Mozilla уже содержат ISRG Root X1. Нечитаемый `ca` —
 * ошибка, а не тихий откат на них.
 *
 * @param {Record<string, any>} mqttConfig секция mqtt конфига
 * @param {string} [baseDir]
 * @returns {{ url: string, options: Record<string, any>, broker: Broker }}
 */
function connectArgs(mqttConfig, baseDir = process.cwd()) {
  const broker = parseBroker(mqttConfig.host, mqttConfig.port);
  /** @type {Record<string, any>} */
  const options = {
    username: mqttConfig.user,
    password: mqttConfig.password,
  };

  const ca = typeof mqttConfig.ca === 'string' ? mqttConfig.ca.trim() : '';
  if (broker.tls && ca) {
    const caPath = path.resolve(baseDir, ca);
    let pem;
    try {
      pem = fs.readFileSync(caPath);
    } catch (e) {
      throw new Error(`mqtt.ca: cannot read ${caPath}: ${e.message}`);
    }
    if (!pem.includes(PEM_CERT)) throw new Error(`mqtt.ca: ${caPath} has no PEM certificate`);
    options.ca = [pem];
  }

  return { url: endpoint(broker), options, broker };
}

export { parseBroker, endpoint, connectArgs };
