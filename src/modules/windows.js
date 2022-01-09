// module windows-manager not published yet, sorry
const winMan = require('windows-manager');
const globalConfig = require('../config.js');

if (globalConfig.modules.windows.placeWindowOnOpen) {
  winMan.placeWindowOnOpen({ keepalive: false });
}

module.exports = async (mqtt, config, log) => {

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
    const rules = {};
    `${message}`.split(',').forEach(part => {
      const [name, value] = part.split(':');
      rules[name] = value;
    });
    console.log('rules: ', rules);
    await winMan.placeWindowByConfig(rules);
  }

  return {
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
    ]
  }
}
