import path from 'path';
import mqtt from 'mqtt';
import { config } from './config.js';
import { connectArgs } from './mqtt-broker.js';
import { resolveAppFile } from './paths.js';

// Безоконный клиент (`npm start`, служба Windows). Под Tauri брокером владеет
// Rust-мост, а node говорит с ним через stdin (src/mqtt-bridge.js).
//
// Негодный mqtt.host / mqtt.ca бросает — server.js ловит и пишет в лог, — а не
// подключается к чему-то другому молча.
function mqttInit({onConnect}) {
  // Относительный mqtt.ca — от каталога config.yml, как и в Rust-мосте.
  const configDir = path.dirname(resolveAppFile('config.yml', 'CONFIG'));
  const { url, options } = connectArgs(config.mqtt, configDir);
  console.log(`Connecting to MQTT ${url}...`);
  const client = mqtt.connect(url, options);

  client.on('connect', () => {
    console.log(`MQTT connected to ${url}`);
    if (typeof onConnect === 'function') onConnect();
  });

  client.on('offline', () => {
    console.log(`MQTT offline (${url})`, 'warn');
  });

  // Отказ TLS (неверный сертификат, чужое имя) mqtt.js сообщает событием
  // error; без слушателя оно уходит в uncaughtException без адреса брокера.
  client.on('error', (err) => {
    console.log(`MQTT error (${url}): ${err.message}`, 'error');
  });

  return client;
}

export {
  mqttInit
};
