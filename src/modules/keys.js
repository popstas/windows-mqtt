const robot = require('robotjs');

module.exports = async (mqtt, config) => {
  async function onPress(topic, message) {
    message = `${message}`;
    console.log(`< ${topic}: ${message}`);

    let mods = [];
    const res = message.match(/^\((.*?)\) ?/);
    if (res) {
      message = message.replace(/^\((.*?)\) ?/, '');
      mods = res[1].split(/[,|+-]/);

      // modifiers aliases
      mods = mods.map(mod => {
        if (['cmd', 'win', 'windows'].includes(mod)) return 'command';
        if (['ctrl', '^'].includes(mod)) return 'control';
        return mod;
      });
    }

    const modsStr = mods.length > 0 ? `${mods.join('+')}+` : '';
    console.log(`press ${modsStr}${message}`);
    robot.keyTap(message, mods);
  }

  async function onType(topic, message) {
    message = `${message}`;
    console.log(`< ${topic}: ${message}`);
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