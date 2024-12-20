const midi = require('midi');
const usbDetect = require('usb-detection');
const debounce = require('lodash.debounce');
const robot = require('robotjs');

const maxRangeDelay = 200; // for ranges should be at least 2 events per maxRangeDelay
const minChanges = 3; // for avoid false positives

// loads config without cache
function getConfig() {
  const configPath = '../config.js';
  delete(require.cache[require.resolve(configPath)]);
  const config = require(configPath);
  return config.modules.midi;
}

module.exports = async (mqtt, config, log) => {
  let inputs = [];
  let portsDisplayed = false;
  const lastMessage = { date: 0, message: {}}; // for detect midi disconnect, watchdogTimeout, TODO: remove?
  let modulePaused = false;
  const lastMidi = {}; // for detect range bounces, maxRangeDelay

  start();

  function start() {
    inputs = [];
    for (let device of config.devices) {
      const input = new midi.Input();
      inputs.push(input);
      initDevice(device, input);
    }
  }

  function initDevice(device, input) {
    log(`midi: initDevice: ${JSON.stringify(device.portName)}`, 'debug');

    const isDeviceConfigured = device?.vid && device?.pid;

    // переподключение, когда найдено midi устройство
    usbDetect.startMonitoring();
    if (isDeviceConfigured) {
      usbDetect.on(`add:${device.vid}:${device.pid}`, function(usbDevice) {
        console.log('midi: add', usbDevice);
        setTimeout(() => openMidi(input, device), 500);
      });
      listenKeys(input, device);
    }
    else {
      console.log('! To find out vid, pid and portName, reconnect your midi device');
      // list all devices add
      usbDetect.on(`add`, function(device) {
        console.log('add', device);
        console.log('add to midi: {} section in config:');
        console.log(`portName: '${device.deviceName}',`);
        console.log(`device: { vid: ${device.vendorId}, pid: ${device.productId} },`)
      });
    }
  }

  function openMidi(input, device) {
    if (input.isPortOpen()) {
      log('midi: Close midi port', 'debug');
      input.closePort();
    }

    // Count the available input ports.
    const portCount = input.getPortCount();
    const ports = [];
    const portsStr = [];
    // log('Total midi ports: ' + portCount);

    for (let p = 0; p < portCount; p++) {
      const portName = input.getPortName(p);
      ports.push(portName);
      portsStr.push(`${p}: ${portName}`);
    }

    // get portNum
    let portNum = ports.findIndex(p => p == device.portName);
    if (portNum === -1) portNum = device.portNum;
    if (!portsDisplayed) {
      portsDisplayed = true;
      log(`midi ports: ${portsStr.join(', ')}.`, 'debug');
    }

    if (portNum === undefined){
      log(`midi: Cannot find MIDI device "${device.portName}"`, 'debug');
      return;
    }
    // else log(`Try to using port ${portNum}`, 'debug');

    try {
      input.openPort(portNum);
      log(`midi: ${input.getPortName(portNum)} inited`);
    }
    catch (e) {
      log('midi: Failed to open ' + portNum);
      log(e.message);
    }

    /* const output = new midi.Output();
    output.openPort(portNum);
    output.sendMessage([144,52,127]);
    setTimeout(() => {
      output.sendMessage([144,52,0]);
    }, 500); */
  }

  function listenKeys(input, device) {
    // log('midi listen start');

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

    mqtt.on('connect', () => openMidi(input, device));

    openMidi(input, device);

    // main handler
    function onMidiMessage(deltaTime, m) {
      // The message is an array of numbers corresponding to the MIDI bytes:
      //   [status, data1, data2]
      // https://www.cs.cf.ac.uk/Dave/Multimedia/node158.html has some helpful
      // information interpreting the messages.

      if (modulePaused) return;

      if (config.hotReload) device = getConfig().devices.find(d => d.portName === device.portName); // TODO: remove from onMidiMessage

      // на yamaha pss-a50 дребезжат эти каналы
      if (device.ignoreLines && device.ignoreLines.includes(parseInt(m))) {
        return;
      }

      addHistory(m); // for lastMidi

      let keys = '';
      let sendMqtt = '';

      // находим, что нажато из конфига
      for (let hk of device.hotkeys.filter(hk => hk.type !== 'range')) {
        if(m[0] == hk.midi[0] && m[1] == hk.midi[1] && 
          (m[2] == hk.midi[2] || hk.midi[2] == '>0' && m[2] > 0)
        ) {
          if (hk.keys) keys = hk.keys;
          if (hk.mqtt) sendMqtt = hk.mqtt;
          break;
        }
      }

      // находим ranges
      for (let hk of device.hotkeys.filter(hk => hk.type === 'range')) {
        if(m[0] == hk.midi[0] && m[1] == hk.midi[1]) {
          const funс = hk.fastDebounce ? fastDebouncedMidiHandlerRange : debouncedMidiHandlerRange;
          funс({
            val: m[2],
            m,
            hk,
          });
          break;
        }
      }

      doActions({keys, sendMqtt});
      log(`midi: ${m} d: ${deltaTime}`);

      lastMessage.date = Date.now();
      lastMessage.message = m;
    }

  }









  // lastMidi - for detect random range events
  const getMidiKey = m => `${m[0]}-${m[1]}`;

  function addHistory(m) {
    const key = getMidiKey(m);

    // delete old last
    // единичное изменение в течение секунды игнорируем
    // если в прошлый раз сигнал был давно, считаем, что сейчас первый сигнал
    const last = getHistory(m);
    const delta = last?.dateLast - Date.now();
    if (delta > maxRangeDelay) delete(lastMidi[key]);

    // create
    if (!lastMidi[key]) lastMidi[key] = {
      key,
      dateLast: null,
      datePrev: null,
    }

    // update
    lastMidi[key].m = m;
    lastMidi[key].datePrev = lastMidi[key].dateLast;
    lastMidi[key].dateLast = Date.now();
  }
  const getHistory = m => lastMidi[getMidiKey(m)];

  // executa keys or mqtt
  function doActions({keys = '', sendMqtt}) {
    // обработка кнопок, если keys назначены
    if (keys) {
      let [mods, key] = keys.split(' ');
      mods = mods.split('+');
      if (key) {
        log(`press ${keys}`);
        robot.keyTap(key, mods);
      }
    }
  
    if (sendMqtt) {
      log(`send mqtt: ${sendMqtt[0]} ${sendMqtt[1]}`);
      mqtt.publish(sendMqtt[0], sendMqtt[1]);
    }
  }
  
  // send mqtt for range controls change
  // convert midi value to out value
  // should be debounced
  function midiHandlerRange({ hk, val, m }) {
    let sendMqtt, keys;

    const last = getHistory(m);
    if (!last?.datePrev) {
      console.log('Single midi signal, ignore it:', m);
      return;
    }

    val = getValFromMidi({
      val: val,
      hk
    });

    if (hk.mqtt) {
      sendMqtt = {...hk.mqtt};
      sendMqtt[1] = sendMqtt[1].replace(/\{\{payload\}\}/g, `${val}`);
    }
    if (hk.keys) keys = hk.keys;

    doActions({keys, sendMqtt});
  }
  const debouncedMidiHandlerRange = debounce(midiHandlerRange, 1000);
  const fastDebouncedMidiHandlerRange = debounce(midiHandlerRange, 100);
  
  function getValFromMidi({ val, hk }) {
    const min = hk.min || 0;
    const max = hk.max || 127;
    const to_min = hk.to_min || 0;
    const to_max = hk.to_max || 10;
  
    const valPercent = (val - min) / (max - min);
    const to_val = to_min + valPercent * (to_max - to_min);
    // console.log(to_val);
    return Math.round(to_val);
  }
  


  function closeMidi() {
    inputs.forEach(input => input.closePort());
  }

  function onStop() {
    modulePaused = true;
    closeMidi();
    log('Stop midi listening');
  }
  function onStart() {
    modulePaused = false;
    start();
    log('Start midi listening');
  }

  return {
    subscriptions: [],
    onStop,
    onStart
  }
}
