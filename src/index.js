const {mqttInit} = require('./mqtt');
const config = require('./config');
const SysTray = require('systray2').default;
const os = require('os');
const isWindows = os.platform() == 'win32';
let windowsLogger;
if (isWindows) {
  const EventLogger = require('node-windows').EventLogger;
  windowsLogger = new EventLogger('windows-mqtt');

  const {showConsole, hideConsole} = require('node-hide-console-window');
}

let mqtt; // global object
let systray; // global object

start();




async function start() {
  log('windows-mqtt started');

  mqtt = mqttInit(); // global set

  if (config.systray) {
    initSysTray();
    if (isWindows) hideConsole();
  }

  const modulesEnabled = getModulesEnabled();

  const modules = await initModules(modulesEnabled);

  subscribeToModuleTopics(modules);

  listenModulesMQTT(modules);
}




function log(msg, type = 'info') {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
  const d = new Date(Date.now() - tzoffset).
    toISOString().
    replace(/T/, ' ').      // replace T with a space
    replace(/\..+/, '')     // delete the dot and everything after

  console[type](`${d} ${msg}`);
  if (isWindows && process.env.NODE_ENV == 'production') windowsLogger[type](msg);
  if (isWindows && systray && systray._process) {
    const menu = getSysTrayMenu();
    menu.tooltip = `${d} ${msg}`;

    systray.sendAction({
      type: 'update-menu',
      menu: menu,
    });
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
    const opts = config.modules[name] || {};
    const mod = require('./modules/' + name);

    // default mqtt base
    if (!opts.base)
      opts.base = `${config.mqtt.base}/${name}`;

    log('load module: ' + name);
    const modInited = await mod(mqtt, opts, log);
    modules.push(modInited);
  };
  return modules;
}

function subscribeToModuleTopics(modules) {
  let topics = [];
  for (let mod of modules) {
    const modTopics = mod.subscriptions.map(sub => Array.isArray(sub.topics) ? sub.topics : [sub.topics]).flat();
    topics = [...topics, ...modTopics];
  }
  log(`\nSubscribe to topics:\n- ${topics.flat().join('\n- ')}\n`);
  mqtt.subscribe(topics.flat());
}

function getHandler(topic, modules) {
  let handler;
  for (let mod of modules) {
    const sub = mod.subscriptions.find(sub => sub.topics.includes(topic))
    if (sub) handler = sub.handler;
  }
  return handler;
}

function getSysTrayMenu() {
  const itemReconnect = {
    title: 'Reconnect MQTT',
    enabled: true,
    click() {
      mqtt = mqttInit();
    }
  }

  const itemShowConsole = {
    title: 'Show console',
    enabled: true,
    click() {
      showConsole();
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
    tooltip: 'bb',
    checked: false,
    enabled: true,
    click() {
      systray.kill(true)
    }
  }

  const items = [];
  if (isWindows) {
    items.push(...[itemShowConsole, itemHideConsole]);
  }
  items.push(...[
    itemReconnect,
    itemExit
  ]);

  const menu = {
    // you should use .png icon on macOS/Linux, and .ico format on Windows
    icon: os.platform() === 'win32' ? './assets/trayicon.ico' : './assets/trayicon.png',
    // a template icon is a transparency mask that will appear to be dark in light mode and light in dark mode
    isTemplateIcon: os.platform() === 'darwin',
    title: 'windows-mqtt',
    tooltip: 'windows-mqtt',
    items
  };
  return menu;
}

function initSysTray() {
  const menu = getSysTrayMenu();

  systray = new SysTray({ // global set
    menu: menu,
    debug: false,
    copyDir: false // copy go tray binary to an outside directory, useful for packing tool like pkg.
  })
  
  systray.onClick(action => {
    if (action.item.click != null) {
      action.item.click()
    }
  })
  
  // Systray.ready is a promise which resolves when the tray is ready.
  systray.ready().then(() => {
    console.log('systray started')
  }).catch(err => {
    console.log('systray failed to start: ' + err.message)
  })
}