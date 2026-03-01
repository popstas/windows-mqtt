const isTauriBridge = process.env.TAURI_BRIDGE === '1';
const { mqttInit } = require(isTauriBridge ? './mqtt-bridge' : './mqtt');
const config = require('./config');
const {log, getModulesEnabled, initModules} = require("./helpers");
const stdinHandler = require('./stdin-handler');

let mqtt; // global object
let modules; // global object
let messageHandler = null;

async function cleanup() {
  log('Cleaning up resources...');

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

    const modulesEnabled = getModulesEnabled();

    modules = await initModules(modulesEnabled, mqtt);

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
    stdinHandler.init(isTauriBridge ? mqtt : undefined);

    subscribeToModuleTopics(modules);

    listenModulesMQTT(modules);
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

module.exports = { start, cleanup };
