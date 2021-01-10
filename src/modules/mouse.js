const robot = require('robotjs');

module.exports = async (mqtt, config) => {
  async function onClick(topic, message) {
    message = `${message}`;
    console.log(`< ${topic}: ${message}`);
    const button = ['left', 'middle', 'right'].includes(message) ? message : 'left';
    robot.mouseClick(button);
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/click' ],
        handler: onClick
      },
    ]
  }
}