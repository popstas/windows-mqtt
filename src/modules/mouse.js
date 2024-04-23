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

    let [x, y, button, ret] = message.split(',').map(val => val.trim());

    console.log('x, y, button, ret: ', x, y, button, ret);
    const oldPos = robot.getMousePos();

    // move
    robot.moveMouse(parseInt(x), parseInt(y));

    // click
    if (['left', 'middle', 'right'].includes(button)) {
      robot.mouseClick(button);
    }

    // return mouse back
    if (ret) {
      robot.moveMouse(oldPos.x, oldPos.y);
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