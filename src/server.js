const { mqttInit } = require('./mqtt');
const config = require('./config');
const {log, getModulesEnabled, initModules} = require("./helpers");
const stdinHandler = require('./stdin-handler');

let app, Tray, Menu;

try {
  ({ app, Tray, Menu } = require('electron'));
} catch (error) {
  app = null;
  Tray = null;
  Menu = null;
}

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

async function start({ tray, mainWindow } = {}) {
  log('windows-mqtt started' + (tray ? ', with electron based tray' : ''));

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
    // Register global stdin actions
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
    stdinHandler.init();

    // should be after initModules
    if (tray) {
      initElectronSysTrayMenu(tray, mainWindow, modules);
    }

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

function initElectronSysTrayMenu(tray, mainWindow, modules) {
  const itemsMain = [
    {
      label: 'Show App',
      click: function () {
        mainWindow.show();
      },
    },
    {
      label: 'Modules:',
      type: 'separator',
    },
  ];
  const itemsEnd = [
    {
      label: 'Reconnect MQTT',
      click() {
        // Close old MQTT client
        if (mqtt) {
          if (messageHandler) {
            mqtt.removeListener('message', messageHandler);
            messageHandler = null;
          }
          mqtt.end(true); // Force close
        }
        // Create new MQTT client
        mqtt = mqttInit({});
        // Re-subscribe and re-listen
        subscribeToModuleTopics(modules);
        listenModulesMQTT(modules);
      }
    },
    {
      label: 'Quit',
      click: function () {
        /*if (config.mqtt.self_kill_cmd) {
          mqtt.publish(`${config.mqtt.base}/exec/cmd`, config.mqtt.self_kill_cmd);
          setTimeout(() => { systray.kill(true) }, 1000);
        }
        else {
          systray.kill(true);
        }*/
        app.isQuiting = true;
        app.quit();
      },
    },
  ];

  const itemsModules = [];
  if (modules) {
    for (let mod of modules) {
      const isCanStop = typeof mod.onStop === 'function' && typeof mod.onStart === 'function';
      mod.enabled = mod.enabled !== undefined ? !!mod.enabled : true;
      const item = {
        label: mod.name,
        type: 'checkbox',
        enabled: isCanStop,
        checked: mod.enabled,
        click() {
          mod.enabled = !mod.enabled;
          this.checked = mod.enabled;

          if (mod.enabled) {
            mod.onStart();
          } else {
            mod.onStop();
          }
        }
      };
      itemsModules.push(item);
    }

    // modules menu items
    for (let mod of modules.filter(m => !!m.menuItems)) {
      itemsModules.push({ type: 'separator' }, ...mod.menuItems);
    }
  }

  const menuItems = [
    ...itemsMain,
    ...itemsModules,
    ...itemsEnd,
  ];
  // Invalid template for MenuItem: must have at least one of label, role or type
  const menuItemsInvalid = menuItems.filter(item => !item.label && !item.role && !item.type);
  if (menuItemsInvalid.length) {
    const text = menuItemsInvalid.map(item => item.label || JSON.stringify(item)).join(', ');
    log(`menuItemsInvalid: ${text}`, 'error');;
  }
  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);
}

module.exports = { start, cleanup };