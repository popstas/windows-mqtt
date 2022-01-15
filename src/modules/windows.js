// module windows-manager not published yet, sorry
const winMan = require('windows-manager');
const globalConfig = require('../config.js');
const {exec} = require('child_process');

if (globalConfig.modules.windows.placeWindowOnOpen) {
  winMan.placeWindowOnOpen();
}

module.exports = async (mqtt, config, log) => {

  if (config.restoreOnStart) winMan.restoreWindows();

  if (config.publishStats) {
    publishStats();
    setInterval(publishStats, 60000);
  }

  function publishStats() {
    const topicBase = config.publishStatsTopic || `${config.base}/stats`;
    const stats = winMan.getStats();

    mqtt.publish(`${topicBase}/total`, `${stats.total}`);

    for (let name in stats.byApp) {
      const app = stats.byApp[name];
      const topic = `${topicBase}/apps/${name}`;
      const msg = `${app.count}`;
      mqtt.publish(topic, msg);
    }

    if (stats.active) {
      mqtt.publish(`${topicBase}/active/app`, stats.active.app);
      mqtt.publish(`${topicBase}/active/title`, stats.active.title);
    }
  }

  async function autoplace(topic, message) {
    log(`< ${topic}: ${message}`);
    const placed = await winMan.placeWindows();

    const apps = placed.map(w => {
      const parts = w.path.split('\\');
      return parts[parts.length - 1].replace(/\.exe$/, '');
    });
    const msg = `Placed ${placed.length} windows: ${apps.join(', ')}`;
    log(msg);

    // notify
    if (config.notifyPlaced && placed.length > 0) {
      const topic = globalConfig.mqtt.base + '/notify/notify';
      mqtt.publish(topic, msg);
    }
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
    winMan.openStore(store);
  }

  async function focus(topic, message) {
    log(`< ${topic}: ${message}`);
    const rules = JSON.parse(`${message}`);
    winMan.focusWindow(rules);
  }

  const obj = {
    subscriptions: [
      {
        topics: [ config.base + '/autoplace' ],
        handler: autoplace
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
      {
        topics: [ config.base + '/focus' ],
        handler: focus
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
      {
        title: 'Restart',
        click() {
          setTimeout(() => {
            exec('shutdown -t 0 -r -f');
          }, 1000);
        }
      },
    ]
  };

  // open default apps
  const stored = config?.store?.default;
  if (stored.apps) stored.windows = stored.apps.map(path => { return { path }});

  if (stored) {
    obj.menuItems.push({
      title: 'Open default apps',
      click() {
        winMan.openStore(stored);
      }
    })
  }

  return obj;
}
