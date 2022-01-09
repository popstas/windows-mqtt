// module windows-manager not published yet, sorry
const winMan = require('windows-manager');
const globalConfig = require('../config.js');
const {exec} = require('child_process');

if (globalConfig.modules.windows.placeWindowOnOpen) {
  winMan.placeWindowOnOpen({ keepalive: false });
}

module.exports = async (mqtt, config, log) => {

  if (config.restoreOnStart) winMan.restoreWindows();

  async function autoplace(topic, message) {
    log(`< ${topic}: ${message}`);
    const placed = await winMan.placeWindows();

    const msg = `Placed ${placed.length} windows`;
    log(msg);

    // notify
    if (config.notifyPlaced && placed.length > 0) {
      const topic = globalConfig.mqtt.base + '/notify/notify';
      mqtt.publish(topic, msg);
    }
  }

  async function show(topic, message) {
    const title = `${message}`;
    log(`< ${topic}: ${title}`);
    await winMan.showWindow(title);
  }

  // win:active,x:0,y:0,width:mon1.thirdWidth,height:mon1.height
  async function place(topic, message) {
    log(`< ${topic}: ${message}`);
    try {
      const pos = JSON.parse(`${message}`);
      await winMan.placeWindowByConfig(pos);
    }
    catch(e) {
      log('Failed to parse place position json');
      log(e);
    }
  }

  async function store(topic, message) {
    log(`< ${topic}: ${message}`);
    winMan.storeWindows();
  }

  async function restore(topic, message) {
    log(`< ${topic}: ${message}`);
    await winMan.restoreWindows();
  }

  async function clear(topic, message) {
    log(`< ${topic}: ${message}`);
    winMan.clearWindows();
  }

  async function open(topic, message) {
    log(`< ${topic}: ${message}`);
    const store = JSON.parse(`${message}`);
    winMan.openWindows(store);
  }

  const obj = {
    subscriptions: [
      {
        topics: [ config.base + '/autoplace' ],
        handler: autoplace
      },
      {
        topics: [ config.base + '/show' ],
        handler: show
      },
      {
        topics: [ config.base + '/place' ],
        handler: place
      },
      {
        topics: [ config.base + '/store' ],
        handler: store
      },
      {
        topics: [ config.base + '/restore' ],
        handler: restore
      },
      {
        topics: [ config.base + '/clear' ],
        handler: clear
      },
      {
        topics: [ config.base + '/open' ],
        handler: open
      },
    ],
    menuItems: [
      {
        title: 'Store windows',
        click() {
          winMan.storeWindows();
        }
      },
      {
        title: 'Restore windows',
        async click() {
          await winMan.restoreWindows();
        },
      },
      {
        title: 'Clear stored windows',
        click() {
          winMan.clearWindows();
        },
      },
      {
        title: 'Restart with windows restore',
        click() {
          winMan.storeWindows();
          setTimeout(() => {
            exec('shutdown -t 0 -r -f');
          }, 1000);
        }
      },
    ]
  };

  // open default apps
  const stored = config?.store?.default;
  if (stored) {
    obj.menuItems.push({
      title: 'Open default apps',
      click() {
        winMan.openWindows(stored);
      }
    })
  }

  return obj;
}
