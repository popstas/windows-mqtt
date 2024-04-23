const winMan = require('windows11-manager');
const { default: OBSWebSocket } = require('obs-websocket-js');
const obs = new OBSWebSocket();

module.exports = async (mqtt, config, log) => {
  let connected = false;
  let tries = 0;
  async function onRec(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);
    await obs.call('StartRecord');
  }

  async function onStop(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);
    await obs.call('StopRecord');
  }

  async function connect() {
    const win = winMan.findWindow({title: '^OBS'});
    if (!win) return; // don't try to connect when no OBS window opened
    try {
      tries++;
      // Replace 'your_password' with your actual OBS WebSocket password, if you've set one
      const address = `ws://${config.host || 'localhost'}:${config.port || 4455}`;
      const password = config.password || '';
      await obs.connect(address, password);
      connected = true;
      log('obs: Successfully connected to OBS WebSocket!');
    } catch (error) {
      if (tries < 2) {
        log('obs: Failed to connect!');
        console.error(error);
      }
    }
  }

  connect();
  setInterval(() => {
    if (!connected) {
      connect();
    }
  }, 5000);

  obs.on('RecordStateChanged', ({outputActive, outputState, outputPath}) => {
    // console.log('outputActive: ', outputActive);
    // console.log('outputState: ', outputState);
    // console.log('outputPath: ', outputPath);
    const payload = outputActive ? '1' : '0';
    mqtt.publish(config.base + '/state/rec', payload);
    log(`> ${config.base}/state/rec: ${payload}`);
  });

  return {
    subscriptions: [
      {
        topics: [config.base + '/rec'],
        handler: onRec,
      },
      {
        topics: [config.base + '/stop'],
        handler: onStop,
      },
    ]
  }
}
