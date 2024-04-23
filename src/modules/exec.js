const exec = require('child_process').exec;
const globalConfig = require('../config.js');

module.exports = async (mqtt, config, log) => {

  async function cmd(topic, message) {
    let cmd = `${message}`;

    // self-kill command
    // console.log('globalConfig: ', globalConfig);
    if (cmd === 'self-kill' && globalConfig.mqtt.self_kill_cmd) {
      cmd = globalConfig.mqtt.self_kill_cmd;
    }

    const data = {
      cmd,
      success_tts: config.success_tts,
      error_tts: config.error_tts,
    };

    if (topic === config.base + '/cmd/silent') {
      data.error_tts = '';
      data.success_tts = '';
      data.silent = true;
    }

    const ttsTopic = globalConfig.modules.tts && globalConfig.modules.tts.ttsTopic ? globalConfig.modules.tts.ttsTopic : '';

    // parse message as json
    try {
      const obj = JSON.parse(cmd);
      if (obj.cmd) data.cmd = obj.cmd;
      if (obj.success_tts !== undefined) data.success_tts = obj.success_tts;
      if (obj.error_tts) data.error_tts = obj.error_tts;
      if (obj.silent) data.silent = obj.silent;
    } catch(e){}

    if (!data.silent) log(`< ${topic}: ${cmd}`);

    const start = Date.now();

    exec(data.cmd, (error, stdout, stderr) => {
      if (error) {
        if (ttsTopic && data.error_tts) mqtt.publish(ttsTopic, data.error_tts);
        console.error(`exec error: ${error}`);
        return;
      }

      const isLong = Date.now() - start > config.long_time_sec * 1000;
      if (!isLong && data.success_tts === config.success_tts) data.success_tts = '';

      if (ttsTopic && data.success_tts) {
        if (data.success_tts === 'stdout') data.success_tts = stdout;
        mqtt.publish(ttsTopic, data.success_tts);
      }

      if (stdout && !data.silent) console.log(`stdout: ${stdout}`);
      if (stderr) console.error(`stderr: ${stderr}`);
    });
  }

  return {
    subscriptions: [
      {
        topics: [
          config.base + '/cmd',
          config.base + '/cmd/silent'
        ],
        handler: cmd
      },
    ]
  }
}