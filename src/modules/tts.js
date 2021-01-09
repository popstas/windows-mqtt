const fs = require('fs');
const os = require('os');
const isWindows = os.platform == 'win32';
const execSync = require('child_process').execSync;
let windowsLogger;
if (isWindows) {
  const EventLogger = require('node-windows').EventLogger;
  windowsLogger = new EventLogger('mqtt2tts');
}

const maxRetry = 10;
const retryDelay = 1000;
const ttsDelay = 0; // макс. время задержки в получении и генерации mp3, если в сообщении приходит msg|1234567889, то в конце - время отправки

let config;

// for tts cache
const mp3Path = './data'; // TODO:
if (!fs.existsSync(mp3Path)) {
  fs.mkdir(mp3Path, () => {});
}

const log = (msg, type = 'info') => {
  const tzoffset = (new Date()).getTimezoneOffset() * 60000; //offset in milliseconds
  const d = new Date(Date.now() - tzoffset).
    toISOString().
    replace(/T/, ' ').      // replace T with a space
    replace(/\..+/, '')     // delete the dot and everything after

  console[type](`${d} ${msg}`);
  if (isWindows && process.env.NODE_ENV == 'production') windowsLogger[type](msg);
};

const ttsSay = (msg, tryNum = 1) => {
  msg = msg.toLowerCase();

  let sendTime = msg.match(/\|(\d+)$/);
  if(sendTime){
    sendTime = parseInt(sendTime[1]);
    msg = msg.replace(/\|(\d)+$/, '');
  } else {
    sendTime = Date.now();
  }

  msg = msg.replace(/[^\+,. a-zа-я0-9_-]/g,'');
  log(msg);
  const mp3PathFile = `${mp3Path}/${msg}.mp3`;
  msg = msg.split('+').join("'")

  try {
    if (tryNum > maxRetry) return false;

    // generate mp3 with gTTS
    if (!fs.existsSync(mp3PathFile)) {
      const cmd = `gtts-cli --nocheck --lang ${config.lang} "${msg}" --output "${mp3PathFile}"`;
      // log(`cmd: ${cmd}`);
      const ttsOutput = execSync(cmd);
      // console.log('ttsOutput: ', ttsOutput);
    }

    // play mp3
    let mp3Output;
    const gap = os.platform == 'linux' ? config.gapLinux : config.gapNoLinux; // подобрано методом тыка, разница между Windows и Ubuntu
    const delay = sendTime ? sendTime + ttsDelay - Date.now() + gap : 0;
    // console.log('sent:     ', new Date(sendTime));
    // console.log('current:  ', new Date());
    // console.log('tts time: ', new Date(sendTime + ttsDelay));
    // console.log('delay:    ', delay);
    setTimeout(() => {
      try {
        log(`${config.playCommand} "${mp3PathFile}"`);
        mp3Output = execSync(`${config.playCommand} "${mp3PathFile}"`)
      } catch(e) {
        log(`error play ${mp3PathFile}`, 'error');
      }
    }, delay);
    // console.log(`${config.playCommand} "${mp3PathFile}"`);
    return mp3Output;
  } catch (e) {
    log(`error ttsSay: ${msg}, retry ${tryNum} of ${maxRetry} after 1 sec...`, 'error');
    // console.error(e);
    setTimeout(() => ttsSay(msg, tryNum + 1), retryDelay);
  }
};

module.exports = (mqtt, configModule) => {
  config = configModule;

  return {
    subscriptions: [{
      topics: config.ttsTopic,
      handler(topic, message){
        ttsSay(message.toString());
      }
    }]
  };
}