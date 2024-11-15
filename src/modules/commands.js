const fs = require('fs');
const path = require('path');
const globalConfig = require('../config.js');
const yaml = require('js-yaml');

module.exports = async (mqtt, config, log) => {
  const subscriptions = [];

  function cmdsHandler(cmds) {
    return function (topic, message) {
      log(`< ${topic}: ${message} (commands.yml)`);
      runCmds(cmds, message);
    }
  }

  function getCustomCommands() {
    try {
      // console.log('config.custom_commands_path: ', config.custom_commands_path);
      return yaml.load(fs.readFileSync(config.custom_commands_path, 'utf8'));
    } catch(e) {
      console.log('e.message: ', e.message);
      return [];
    }
  }

  function addCustomCommand(topic, message) {
    log(`< ${topic}: ${message} (commands.yml)`);
    const msg = `${message}`;

    // load commands
    const commands = [];
    commands.push(...getCustomCommands());

    // add new command
    const cmd = {
      name: msg,
      dialogs: true,
      type: 'mqtt',
      mqtt_topic: 'actions/custom/' + Math.round(Math.random() * 10000),
      cmds: [
        {
          mqtt: 'tts',
          payload: 'Осталось немного дописать действия на эту фразу'
        }
      ]
    }
    if (res = msg.match(/сайт (.*)/g)) {
      cmd.cmds = [ { mqtt: 'home/room/pc/site', payload: `https://www.google.com/search?btnI=1&q=${res[1]}`} ];
    }
    commands.push(cmd);

    // save new list
    fs.writeFileSync(config.custom_commands_path, yaml.dump(commands));

    // refresh runtime cache
    loadYamlCommands();
  }

  function cmdToMqttMessage(cmd, in_message) {
    let out_message = cmd.payload || JSON.stringify(in_message);
    if (typeof cmd.payload == 'object') out_message = JSON.stringify(cmd.payload);
    return out_message;
  }

  function runCmds(cmds, in_message) {
    function runCmd(cmd) {
      if (typeof cmd !== 'object') return;

      if (cmd.mqtt) {
        const topic = cmd.mqtt;
        const message = cmdToMqttMessage(cmd, in_message);
        log(`> ${topic}: ${message}`);
        mqtt.publish(topic, message);
      }

      if (cmd.exec !== undefined) {
        const topic = `${globalConfig.mqtt.base}/exec/cmd`;
        const args = [];

        if (cmd.exec) args.push(cmd.exec);

        if (cmd.shell) {
          const shellPath = config.shells[cmd.shell];
          if (shellPath) args.push(shellPath);
        }

        if (cmd.script) {
          const filePath = path.resolve(`data/windows-mqtt-script-${Date.now()}-${Math.random() * 1000}`);
          fs.writeFileSync(filePath, cmd.script);
          args.push(filePath);
          setTimeout(() => {fs.unlinkSync(filePath)}, 5000);
        }

        const message = JSON.stringify({
          cmd: args.join(' '),
          success_tts: cmd.success_tts,
          error_tts: cmd.error_tts,
        });
        mqtt.publish(topic, message);
      }
    }

    for(let cmd of cmds) {
      runCmd(cmd);
    }
  }

  function addSubscription({topic, handler}) {
    const sub = {
      topics: [ topic ],
      handler: handler,
    }
    subscriptions.push(sub);
  }

  function addCommand(cmd) {
    if (cmd.mqtt_topic) {
      addSubscription({
        topic: cmd.mqtt_topic,
        handler: cmdsHandler(cmd.cmds),
      })
    }
    
    // cmd.dialogs yandex dialogs private handler
    if (cmd.dialogs) {
      function addDialogCommand (cmds) {
        // TODO: impl
      }
      addDialogCommand(cmd.cmds);
    }
  }

  function loadYamlCommands() {
    const yaml = require('js-yaml');
    const fs = require('fs');
    let commands = [];

    try {
      commands = yaml.load(fs.readFileSync(__dirname + '/../../commands.yml', 'utf8'));
      // console.log(commands);
    } catch (e) {
      console.log('commands.yml not found', e.message);
    }
    
    commands.push(...getCustomCommands());

    // save runtime cache compiled yml
    if (config.cache_path) {
      fs.writeFileSync(config.cache_path, yaml.dump(commands));
    }

    return commands;
  }

  const commands = loadYamlCommands();
  for (let cmd of commands) {
    addCommand(cmd); // fill subscripttions array
  }

  // запомни команду
  if (config.custom_commands_path) {
    addSubscription({
      topic: config.base + '/add',
      handler: addCustomCommand,
    });
  }

  return { subscriptions };
}