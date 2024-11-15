const { mqttInit } = require('./mqtt');
const config = require('./config');
const { app, Tray, Menu } = require('electron');
const {log, getModulesEnabled, initModules} = require("./helpers");

let mqtt; // global object
let modules; // global object

async function start({ tray, mainWindow } = {}) {
  log('windows-mqtt started' + (tray ? ', with electron based tray' : ''));

  // exit on signal, TODO:
  /*process.on('SIGINT', function() {
    log("Caught interrupt signal");
    process.exit();
  });*/

  try {
    mqtt = mqttInit({}); // global set

    const modulesEnabled = getModulesEnabled();

    modules = await initModules(modulesEnabled, mqtt);

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

process.on('uncaughtException', function (err) {
  log('An uncaught error occurred!', 'error');
  log(err.stack, 'error');
});

function listenModulesMQTT(modules) {
  mqtt.on('message', async (topic, message) => {
    const handler = getHandler(topic, modules);
    if (!handler) {
      log(`Cannot find handler for topic ${topic}`, 'warn');
      return;
    }
    // log(`< ${topic}: ${message}`);
    handler(topic, message);
  });
}

function subscribeToModuleTopics(modules) {
  let topics = [];
  for (let mod of modules) {
    const modTopics = mod.subscriptions?.map(sub => Array.isArray(sub.topics) ? sub.topics : [sub.topics]).flat() || [];
    topics = [...topics, ...modTopics];
  }
  log(`\nSubscribe to topics:\n- ${topics.flat().join('\n- ')}\n`);
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
        mqtt = mqttInit({});
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

module.exports = { start };