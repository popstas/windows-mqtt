const midi = require('midi');
const usbDetect = require('usb-detection');

const watchdogTimeout = 600 * 1000;

module.exports = async (mqtt, config, log) => {
  const input = new midi.Input();
  let lastMessage = { date: 0, message: {}};




  // проверка, что интервал не отваливается после перезагрузки, а таймаут отваливается
  setInterval(() => {
    // log('Interval');
    const isNoMidi = lastMessage.date - Date.now() > watchdogTimeout;
    if (isNoMidi) openMidi();
  }, watchdogTimeout);




  // переподключение, когда найдено midi устройство
  if (config.device.vid && config.device.pid) {
    usbDetect.startMonitoring();
    // чтобы узнать нужные vid и pid, надо подписаться просто на 'add'
    usbDetect.on(`add:${config.device.vid}:${config.device.pid}`, function(device) {
      console.log('add', device);
      setTimeout(openMidi, 500);
    });
  }



  function openMidi() {
    if (input.isPortOpen()) {
      log('Close midi port');
      input.closePort();
    }

    // Count the available input ports.
    const portCount = input.getPortCount();
    const ports = [];
    const portsStr = [];
    log('Total midi ports: ' + portCount);

    for (let p = 0; p < portCount; p++) {
      const portName = input.getPortName(p);
      ports.push(portName);
      portsStr.push(`${p}: ${portName}`);
    }

    // get portNum
    let portNum = ports.findIndex(p => p == config.portName);
    if (portNum === -1) portNum = config.portNum;
    log(`MIDI ports: ${portsStr.join(', ')}.`);

    if (portNum === undefined){
      log(`Cannot find MIDI device "${config.portName}"`);
      return;
    }
    else log(`Try to using port ${portNum}`);

    input.openPort(portNum);
  }

  function listenKeys() {
    log('midi listen start');

    // Configure a callback.
    input.on('message', onMidiMessage);

    // Sysex, timing, and active sensing messages are ignored
    // by default. To enable these message types, pass false for
    // the appropriate type in the function below.
    // Order: (Sysex, Timing, Active Sensing)
    // For example if you want to receive only MIDI Clock beats
    // you should use
    // input.ignoreTypes(true, false, true)
    input.ignoreTypes(false, false, false);

    mqtt.on('connect', openMidi);

    openMidi();
  }

  function onMidiMessage(deltaTime, m) {
    // The message is an array of numbers corresponding to the MIDI bytes:
    //   [status, data1, data2]
    // https://www.cs.cf.ac.uk/Dave/Multimedia/node158.html has some helpful
    // information interpreting the messages.

    let keys = '';
    let sendMqtt = '';

    // на yamaha pss-a50 дргебезжат эти каналы
    // TODO: to config
    if (m == 248 || m == 254) {
      return;
    }

    // находим, что нажато из конфига
    for (let hk of config.hotkeys) {
      if(m[0] == hk.midi[0] && m[1] == hk.midi[1] && m[2] == hk.midi[2]) {
        if (hk.keys) keys = hk.keys;
        if (hk.mqtt) sendMqtt = hk.mqtt;
        break;
      }
    }

    // левый ползунок
    // TODO: remove
    if (m[0] == 176 && m[1] == 9) {
      const minDelay = 50;
      if (Date.now() - lastMessage.date < minDelay) return;

      lastMessage.date = Date.now();
      lastMessage.message = m;

      const val = m[2];
      switch(true) {
        case val < 42:
          keys = 'alt+control+command j';
          break;
        case val < 82:
          keys = 'alt+control+command k';
          break;
        case val >= 82:
          keys = 'alt+control+command l';
      }

      if (keys == lastMessage.keys) return; // don't repeat
      lastMessage.keys = keys;
    }

    // обработка кнопок, если keys назначены
    let [mods, key] = keys.split(' ');
    mods = mods.split('+');
    if (key) {
      log(`press ${keys}`);
      robot.keyTap(key, mods);
    }
    else {
      log(`m: ${m} d: ${deltaTime}`);
    }

    // отправка mqtt
    if (sendMqtt) {
      log(`send mqtt: ${sendMqtt[0]} ${sendMqtt[1]}`);
      mqtt.publish(sendMqtt[0], sendMqtt[1]);
    }

    lastMessage.date = Date.now();
    lastMessage.message = m;
  }

  if (config.listen) listenKeys();

  return {
    subscriptions: []
  }
}
