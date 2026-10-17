import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseBroker, endpoint, connectArgs } from '../src/mqtt-broker.js';

// Тот же набор случаев, что у parse_broker в src-tauri/src/mqtt_bridge.rs:
// config.yml один на оба клиента, и читать его они обязаны одинаково.

const broker = (host, port, tls) => ({ host, port, tls });

test('голый хост — прежний mqtt на 1883', () => {
  assert.deepStrictEqual(parseBroker('broker.example'), broker('broker.example', 1883, false));
});

test('голый хост берёт ключ port — старый конфиг работает как раньше', () => {
  assert.deepStrictEqual(parseBroker('broker.example', 1883), broker('broker.example', 1883, false));
});

test('mqtt:// без порта и с портом', () => {
  assert.deepStrictEqual(parseBroker('mqtt://broker.example'), broker('broker.example', 1883, false));
  assert.deepStrictEqual(parseBroker('mqtt://broker.example:1884'), broker('broker.example', 1884, false));
});

test('голый host:port — прежний mqtt, порт из адреса (как у ccfzf-picker и windows11-manager)', () => {
  assert.deepStrictEqual(parseBroker('broker.example:1884'), broker('broker.example', 1884, false));
  assert.deepStrictEqual(parseBroker('broker.example:1884', 1883), broker('broker.example', 1884, false));
});

test("числовая строка в port (`port: '1883'`) работает как прежде", () => {
  assert.deepStrictEqual(parseBroker('broker.example', '1883'), broker('broker.example', 1883, false));
  assert.deepStrictEqual(parseBroker('mqtts://broker.example', ' 8884 '), broker('broker.example', 8884, true));
});

test('mqtts:// по умолчанию на 8883', () => {
  assert.deepStrictEqual(parseBroker('mqtts://broker.example'), broker('broker.example', 8883, true));
});

test('порт из адреса бьёт ключ port', () => {
  assert.deepStrictEqual(parseBroker('mqtts://broker.example:8884', 1883), broker('broker.example', 8884, true));
});

test('ключ port бьёт умолчание схемы', () => {
  assert.deepStrictEqual(parseBroker('mqtts://broker.example', 9883), broker('broker.example', 9883, true));
});

test('схема без учёта регистра', () => {
  assert.deepStrictEqual(parseBroker('MQTTS://broker.example'), broker('broker.example', 8883, true));
  assert.deepStrictEqual(parseBroker('Mqtt://broker.example'), broker('broker.example', 1883, false));
});

test('завершающий слэш допустим', () => {
  assert.deepStrictEqual(parseBroker('mqtts://broker.example/'), broker('broker.example', 8883, true));
  assert.deepStrictEqual(parseBroker('mqtts://broker.example:8883/'), broker('broker.example', 8883, true));
});

test('пробелы по краям не мешают', () => {
  assert.deepStrictEqual(parseBroker('  mqtts://broker.example  '), broker('broker.example', 8883, true));
});

test('негодные адреса отвергаются', () => {
  for (const bad of [
    'ws://broker.example',
    'http://broker.example',
    'mqtts://user:pass@broker.example',
    'mqtts://broker.example/path',
    'mqtts://broker.example?x=1',
    'mqtts://broker.example#frag',
    'mqtts://broker.example:99999',
    'mqtts://broker.example:0',
    'mqtts://broker.example:abc',
    'mqtts://broker.example:',
    'mqtts://',
    'mqtts:///',
    'mqtts://:8883',
    '',
    '   ',
    'broker.example:',
    'broker.example:99999',
    'broker.example/',
    'user@broker.example',
    'mqtts://broker example',
  ]) {
    assert.throws(() => parseBroker(bad), undefined, `${JSON.stringify(bad)} должен быть отвергнут`);
  }
});

test('нечисловой хост и негодный ключ port отвергаются', () => {
  assert.throws(() => parseBroker(undefined));
  assert.throws(() => parseBroker('broker.example', 0));
  assert.throws(() => parseBroker('broker.example', 70000));
  assert.throws(() => parseBroker('broker.example', 'abc'));
  for (const bad of ['', '0', '70000', '-1', '18 83', '1883.5', 1883.5, -1, [1883], true]) {
    assert.throws(() => parseBroker('broker.example', bad), undefined, `port ${JSON.stringify(bad)} должен быть отвергнут`);
  }
});

test('ошибка не цитирует userinfo — там мог стоять пароль', () => {
  assert.throws(
    () => parseBroker('mqtts://user:s3cret@broker.example'),
    (/** @type {Error} */ e) => !e.message.includes('s3cret'),
  );
});

test('endpoint — scheme://host:port', () => {
  assert.strictEqual(endpoint(broker('broker.example', 8883, true)), 'mqtts://broker.example:8883');
  assert.strictEqual(endpoint(broker('broker.example', 1883, false)), 'mqtt://broker.example:1883');
});

// --- аргументы mqtt.connect ---

const creds = { user: 'u', password: 'p' };

test('голый mqtt: URL с портом, без port в опциях и без ca', () => {
  const missingCa = path.join(os.tmpdir(), 'wmqtt-no-such-ca.pem');
  const { url, options, broker: b } = connectArgs({ host: 'broker.example', port: 1883, ca: missingCa, ...creds });
  assert.strictEqual(url, 'mqtt://broker.example:1883');
  // mqtt.js v4 кладёт опции поверх разобранного URL: port в опциях перебил бы
  // порт из адреса, и правило старшинства сломалось бы молча.
  assert.ok(!('port' in options));
  assert.ok(!('ca' in options));
  assert.strictEqual(options.username, 'u');
  assert.strictEqual(options.password, 'p');
  assert.strictEqual(b.tls, false);
});

test('mqtts без ca: доверие корням Node, ca не передаётся', () => {
  const { url, options } = connectArgs({ host: 'mqtts://broker.example', ...creds });
  assert.strictEqual(url, 'mqtts://broker.example:8883');
  assert.ok(!('ca' in options));
  assert.ok(!('port' in options));
});

test('mqtts с ca: только этот PEM, относительный путь — от каталога конфига', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmqtt-ca-'));
  try {
    const pem = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n';
    fs.writeFileSync(path.join(dir, 'ca.pem'), pem);
    const { options } = connectArgs({ host: 'mqtts://broker.example', ca: 'ca.pem', ...creds }, dir);
    assert.strictEqual(options.ca.length, 1);
    assert.strictEqual(options.ca[0].toString(), pem);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('нечитаемый ca — ошибка, а не откат на корни Node', () => {
  assert.throws(() => connectArgs({ host: 'mqtts://broker.example', ca: '/nonexistent/wmqtt-ca.pem' }));
});

test('ca без PEM-сертификата — ошибка', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmqtt-ca-'));
  try {
    fs.writeFileSync(path.join(dir, 'junk.pem'), 'not a certificate');
    assert.throws(() => connectArgs({ host: 'mqtts://broker.example', ca: 'junk.pem' }, dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
