const robot = require('robotjs');

module.exports = async (mqtt, config, log) => {
  function onPress(topic, message) {
    message = `${message}`;
    const keys = `${message}`.split(' ');

    log(`< ${topic}: ${message}`);

    for (let key of keys) {
      pressKey(key);
    }
  }

  function pressKey(key) {
    let mods = [];
    const res = key.match(/^\((.*?)\) ?/);
    if (res) {
      key = key.replace(/^\((.*?)\) ?/, '');
      mods = res[1].split(/[,|+-]/);

      // modifiers aliases
      mods = mods.map(mod => {
        if (['cmd', 'win', 'windows'].includes(mod)) return 'command';
        if (['ctrl', '^'].includes(mod)) return 'control';
        return mod;
      });
    }

    const modsStr = mods.length > 0 ? `${mods.join('+')}+` : '';
    log(`press ${modsStr}${key}`);
    robot.keyTap(key, mods);
  }

  function onType(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);
    robot.typeString(message);
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/press' ],
        handler: onPress
      },
      {
        topics: [ config.base + '/type' ],
        handler: onType
      },
    ]
  }
}