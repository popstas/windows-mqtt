const {mqttInit} = require('./mqtt');
const config = require('./config');
const SysTray = require('systray2').default;
const electron = require('electron');
const {app, BrowserWindow, Tray, Menu} = electron;
const os = require('os');
const path = require('path');
const fs = require('fs');
const isWindows = os.platform() === 'win32';
let windowsLogger;
let showConsole, hideConsole;
if (isWindows) {
  const EventLogger = require('node-windows').EventLogger;
  windowsLogger = new EventLogger('windows-mqtt');

  // const lib = require('node-hide-console-window');
  // showConsole = lib.showConsole;
  // hideConsole = lib.hideConsole;
}

let mqtt; // global object
let systray; // global object
let modules; // global object

let mainWindow;
let tray;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // Start the app hidden
    webPreferences: {
      nodeIntegration: true,
    },
  });

  mainWindow.loadFile('../index.html');

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function createTray(modules) {
  const filename = os.platform() === 'win32' ? 'trayicon.ico' : 'trayicon.png';
  const iconPath = path.join(__dirname, '..', 'assets', filename);
  tray = new Tray(iconPath); // Path to your tray icon
  tray.setToolTip('windows-mqtt');

  const itemsMain = [
    {
      label: 'Show App',
      click: function () {
        mainWindow.show();
      },
    },
    /*{
      label: 'Modules:',
      type: 'separator',
    },*/
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
        app.isQuiting = true;
        app.quit();
      },
    },
  ];

  const itemsModules = [];
  console.log("modules:", modules);
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
      itemsModules.push({type: 'separator'}, ...mod.menuItems);
    }
  }

  const contextMenu = Menu.buildFromTemplate([
    ...itemsMain,
    ...itemsModules,
    ...itemsEnd,
  ]);
  console.log("contextMenu:", contextMenu);
  tray.setContextMenu(contextMenu);

  tray.on('click', function () {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
    }
  });
}

// start();
void start();

async function startElectron(modules) {
  console.log("startElectron:");
  app.on('ready', () => {
    createTray(modules);
    createWindow();

    mainWindow.on('minimize', (event) => {
      event.preventDefault();
      mainWindow.hide();
    });

    mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        mainWindow.hide();
      }

      return false;
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });

}

async function start() {
  log('windows-mqtt started');
  if (isWindows && config.systray && hideConsole) hideConsole();

  // exit on signal, TODO:
  /*process.on('SIGINT', function() {
    log("Caught interrupt signal");
    process.exit();
  });*/

  try {
    mqtt = mqttInit({}); // global set

    const modulesEnabled = getModulesEnabled();

    modules = await initModules(modulesEnabled); // TODO: uncomment

    // should be after initModules
    if (config.systray) {
      // if (config.electron) await startElectron(modulesEnabled.map((el) => ({name: el})));
      if (config.electron) await startElectron(modules);
      else initSysTray(modules);
    }

    subscribeToModuleTopics(modules);

    listenModulesMQTT(modules);
  } catch (e) {
    log(e.message, 'error');
    log(e.stack, 'error');
  }
}


process.on('uncaughtException', function (err) {
  log('An uncaught error occurred!', 'error');
  log(err.stack, 'error');
});

function log(msg, type = 'info') {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
  const d = new Date(Date.now() - tzoffset).toISOString().replace(/T/, ' ').      // replace T with a space
    replace(/\..+/, '')     // delete the dot and everything after

  console[type](`${d} ${msg}`);
  if (isWindows && process.env.NODE_ENV === 'production') windowsLogger[type](msg);
  if (isWindows && systray && systray._process) {
    const menu = getSysTrayMenu(modules);
    menu.tooltip = `${d} ${msg}`;

    systray.sendAction({
      type: 'update-menu',
      menu: menu,
    });
  }

  if (config.log && config.log.path) {
    fs.appendFileSync(config.log.path, `${d} [${type}] ${msg}\n`);
  }
}

function listenModulesMQTT(modules) {
  mqtt.on('message', async (topic, message) => {
    const handler = getHandler(topic, modules);
    if (!handler) {
      log(`Cannot find handler for topic ${topic}`);
      return;
    }
    // log(`< ${topic}: ${message}`);
    handler(topic, message);
  });
}

function getModulesEnabled() {
  const modulesEnabled = [];
  for (let name in config.modules) {
    const mod = config.modules[name];
    const isEnabled = mod.enabled !== undefined ? !!mod.enabled : true;
    if (isEnabled)
      modulesEnabled.push(name);
  }
  return modulesEnabled;
}

async function initModules(modulesEnabled) {
  const modules = [];
  for (let name of modulesEnabled) {
    log('load module: ' + name);

    const opts = config.modules[name] || {};

    // default mqtt base
    if (!opts.base)
      opts.base = `${config.mqtt.base}/${name}`;

    try {
      const mod = require('./modules/' + name);

      const modInited = {
        ...{
          name: name,
        },
        ...opts,
        ...await mod(mqtt, opts, log),
      };
      modules.push(modInited);
    } catch (e) {
      log(`Failed to load module ${name}`);
      log(e.message);
      if (config.debug) log(e.stack);
    }
  }
  return modules;
}

function subscribeToModuleTopics(modules) {
  let topics = [];
  if (modules) for (let mod of modules) {
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

function getSysTrayMenu(modules = []) {
  const itemReconnect = {
    title: 'Reconnect MQTT',
    enabled: true,
    click() {
      mqtt = mqttInit({});
    }
  }

  const itemShowConsole = {
    title: 'Show console',
    enabled: true,
    click() {
      if (showConsole) showConsole();
    }
  }

  const itemHideConsole = {
    title: 'Hide console',
    enabled: true,
    click() {
      hideConsole();
    }
  }

  const itemExit = {
    title: 'Exit',
    tooltip: '',
    checked: false,
    enabled: true,
    click() {
      if (config.mqtt.self_kill_cmd) {
        mqtt.publish(`${config.mqtt.base}/exec/cmd`, config.mqtt.self_kill_cmd);
        setTimeout(() => {
          systray.kill(true)
        }, 1000);
      } else {
        systray.kill(true);
      }
    }
  }

  const items = [];

  // modules switches
  items.push({
    title: 'Modules:',
    enabled: false,
    tooltip: '',
  });
  for (let mod of modules) {
    const isCanStop = typeof mod.onStop === 'function' && typeof mod.onStart === 'function';
    mod.enabled = mod.enabled !== undefined ? !!mod.enabled : true;
    const item = {
      title: mod.name,
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
    items.push(item);
  }

  if (isWindows) {
    items.push(SysTray.separator);
    items.push(...[itemShowConsole, itemHideConsole]);
  }

  // modules menu items
  for (let mod of modules.filter(m => !!m.menuItems)) {
    items.push(SysTray.separator, ...mod.menuItems);
  }

  items.push(...[
    SysTray.separator,
    itemReconnect,
    itemExit
  ]);


  return {
    // you should use .png icon on macOS/Linux, and .ico format on Windows
    icon: os.platform() === 'win32' ? './assets/trayicon.ico' : './assets/trayicon.png',
    // a template icon is a transparency mask that will appear to be dark in light mode and light in dark mode
    isTemplateIcon: os.platform() === 'darwin',
    title: 'windows-mqtt',
    tooltip: 'windows-mqtt',
    items
  };
}

function initSysTray(modules) {
  const menu = getSysTrayMenu(modules);

  systray = new SysTray({ // global set
    menu: menu,
    debug: false, //!!config.debug,
    copyDir: false // copy go tray binary to an outside directory, useful for packing tool like pkg.
  })

  systray.onClick(action => {
    if (action.item.click != null) {
      action.item.click();

      // update menu for modules checkboxes
      systray.sendAction({
        type: 'update-item',
        item: action.item,
      });
    }
  })

  // Systray.ready is a promise which resolves when the tray is ready.
  systray.ready().then(() => {
    console.log('systray started')
  }).catch(err => {
    console.log('systray failed to start: ' + err.message)
  })
}