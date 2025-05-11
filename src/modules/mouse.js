const robot = require('robotjs');
const nutjs = require("@nut-tree/nut-js");

module.exports = async (mqtt, config, log) => {

  const { screen, imageResource, Region, getActiveWindow } = nutjs;

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
    ret = parseInt(ret) === 1;

    console.log('x, y, button, ret: ', x, y, button, ret);
    const oldPos = robot.getMousePos();
    mqtt.publish(`${config.base}/old`, `${oldPos.x},${oldPos.y}`);

    // move
    robot.moveMouse(parseInt(x), parseInt(y));

    // click
    if (['left', 'middle', 'right'].includes(button)) {
      console.log('click')
      robot.mouseClick(button);
    }

    // return mouse back
    if (ret) {
      console.log('return')
      robot.moveMouse(oldPos.x, oldPos.y);
    }
  }
  async function get(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);

    const curPos = robot.getMousePos();
    mqtt.publish(`${config.base}/position`, `${curPos.x},${curPos.y}`);
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
      {
        topics: [ config.base + '/get' ],
        handler: get
      },
    ]
  }
}