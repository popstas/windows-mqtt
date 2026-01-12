const winMan = require('windows11-manager');
const { default: OBSWebSocket } = require('obs-websocket-js');
const obs = new OBSWebSocket();

module.exports = async (mqtt, config, log) => {
  let connected = false;
  let tries = 0;
  let reconnectIntervalId = null;
  let recordStateChangedHandler = null;

  async function onRec(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);
    await obs.call('StartRecord');
  }

  async function onStopRecord(topic, message) {
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

  function setupRecordStateListener() {
    if (recordStateChangedHandler) {
      obs.off('RecordStateChanged', recordStateChangedHandler);
    }
    recordStateChangedHandler = ({outputActive, outputState, outputPath}) => {
      // console.log('outputActive: ', outputActive);
      // console.log('outputState: ', outputState);
      // console.log('outputPath: ', outputPath);
      const payload = outputActive ? '1' : '0';
      mqtt.publish(config.base + '/state/rec', payload);
      log(`> ${config.base}/state/rec: ${payload}`);
    };
    obs.on('RecordStateChanged', recordStateChangedHandler);
  }

  function onStop() {
    if (reconnectIntervalId !== null) {
      clearInterval(reconnectIntervalId);
      reconnectIntervalId = null;
    }
    if (recordStateChangedHandler) {
      obs.off('RecordStateChanged', recordStateChangedHandler);
      recordStateChangedHandler = null;
    }
    if (connected) {
      try {
        obs.disconnect();
        connected = false;
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }

  function onStart() {
    if (reconnectIntervalId === null) {
      reconnectIntervalId = setInterval(() => {
        if (!connected) {
          connect();
        }
      }, 5000);
    }
    if (!connected) {
      connect();
    }
    setupRecordStateListener();
  }

  connect();
  reconnectIntervalId = setInterval(() => {
    if (!connected) {
      connect();
    }
  }, 5000);

  setupRecordStateListener();

  return {
    subscriptions: [
      {
        topics: [config.base + '/rec'],
        handler: onRec,
      },
      {
        topics: [config.base + '/stop'],
        handler: onStopRecord,
      },
    ],
    onStop,
    onStart,
  }
}
