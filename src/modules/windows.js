const winMan = require('windows11-manager');
const globalConfig = require('../config.js');
const {exec} = require('child_process');

module.exports = async (mqtt, config, log) => {
  let lastStats = {};
  if (config.restoreOnStart) {
    await restoreWindows();
    setTimeout(() => {
      if (config.placeWindowOnStart) winMan.placeWindows();
    }, 15000);
  }

  if (config.placeWindowOnOpen) {
    await winMan.placeWindowOnOpen();
  }

  if (config.placeWindowOnStart) {
    await winMan.placeWindows();
  }

  if (config.publishStats) {
    publishStats();
    setInterval(publishStats, 60000);
  }

  async function restoreWindows() {
    await winMan.restoreWindows();

    const stored = config?.store?.custom;
    if (stored.apps) stored.windows = stored.apps.map(path => {
      return {path}
    });
    await winMan.openStore(stored);
  }

  function publishStats() {
    const topicBase = config.publishStatsTopic || `${config.base}/stats`;
    const stats = winMan.getStats();

    // for correct graphs need to send 0 at latest count
    if (lastStats?.byApp) {
      for (let app in lastStats.byApp) {
        if (lastStats.byApp[app].count === 0) continue;
        if (!stats.byApp[app]) stats.byApp[app] = {count: 0, wins: []}
      }
    }
    lastStats = stats;

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

    const apps = placed.map(item => {
      const parts = item.w.path.split('\\');
      return parts[parts.length - 1].replace(/\.exe$/, '');
    });
    const msg = `Placed windows: ${placed.length}`;
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
    } catch (e) {
      log('Failed to parse place position json');
      log(e);
    }
  }

  async function store(topic, message) {
    // log(`< ${topic}: ${message}`);
    winMan.storeWindows();
  }

  async function restore(topic, message) {
    log(`< ${topic}: ${message}`);
    await restoreWindows();
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
    await winMan.focusWindow(rules);
  }

  async function reload() {
    await winMan.reloadConfigs();
    await mqtt.publish(`${config.base}/reload`, '1');
  }

  async function restartHandler(topic, message) {
    log(`< ${topic}: ${message}`);
    const type = `${message}`;
    if (type === 'nostore') {
      restart();
    } else {
      winMan.storeWindows();
      restart();
    }
  }

  async function shutdownHandler(topic, message) {
    log(`< ${topic}: ${message}`);
    const type = `${message}`;
    if (type === 'store') {
      winMan.storeWindows();
    }
    shutdown();
  }

  function sleep() {
    setTimeout(() => {
      exec('D:/prog/SysinternalsSuite/psshutdown.exe -d -t 0');
    }, 1000);
  }

  function restart() {
    setTimeout(() => {
      exec('shutdown -t 0 -r -f');
    }, 1000);
  }

  function shutdown() {
    setTimeout(() => {
      exec('shutdown -t 0 -s -f');
    }, 1000);
  }

  const menuItems = [];
  menuItems.push(...[
    {
      label: 'Place windows',
      async click() {
        await autoplace('command/autoplace', '1');
      }
    },
    {
      label: 'Store windows',
      click() {
        winMan.storeWindows();
      }
    },
    {
      label: 'Restore windows',
      async click() {
        await winMan.restoreWindows();
      },
    },
    {
      label: 'Clear stored windows',
      click() {
        winMan.clearWindows();
      },
    },
  ]);

  // open default apps
  const stored = config?.store?.default;
  if (stored.apps) stored.windows = stored.apps.map(path => {
    return {path}
  });
  if (stored) {
    menuItems.push({
      label: 'Open default apps',
      click() {
        winMan.openStore(stored);
      }
    })
  }

  menuItems.push(...[
    {
      type: 'separator',
    },
    {
      label: 'Restart with windows restore',
      click() {
        winMan.storeWindows();
        restart();
      }
    },
    {
      label: 'Sleep',
      click: sleep
    },
    {
      label: 'Restart',
      click: restart
    },
    {
      label: 'Shutdown',
      click: shutdown
    },
    {
      type: 'separator',
    },
    {
      label: 'Reload configs',
      click: reload
    },
  ]);

  return {
    subscriptions: [
      {
        topics: [config.base + '/autoplace'],
        handler: autoplace
      },
      {
        topics: [config.base + '/place'],
        handler: place
      },
      {
        topics: [config.base + '/store'],
        handler: store
      },
      {
        topics: [config.base + '/restore'],
        handler: restore
      },
      {
        topics: [config.base + '/clear'],
        handler: clear
      },
      {
        topics: [config.base + '/open'],
        handler: open
      },
      {
        topics: [config.base + '/focus'],
        handler: focus
      },
      {
        topics: [config.base + '/sleep'],
        handler: sleep
      },
      {
        topics: [config.base + '/restart'],
        handler: restartHandler
      },
      {
        topics: [config.base + '/shutdown'],
        handler: shutdownHandler
      },
    ],
    menuItems,
  };
}
