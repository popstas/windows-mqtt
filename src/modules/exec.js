const exec = require('child_process').exec;
const globalConfig = require('../config.js');

module.exports = async (mqtt, config, log) => {

  async function cmd(topic, message) {
    const cmd = `${message}`;
    log(`< ${topic}: ${cmd}`);
    const data = {
      cmd,
      success_tts: config.success_tts,
      error_tts: config.error_tts,
    };

    const ttsTopic = globalConfig.modules.tts && globalConfig.modules.tts.ttsTopic ? globalConfig.modules.tts.ttsTopic : '';

    // parse message as json
    try {
      const obj = JSON.parse(cmd);
      if (obj.cmd) data.cmd = obj.cmd;
      if (obj.success_tts) data.success_tts = obj.success_tts;
      if (obj.error_tts) data.error_tts = obj.error_tts;
    } catch(e){}

    exec(data.cmd, (error, stdout, stderr) => {
      if (error) {
        if (ttsTopic && data.error_tts) mqtt.publish(ttsTopic, data.error_tts);
        console.error(`exec error: ${error}`);
        return;
      }

      if (ttsTopic && data.success_tts) {
        if (data.success_tts == 'stdout') data.success_tts = stdout;
        mqtt.publish(ttsTopic, data.success_tts);
      }

      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
    });
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/cmd' ],
        handler: cmd
      },
    ]
  }
}