import { config } from './config.js';
import { log, getModulesEnabled, initModules } from './helpers.js';
// stdin-handler экспортирует { init, register }, а server.js зовёт их через
// точку (stdinHandler.register(...), пять мест) — нужен именно импорт
// пространства имён, а не дефолтный.
import * as stdinHandler from './stdin-handler.js';
import { buildTrayRelayActions } from './tray-relay.js';
import { startMonitor } from './monitor.js';

const isTauriBridge = process.env.TAURI_BRIDGE === '1';
// Транспорт выбирается по рантайм-флагу: статический импорт обоих загрузил бы
// неиспользуемый. Top-level await здесь намеренный, а не случайно уцелевший.
const { mqttInit } = await import(isTauriBridge ? './mqtt-bridge.js' : './mqtt.js');

let mqtt; // global object
let modules; // global object
let messageHandler = null;
let monitor = null;

async function cleanup() {
  log('Cleaning up resources...');

  if (monitor) {
    monitor.stop();
    monitor = null;
  }

  // Stop all modules
  if (modules) {
    for (const mod of modules) {
      if (typeof mod.onStop === 'function') {
        try {
          mod.onStop();
        } catch (e) {
          log(`Error stopping module ${mod.name}: ${e.message}`, 'error');
        }
      }
    }
  }

  // Close MQTT connection
  if (mqtt) {
    if (messageHandler) {
      mqtt.removeListener('message', messageHandler);
      messageHandler = null;
    }
    try {
      mqtt.end(true); // Force close
    } catch (e) {
      // Ignore errors if already closed
    }
    mqtt = null;
  }

  log('Cleanup complete');
}

async function start() {
  log('windows-mqtt started');

  // Setup exit handlers for cleanup
  process.on('SIGINT', async () => {
    log("Caught interrupt signal");
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    log("Caught termination signal");
    await cleanup();
    process.exit(0);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', function (err) {
    // Logging a dead-pipe error writes to the same dead pipe and loops forever
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) return;
    log('An uncaught error occurred!', 'error');
    log(err.stack, 'error');
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', function (reason, promise) {
    log('Unhandled Rejection at:', 'error');
    log(reason, 'error');
  });

  try {
    mqtt = mqttInit({}); // global set

    // Bridge mode: stdin closing means the parent Tauri process is gone.
    // Without this the orphan keeps polling forever with no way to communicate.
    if (isTauriBridge) {
      mqtt.on('close', async () => {
        log('stdin closed, parent process is gone — shutting down');
        await cleanup();
        process.exit(0);
      });
    }

    const modulesEnabled = getModulesEnabled();

    modules = await initModules(modulesEnabled, mqtt);

    // Пункты трея по управлению окнами исполняет windows11-manager по MQTT —
    // регистрируются первыми, чтобы модуль со своим stdinActions мог перебить
    // любое из этих действий, а не наоборот. См. src/tray-relay.js.
    stdinHandler.register(buildTrayRelayActions(mqtt, config.mqtt.base, log));

    // Register stdin actions from modules (for Tauri tray commands)
    for (const mod of modules) {
      if (mod.stdinActions) {
        stdinHandler.register(mod.stdinActions);
      }
    }
    // Register global stdin actions (reconnect only in standalone mode)
    if (!isTauriBridge) {
      stdinHandler.register({
        'reconnect': async () => {
          if (mqtt) {
            if (messageHandler) {
              mqtt.removeListener('message', messageHandler);
              messageHandler = null;
            }
            mqtt.end(true);
          }
          mqtt = mqttInit({});
          subscribeToModuleTopics(modules);
          listenModulesMQTT(modules);
        }
      });
    }
    // Graceful shutdown requested by Tauri before it kills the child —
    // lets module onStop handlers close watchers/intervals/sockets.
    stdinHandler.register({
      'app/shutdown': async () => {
        await cleanup();
        process.exit(0);
      }
    });
    stdinHandler.init(isTauriBridge ? mqtt : undefined);

    subscribeToModuleTopics(modules);

    listenModulesMQTT(modules);

    monitor = startMonitor({ mqtt, log, config });
  }
  catch (e) {
    log(e.message, 'error');
    log(e.stack, 'error');
  }
}

function listenModulesMQTT(modules) {
  // Remove existing message handler if any
  if (messageHandler) {
    mqtt.removeListener('message', messageHandler);
  }

  // Create new message handler
  messageHandler = async (topic, message) => {
    const handler = getHandler(topic, modules);
    if (!handler) {
      log(`Cannot find handler for topic ${topic}`, 'warn');
      return;
    }
    // log(`< ${topic}: ${message}`);
    handler(topic, message);
  };

  mqtt.on('message', messageHandler);
}

function subscribeToModuleTopics(modules) {
  let topics = [];
  for (let mod of modules) {
    const modTopics = mod.subscriptions?.map(sub => Array.isArray(sub.topics) ? sub.topics : [sub.topics]).flat() || [];
    topics = [...topics, ...modTopics];
  }
  const allTopics = topics.flat();
  log(`Subscribe to ${allTopics.length} topics`)
  log(`${allTopics.map(t => `- ${t}`).join('\n')}`, 'debug');
  mqtt.subscribe(topics.flat());
}

function getHandler(topic, modules) {
  let handler;
  for (let mod of modules) {
    const sub = mod.subscriptions?.find(sub => sub.topics.includes(topic))
    if (sub) handler = sub.handler;
  }
  return handler;
}

export { start, cleanup };
