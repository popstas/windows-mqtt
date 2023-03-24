const robot = require('robotjs');

module.exports = async (mqtt, config, log) => {
  async function click(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);
    const button = ['left', 'middle', 'right'].includes(message) ? message : 'left';
    robot.mouseClick(button);
  }
  async function point(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);

    const [x, y, button] = message.split(',');

    // move
    robot.moveMouse(parseInt(x), parseInt(y));

    // click
    if (['left', 'middle', 'right'].includes(button.trim())) {
      robot.mouseClick(button.trim());
    }
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/click' ],
        handler: click
      },
      {
        topics: [ config.base + '/point' ],
        handler: point
      },
    ]
  }
}